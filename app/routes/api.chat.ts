import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { checkCredits } from '~/lib/credits/check';
import { deductCredit } from '~/lib/credits/deduct';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/.server/llm/prompts';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import { chatRateLimiter } from '~/lib/security/rate-limiter';
import { supabaseAdmin } from '~/lib/supabase/server';

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
  };
}

async function chatAction({ context, request }: ActionFunctionArgs) {
  console.log('[RIDVAN DEBUG] ENV CHECK:', {
    hasApiKey: !!process.env.ANTHROPIC_API_KEY,
    keyPrefix: process.env.ANTHROPIC_API_KEY?.substring(0, 15),
    envSource: 'process.env',
  });
  console.log('[RIDVAN DEBUG] CF ENV CHECK:', {
    hasApiKey: !!context.cloudflare?.env?.ANTHROPIC_API_KEY,
    keyPrefix: context.cloudflare?.env?.ANTHROPIC_API_KEY?.substring(0, 15),
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

  const stream = new SwitchableStream();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalOutputChars = 0;
  let hasUsageData = false;
  let deductionApplied = false;

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

        const result = await streamText(messages, context.cloudflare.env, options);

        return stream.switchSource(result.toAIStream());
      },
    };

    const result = await streamText(messages, context.cloudflare.env, options);

    stream.switchSource(result.toAIStream());

    return new Response(stream.readable, {
      status: 200,
      headers: {
        contentType: 'text/plain; charset=utf-8',
        'X-RateLimit-Remaining': String(rateLimit.remaining),
        'X-RateLimit-Reset': String(rateLimit.resetInMs),
      },
    });
  } catch (error) {
    console.log(error);

    throw new Response(null, {
      status: 500,
      statusText: 'Internal Server Error',
    });
  }
}
