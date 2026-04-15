import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { checkCredits } from '~/lib/credits/check';
import { deductCredit } from '~/lib/credits/deduct';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/.server/llm/prompts';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import { getOptionalServerEnv } from '~/lib/env.server';
import { chatRateLimiter } from '~/lib/security/rate-limiter';
import { supabaseAdmin } from '~/lib/supabase/server';

const OVERLOAD_RETRY_DELAYS_MS = [0, 250, 750] as const;
const DEBUG = getOptionalServerEnv('RIDVAN_DEBUG_CHAT') === '1';

export async function action(args: ActionFunctionArgs) {
  return chatAction(args);
}

function getUsageTotals(usage: unknown) {
  if (!usage || typeof usage !== 'object') {
    return { inputTokens: 0, outputTokens: 0, hasUsage: false };
  }

  const usageData = usage as Record<string, unknown>;
  const inputTokens = Number(usageData.inputTokens ?? usageData.promptTokens ?? 0);
  const outputTokens = Number(usageData.outputTokens ?? usageData.completionTokens ?? 0);

  const hasUsage = Number.isFinite(inputTokens) && Number.isFinite(outputTokens) && (inputTokens > 0 || outputTokens > 0);

  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
    hasUsage,
  }
}

async function chatAction({ context, request }: ActionFunctionArgs) {
  const cloudflareEnv = context.cloudflare?.env as Env;

  if (DEBUG) {
    console.log('[RIDVAN DEBUG][api.chat] action:start', { method: request.method, url: request.url, ts: Date.now() });
  }

  const processApiKey = getOptionalServerEnv('ANTHROPIC_API_KEY');

  console.log('[RIDVAN DEBUG] ENV CHECK:', {
    hasApiKey: !!processApiKey,
    keyPrefix: processApiKey?.substring(0, 15),
    envSource: 'process.env',
  });
  console.log('[RIDVAN DEBUG] CF ENV CHECK:', {
    hasApiKey: !!cloudflareEnv?.ANTHROPIC_API_KEY,
    keyPrefix: cloudflareEnv?.ANTHROPIC_API_KEY?.substring(0, 15),
    envSource: 'context.cloudflare.env',
  });

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return Response.json(
      { error: '[RIDVAN-E013] Unauthorized: missing Bearer token' },
      {
        status: 401,
      },
    );
  }

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return Response.json(
      { error: `[RIDVAN-E013] Unauthorized: ${userError?.message ?? 'invalid token'}` },
      {
        status: 401,
      },
    );
  }

  const rateLimit = chatRateLimiter.check(user.id);

  if (!rateLimit.allowed) {
    return Response.json(
      {
        error: '[RIDVAN-E501] Rate limit exceeded. Max 20 generations per hour.',
        resetInMs: rateLimit.resetInMs,
      },
      {
        status: 429,
      },
    );
  }

  const creditState = await checkCredits(user.id);

  if (!creditState.allowed) {
    return Response.json(
      {
        error: '[RIDVAN-E011] No credits remaining',
        remaining: creditState.remaining,
        plan: creditState.plan,
      },
      {
        status: 403,
      },
    );
  }

  const { messages } = await request.json<{ messages: Messages }>();

  const MAX_HISTORY = 10;
  let truncatedMessages =
    messages.length > MAX_HISTORY
      ? [...messages.slice(0, 1), ...messages.slice(-(MAX_HISTORY - 1))]
      : messages;

  const stream = new SwitchableStream();
  let streamChunkCount = 0;
  let streamByteCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalOutputChars = 0;
  let hasUsageData = false;
  let deductionApplied = false;

  const isOverloadedError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error ?? '');
    const normalizedMessage = message.toLowerCase();

    if (normalizedMessage.includes('overloaded')) {
      return true;
    }

    if (!error || typeof error !== 'object') {
      return false;
    }

    const errorData = error as Record<string, unknown>;
    const nestedValues = [errorData.type, errorData.error, errorData.body, errorData.cause];

    return nestedValues.some((value) => {
      if (!value) {
        return false;
      }

      if (typeof value === 'string') {
        const lower = value.toLowerCase();
        return lower.includes('overloaded_error') || lower.includes('overloaded');
      }

      if (typeof value === 'object') {
        const maybeType = (value as Record<string, unknown>).type;
        const maybeMessage = (value as Record<string, unknown>).message;
        const typeText = typeof maybeType === 'string' ? maybeType.toLowerCase() : '';
        const messageText = typeof maybeMessage === 'string' ? maybeMessage.toLowerCase() : '';

        return typeText === 'overloaded_error' || messageText.includes('overloaded');
      }

      return false;
    });
  };

  const streamTextWithOverloadRetry = async (inputMessages: Messages, options: StreamingOptions) => {
    let lastError: unknown;

    for (let attempt = 0; attempt < OVERLOAD_RETRY_DELAYS_MS.length; attempt++) {
      const delay = OVERLOAD_RETRY_DELAYS_MS[attempt];

      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      try {
        return await streamText(inputMessages, cloudflareEnv, options);
      } catch (error) {
        if (!isOverloadedError(error)) {
          throw error;
        }

        lastError = error;
      }
    }

    throw lastError;
  };

  const getChunkSize = (chunk: unknown) => {
    if (typeof chunk === 'string') {
      return new TextEncoder().encode(chunk).byteLength;
    }

    if (chunk instanceof Uint8Array) {
      return chunk.byteLength;
    }

    if (chunk instanceof ArrayBuffer) {
      return chunk.byteLength;
    }

    if (chunk && typeof chunk === 'object' && 'byteLength' in (chunk as Record<string, unknown>)) {
      const maybeByteLength = (chunk as { byteLength?: unknown }).byteLength;
      return typeof maybeByteLength === 'number' ? maybeByteLength : 0;
    }

    return 0;
  };

  try {
    const applyUsageBasedDeduction = async () => {
      if (deductionApplied) {
        return;
      }

      deductionApplied = true;

      const costCredits = hasUsageData
        ? Math.max(1, Math.ceil((totalInputTokens + totalOutputTokens) / 1000))
        : Math.max(1, Math.ceil(totalOutputChars / 2000)); // Fallback for streaming cases where token usage is unavailable.

      const deduction = await deductCredit(user.id, 'AI generation', costCredits);

      if (!deduction.success) {
        console.error('[RIDVAN-E012] Failed to deduct usage-based credits after generation');
      }
    };

    const options: StreamingOptions = {
      toolChoice: 'none',
      onFinish: async (event) => {
        const { text: content, finishReason, usage } = event as {
          text: string;
          finishReason: string;
          usage?: unknown;
        };

        totalOutputChars += content.length;

        const totals = getUsageTotals(usage);

        if (totals.hasUsage) {
          hasUsageData = true;
          totalInputTokens += totals.inputTokens;
          totalOutputTokens += totals.outputTokens;
        }

        if (finishReason !== 'length') {
          await applyUsageBasedDeduction();
          return stream.close();
        }

        if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
          throw Error('Cannot continue message: Maximum segments reached');
        }

        const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;

        console.log(`Reached max token limit (${MAX_TOKENS}): Continuing message (${switchesLeft} switches left)`);

        messages.push({ role: 'assistant', content });
        messages.push({ role: 'user', content: CONTINUE_PROMPT });

        truncatedMessages =
          messages.length > MAX_HISTORY
            ? [...messages.slice(0, 1), ...messages.slice(-(MAX_HISTORY - 1))]
            : messages;

        if (DEBUG) {
          console.log('[RIDVAN DEBUG][api.chat] before:llm');
        }
        const result = await streamTextWithOverloadRetry(truncatedMessages, options);
        if (DEBUG) {
          const responseLike = (result as any)?.response;
          const contentType =
            typeof responseLike?.headers?.get === 'function' ? responseLike.headers.get('content-type') : null;
          console.log('[RIDVAN DEBUG][api.chat] return:type', {
            isResponse: result instanceof Response,
            contentType,
          });
        }

        return stream.switchSource(result.toAIStream());
      },
    };

    if (DEBUG) {
      console.log('[RIDVAN DEBUG][api.chat] before:llm');
    }
    const result = await streamTextWithOverloadRetry(truncatedMessages, options);
    if (DEBUG) {
      const responseLike = (result as any)?.response;
      const contentType = typeof responseLike?.headers?.get === 'function' ? responseLike.headers.get('content-type') : null;
      console.log('[RIDVAN DEBUG][api.chat] return:type', {
        isResponse: result instanceof Response,
        contentType,
      });
    }

    stream.switchSource(result.toAIStream());
    const outputStream = stream.readable.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          streamChunkCount++;
          streamByteCount += getChunkSize(chunk);
          controller.enqueue(chunk);
        },
        flush() {
          if (DEBUG) {
            console.log('[RIDVAN DEBUG][api.chat] stream:stats', { chunks: streamChunkCount, bytes: streamByteCount });
          }
        },
      }),
    );

    if (DEBUG) {
      console.log('[RIDVAN DEBUG][api.chat] action:return:ok');
    }
    return new Response(outputStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-RateLimit-Remaining': String(rateLimit.remaining),
        'X-RateLimit-Reset': String(rateLimit.resetInMs),
      },
    });
  } catch (error) {
    console.log(error);
    if (DEBUG) {
      console.log('[RIDVAN DEBUG][api.chat] action:error', error instanceof Error ? error.message : error);
    }

    if (isOverloadedError(error)) {
      if (DEBUG) {
        console.log('[RIDVAN DEBUG][api.chat] action:return:503');
      }
      return Response.json(
        {
          error: {
            code: 'LLM_OVERLOADED',
            message: 'Model is temporarily overloaded. Please try again in a moment.',
          },
        },
        {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    }

    throw new Response(null, {
      status: 500,
      statusText: 'Internal Server Error',
    });
  }
}
