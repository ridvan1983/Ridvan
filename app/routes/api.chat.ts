import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { checkCredits } from '~/lib/credits/check';
import { deductCredit } from '~/lib/credits/deduct';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/.server/llm/prompts';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import { supabaseAdmin } from '~/lib/supabase/server';

export async function action(args: ActionFunctionArgs) {
  return chatAction(args);
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

  try {
    const options: StreamingOptions = {
      toolChoice: 'none',
      onFinish: async ({ text: content, finishReason }) => {
        if (finishReason !== 'length') {
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

    const deduction = await deductCredit(user.id, 'AI generation');

    if (!deduction.success) {
      return Response.json(
        {
          error: deduction.error ?? '[RIDVAN-E012] Failed to deduct credit',
        },
        {
          status: 500,
        },
      );
    }

    stream.switchSource(result.toAIStream());

    return new Response(stream.readable, {
      status: 200,
      headers: {
        contentType: 'text/plain; charset=utf-8',
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
