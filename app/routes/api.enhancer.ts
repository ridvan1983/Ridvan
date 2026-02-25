import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { StreamingTextResponse, parseStreamPart } from 'ai';
import { streamText } from '~/lib/.server/llm/stream-text';
import { checkCredits } from '~/lib/credits/check';
import { deductCredit } from '~/lib/credits/deduct';
import { supabaseAdmin } from '~/lib/supabase/server';
import { stripIndents } from '~/utils/stripIndent';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

export async function action(args: ActionFunctionArgs) {
  return enhancerAction(args);
}

async function enhancerAction({ context, request }: ActionFunctionArgs) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return Response.json({ error: '[RIDVAN-E013] Unauthorized: missing Bearer token' }, { status: 401 });
  }

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return Response.json({ error: `[RIDVAN-E013] Unauthorized: ${userError?.message ?? 'invalid token'}` }, { status: 401 });
  }

  const creditState = await checkCredits(user.id);

  if (!creditState.allowed) {
    return Response.json(
      {
        error: '[RIDVAN-E011] No credits remaining',
        remaining: creditState.remaining,
        plan: creditState.plan,
      },
      { status: 403 },
    );
  }

  if (creditState.plan === 'free') {
    return Response.json({ error: '[RIDVAN-E014] Enhance requires a paid plan' }, { status: 403 });
  }

  const { message } = await request.json<{ message: string }>();

  try {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalOutputChars = 0;
    let hasUsageData = false;
    let deductionApplied = false;

    const result = await streamText(
      [
        {
          role: 'user',
          content: stripIndents`
          Improve the user prompt wrapped in \`<original_prompt>\` into a detailed, technical app specification.
          Keep the same language as the user's prompt.
          Expand vague requirements into specific implementation details:
          - features and behaviors
          - UI/UX expectations
          - data/state requirements
          - tech constraints and acceptance criteria

          IMPORTANT: Respond with only the improved prompt text. No preface, no explanation.

          <original_prompt>
            ${message}
          </original_prompt>
        `,
        },
      ],
      context.cloudflare.env,
      {
        onFinish: async (event) => {
          if (deductionApplied) {
            return;
          }

          deductionApplied = true;

          const { text, usage } = event as { text: string; usage?: unknown };
          totalOutputChars += text.length;

          const totals = getUsageTotals(usage);

          if (totals.hasUsage) {
            hasUsageData = true;
            totalInputTokens += totals.inputTokens;
            totalOutputTokens += totals.outputTokens;
          }

          const costCredits = hasUsageData
            ? Math.max(1, Math.ceil((totalInputTokens + totalOutputTokens) / 1000))
            : Math.max(1, Math.ceil(totalOutputChars / 2000)); // Fallback for streaming cases where token usage is unavailable.

          const enhanceCost = Math.max(15, costCredits);
          const deduction = await deductCredit(user.id, 'Prompt enhancement', enhanceCost);

          if (!deduction.success) {
            console.error('[RIDVAN-E012] Failed to deduct usage-based credits for enhancer');
          }
        },
      },
    );

    const transformStream = new TransformStream({
      transform(chunk, controller) {
        const processedChunk = decoder
          .decode(chunk)
          .split('\n')
          .filter((line) => line !== '')
          .map(parseStreamPart)
          .map((part) => part.value)
          .filter((value): value is string => typeof value === 'string')
          .join('');

        controller.enqueue(encoder.encode(processedChunk));
      },
    });

    const transformedStream = result.toAIStream().pipeThrough(transformStream);

    return new StreamingTextResponse(transformedStream);
  } catch (error) {
    console.log(error);

    throw new Response(null, {
      status: 500,
      statusText: 'Internal Server Error',
    });
  }
}
