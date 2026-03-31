import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText as aiStreamText, convertToCoreMessages } from 'ai';
import { parseMentorJson } from '~/lib/mentor/parse.server';
import { MAX_TOKENS } from '~/lib/.server/llm/constants';

export type MentorPromptAttachmentAnalysis = {
  contentParts: Array<Record<string, unknown>>;
};

export type ParsedMentorEvent = {
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string | null;
  source?: unknown;
};

export async function generateMentorAiResponse(args: {
  apiKey: string;
  modelId: string;
  system: string;
  message: string;
  needsWebSearch: boolean;
  attachmentAnalyses: MentorPromptAttachmentAnalysis[];
  attachmentAnalysisContext: string | null;
}) {
  const anthropic = createAnthropic({ apiKey: args.apiKey });
  let finalText = '';

  const userContent: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text:
        args.attachmentAnalyses.length > 0
          ? `User request: ${args.message}\n\nAttached file context:\n${args.attachmentAnalysisContext ?? 'none'}`
          : args.message,
    },
  ];

  for (const analysis of args.attachmentAnalyses) {
    userContent.push(...analysis.contentParts);
  }

  const result = await aiStreamText({
    model: anthropic(args.modelId),
    system: args.system,
    maxTokens: MAX_TOKENS,
    temperature: 0.5,
    headers: {
      'anthropic-beta': 'max-tokens-3-5-sonnet-2024-07-15',
    },
    tools: args.needsWebSearch ? ([{ type: 'web_search_20250305', name: 'web_search' }] as any) : undefined,
    messages: convertToCoreMessages([
      {
        role: 'user',
        content: userContent as any,
      },
    ]),
    onFinish: async (event) => {
      const { text } = event as { text: string };
      finalText = text;
    },
  });

  await drainReadableStream(result.toAIStream());

  try {
    const parsed = parseMentorJson(finalText);
    return {
      reply: parsed.reply,
      events: Array.isArray(parsed.events) ? (parsed.events as ParsedMentorEvent[]) : [],
      rawText: finalText,
    };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error ?? 'Unknown error');
    throw new Error(`[RIDVAN-E853] Failed to parse Mentor output: ${messageText}||RAW||${finalText}`);
  }
}

async function drainReadableStream(stream: ReadableStream) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) {
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
