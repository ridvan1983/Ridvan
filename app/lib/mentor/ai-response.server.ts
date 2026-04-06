import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, streamText as aiStreamText, convertToCoreMessages } from 'ai';
import { parseMentorUnifiedOutput } from '~/lib/mentor/parse.server';
import { createMentorSearchWebTool, type MentorSearchStatus } from '~/lib/mentor/research.server';

export type MentorPromptAttachmentAnalysis = {
  contentParts: Array<Record<string, unknown>>;
};

export type ParsedMentorEvent = {
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string | null;
  source?: unknown;
};

const ANTHROPIC_BETA_HEADERS = {
  'anthropic-beta': 'max-tokens-3-5-sonnet-2024-07-15',
};

export async function generateMentorAiResponse(args: {
  apiKey: string;
  modelId: string;
  system: string;
  message: string;
  /** Default 1024; api.mentor raises to 4096 for long-form analysis requests. */
  maxTokens?: number;
  needsWebSearch: boolean;
  /** When set, Mentor uses `search_web` tool (Serper) and decides when to search. */
  searchApiKey?: string | null;
  onSearchStatus?: (status: MentorSearchStatus) => void | Promise<void>;
  attachmentAnalyses: MentorPromptAttachmentAnalysis[];
  attachmentAnalysisContext: string | null;
  onStreamDelta?: (chunk: string) => void | Promise<void>;
}) {
  const maxTokens = args.maxTokens ?? 1024;
  const anthropic = createAnthropic({ apiKey: args.apiKey });

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

  const messages = convertToCoreMessages([
    {
      role: 'user',
      content: userContent as any,
    },
  ]);

  const model = anthropic(args.modelId);

  const streamOut = async (full: string) => {
    if (!args.onStreamDelta || !full) {
      return;
    }
    const step = 64;
    for (let i = 0; i < full.length; i += step) {
      await args.onStreamDelta(full.slice(i, i + step));
    }
  };

  const searchKey = args.searchApiKey?.trim();
  if (searchKey) {
    const tools = createMentorSearchWebTool({
      searchApiKey: searchKey,
      onSearchStatus: args.onSearchStatus,
    });

    const result = await generateText({
      model,
      system: args.system,
      maxTokens,
      temperature: 0.5,
      headers: ANTHROPIC_BETA_HEADERS,
      tools,
      maxToolRoundtrips: 4,
      messages,
    });

    const finalText = result.text ?? '';
    await streamOut(finalText);

    try {
      const parsed = parseMentorUnifiedOutput(finalText);
      return {
        reply: parsed.reply,
        events: Array.isArray(parsed.events) ? (parsed.events as ParsedMentorEvent[]) : [],
        insight: parsed.insight ?? null,
        rawText: finalText,
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error ?? 'Unknown error');
      throw new Error(`[RIDVAN-E853] Failed to parse Mentor output: ${messageText}||RAW||${finalText}`);
    }
  }

  const result = await aiStreamText({
    model,
    system: args.system,
    maxTokens,
    temperature: 0.5,
    headers: ANTHROPIC_BETA_HEADERS,
    tools: args.needsWebSearch ? ([{ type: 'web_search_20250305', name: 'web_search' }] as any) : undefined,
    messages,
  });

  let finalText = '';
  if (args.onStreamDelta) {
    const reader = result.textStream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (typeof value === 'string' && value.length > 0) {
          finalText += value;
          await args.onStreamDelta(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
    finalText = (await result.text) || finalText;
  } else {
    await drainReadableStream(result.toAIStream());
    finalText = await result.text;
  }

  try {
    const parsed = parseMentorUnifiedOutput(finalText);
    return {
      reply: parsed.reply,
      events: Array.isArray(parsed.events) ? (parsed.events as ParsedMentorEvent[]) : [],
      insight: parsed.insight ?? null,
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
