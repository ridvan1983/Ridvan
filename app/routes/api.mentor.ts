import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { FEATURE_FLAGS } from '~/config/feature-flags';
import { getAPIKey } from '~/lib/.server/llm/api-key';
import { ensureBrainWorkspace } from '~/lib/brain/server';
import { readBrainContext } from '~/lib/brain/read.server';
import { deductCredit } from '~/lib/credits/deduct';
import { requireMentorAccess, noCreditsResponse } from '~/lib/mentor/access.server';
import { generateMentorAiResponse } from '~/lib/mentor/ai-response.server';
import { markMentorUnread, normalizeMentorEvents, writeAndIngestMentorEvents } from '~/lib/mentor/brain-events.server';
import {
  analyzeMentorAttachments,
  buildAttachmentPromptContext,
  type MentorAttachmentReference,
} from '~/lib/mentor/file-analysis.server';
import {
  appendMentorInsightTrailer,
  parseProactiveMentorStorage,
  splitMentorInsightTrailer,
  type MentorInsightPayload,
} from '~/lib/mentor/proactive-message';
import { buildMentorSystemPrompt } from '~/lib/mentor/prompt.server';
import { buildMentorOutputFormatOverride } from '~/lib/mentor/prompts.server';
import { buildCrossProjectMemorySummary } from '~/lib/mentor/cross-project-memory.server';
import {
  detectMentorDocumentIntent,
  formatMentorDocumentIntentSystemAddendum,
  shortMentorDocumentChatReplySv,
} from '~/lib/mentor/document-intent.server';
import {
  formatDeepMemoryForPrompt,
  MENTOR_DEEP_MEMORY_KEY,
  parseDeepMemory,
} from '~/lib/mentor/memory.server';
import { getOptionalServerEnv } from '~/lib/env.server';
import { captureError, logError } from '~/lib/server/monitoring.server';
import { supabaseAdmin } from '~/lib/supabase/server';
import { getVerticalContext } from '~/lib/vertical/context.server';
import type { BrainMemoryEntry, BrainProjectState } from '~/lib/brain/types';

type MentorMessageRow = {
  id: string;
  session_id: string | null;
  role: 'user' | 'mentor' | 'assistant';
  content: string;
  created_at: string;
};

function documentCreditCost(documentType: string) {
  const t = documentType.trim();
  if (t === 'business_plan') return 10;
  if (t === 'quarterly_budget') return 8;
  if (t === 'cashflow') return 8;
  if (t === 'investor_pitch') return 15;
  if (t === 'financial_analysis') return 12;
  if (t === 'marketing_plan') return 10;
  if (t === 'hr_policy') return 6;
  if (t === 'file_analysis') return 5;
  return 0;
}

function detectComplexity(message: string): 'opus' | 'sonnet' {
  const opusTriggers = [
    // Swedish
    'strategi',
    'plan',
    'roadmap',
    'prioritera',
    'beslut',
    'affärsplan',
    'budget',
    'cashflow',
    'prissättning',
    'finansiell',
    'investering',
    'lönsamhet',
    'avtal',
    'gdpr',
    'compliance',
    'juridik',
    'kontrakt',
    'arbetsrätt',
    'pitch',
    'investerare',
    'värdering',
    'term sheet',
    'kapitalbehov',
    'analysera',
    'jämför',
    'benchmark',
    'konkurrent',
    'marknadsanalys',
    'dokument',
    'rapport',
    'marknadsplan',
    // English
    'strategy',
    'roadmap',
    'decision',
    'business plan',
    'budget',
    'cashflow',
    'pricing',
    'financial',
    'investment',
    'profitability',
    'contract',
    'legal',
    'compliance',
    'gdpr',
    'law',
    'investor',
    'pitch',
    'valuation',
    'funding',
    'analyze',
    'compare',
    'competitor',
    'benchmark',
    'document',
    'report',
    'plan',
  ];
  const lower = message.toLowerCase();
  const isComplex = opusTriggers.some((trigger) => lower.includes(trigger));
  return isComplex ? 'opus' : 'sonnet';
}

function detectWebSearchNeeded(message: string) {
  const lower = message.toLowerCase();
  return [
    'konkurrent',
    'competitor',
    'marknad',
    'market',
    'lag',
    'regel',
    'law',
    'regulation',
    'trend',
    'bransch',
    'industry',
    'pris på marknaden',
    'market price',
  ].some((trigger) => lower.includes(trigger));
}

function detectMentorMaxTokens(message: string): number {
  const lower = message.toLowerCase();
  const longForm = ['analysera', 'fullständig', 'rapport', 'lista alla'].some((phrase) => lower.includes(phrase));
  return longForm ? 4096 : 1024;
}

function stripImplementationMarker(input: string) {
  return input.replace(/\[data-implement="true"[\s\S]*?\]$/m, '').trim();
}

function mentorContentSnippetForMemory(raw: string): string {
  const pr = parseProactiveMentorStorage(raw);
  const base = pr.triggerType ? pr.body : raw;
  const { visible } = splitMentorInsightTrailer(base);
  return stripImplementationMarker(visible).replace(/\s+/g, ' ').trim().slice(0, 420);
}

function summarizeProjectStatus(args: {
  projectTitle: string | null;
  snapshotSummary: {
    version: number | null;
    createdAt: string | null;
    title: string | null;
    totalFiles: number;
    sampleFiles: string[];
  } | null;
  brainState: BrainProjectState;
}) {
  const statusParts = [
    args.projectTitle ? `projektnamn ${args.projectTitle}` : null,
    args.brainState.currentStage ? `nuvarande fas ${args.brainState.currentStage}` : null,
    args.brainState.currentBusinessModel ? `affärsmodell ${args.brainState.currentBusinessModel}` : null,
    args.brainState.primaryGoalSummary ? `huvudmål ${args.brainState.primaryGoalSummary}` : null,
    args.brainState.topPrioritySummary ? `högsta prioritet ${args.brainState.topPrioritySummary}` : null,
    args.brainState.mainChallengeSummary ? `största utmaning ${args.brainState.mainChallengeSummary}` : null,
    args.snapshotSummary ? `senaste kod-snapshot finns (version ${args.snapshotSummary.version ?? 'okänd'})` : null,
  ].filter((value): value is string => Boolean(value));

  return statusParts.length > 0 ? statusParts.join(' · ') : 'projektet är nytt och fortfarande i ett tidigt skede';
}

function buildConversationMemory(messages: MentorMessageRow[]) {
  const cleaned = messages
    .map((message) => ({
      ...message,
      content: stripImplementationMarker(message.content).replace(/\s+/g, ' ').trim(),
    }))
    .filter((message) => message.content.length > 0);

  const latestFiveSummary = cleaned
    .slice(-5)
    .map((message) => `${message.role === 'user' ? 'Användaren' : 'Mentor'}: ${message.content.slice(0, 220)}`)
    .join('\n');

  const sessionIdsNewestFirst = Array.from(
    new Set(
      cleaned
        .slice()
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .map((message) => message.session_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ).slice(0, 5);

  const recentSessionSummaries = sessionIdsNewestFirst.map((sessionId) => {
    const sessionMessages = cleaned.filter((message) => message.session_id === sessionId).slice(-4);
    const summary = sessionMessages.map((message) => `${message.role === 'user' ? 'U' : 'M'}: ${message.content.slice(0, 140)}`).join(' | ');
    return `Session ${sessionId.slice(0, 8)}: ${summary}`;
  });

  const decisionRegex = /(vi beslutade|jag beslutade|du borde|mitt råd är|nästa steg är|we decided|you should|my recommendation is|next step is)[:\s]+([^.!?\n]+)/gi;
  const questionRegex = /([^.!?\n]+\?)/g;

  const importantDecisions = Array.from(
    new Set(
      cleaned.flatMap((message) => {
        const matches = Array.from(message.content.matchAll(decisionRegex));
        return matches.map((match) => match[2]?.trim()).filter((value): value is string => Boolean(value));
      }),
    ),
  ).slice(0, 8);

  const openQuestions = Array.from(
    new Set(
      cleaned
        .filter((message) => message.role !== 'user')
        .flatMap((message) => {
          const matches = message.content.match(questionRegex) ?? [];
          return matches.map((value) => value.trim());
        }),
    ),
  ).slice(-5);

  return {
    latestFiveSummary: latestFiveSummary || 'Inga tidigare mentor-samtal ännu.',
    recentSessionSummaries,
    importantDecisions,
    openQuestions,
  };
}

function buildBrainEventsSummary(activeEntries: BrainMemoryEntry[]) {
  return activeEntries
    .slice()
    .sort((a: BrainMemoryEntry, b: BrainMemoryEntry) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 6)
    .map((entry: BrainMemoryEntry) => entry.title ?? entry.summary ?? entry.entityKey)
    .filter((value: string): value is string => Boolean(value));
}

function replyImpliesBuilderWork(lower: string): boolean {
  if (/\b(lägg till|ta bort)\b/u.test(lower)) {
    return true;
  }
  if (
    /\b(implementera|fixa|skapa|ändra|uppdatera|bygga|refaktorera|omstrukturera|utöka|ersätt)\b/u.test(lower)
  ) {
    return true;
  }
  return /\b(implement|update|remove|create|refactor|build|add|fix)\b/i.test(lower);
}

function buildImplementationPrompt(reply: string, projectTitle: string | null) {
  const cleanReply = stripImplementationMarker(reply).replace(/\s+/g, ' ').trim();
  if (cleanReply.length < 24) {
    return null;
  }

  const lower = cleanReply.toLowerCase();
  if (!replyImpliesBuilderWork(lower)) {
    return null;
  }

  return `Implement this mentor recommendation in the existing codebase for ${projectTitle ?? 'the current project'}: ${cleanReply}. Make minimal additive changes, preserve existing behavior, avoid touching protected core files, and finish by summarizing exactly what was implemented.`;
}

function appendImplementationMarker(reply: string, projectTitle: string | null) {
  const prompt = buildImplementationPrompt(reply, projectTitle);
  if (!prompt) {
    return reply;
  }

  const escapedPrompt = prompt.replace(/"/g, '&quot;');
  return `${reply}\n\n[data-implement="true" data-prompt="${escapedPrompt}"]`;
}

function logMentorPerf(label: string, t0: number) {
  const ms = Math.round(performance.now() - t0);
  console.log(`[mentor:perf] ${label} ${ms}ms`);
  return performance.now();
}

type MentorApiLoaded = {
  workspace: Awaited<ReturnType<typeof ensureBrainWorkspace>>;
  brain: NonNullable<Awaited<ReturnType<typeof readBrainContext>>>;
  vertical: Awaited<ReturnType<typeof getVerticalContext>> | null;
  mentorHistoryRows: MentorMessageRow[];
  projectTitle: string | null;
  snapshotSummary: {
    version: number | null;
    createdAt: string | null;
    title: string | null;
    totalFiles: number;
    sampleFiles: string[];
  } | null;
  conversationMemory: ReturnType<typeof buildConversationMemory>;
  recentMentorReplySnippets: string[];
  projectStatusSummary: string;
  brainEventsSummary: string[];
  attachmentAnalyses: Awaited<ReturnType<typeof analyzeMentorAttachments>>;
  attachmentAnalysisContext: string | null;
  deepMemorySummary: string;
  crossProjectPatterns: string | null;
  acceptLanguage: string;
};

async function loadMentorApiContext(params: {
  user: { id: string };
  projectId: string;
  sessionId: string;
  attachments: MentorAttachmentReference[];
  request: Request;
  env: unknown;
}): Promise<MentorApiLoaded> {
  const acceptLanguage = params.request.headers.get('accept-language')?.split(',')[0]?.trim() ?? '';
  let t = performance.now();

  const [workspace, brain, mentorHistoryRes, projectSnapshotPair, userProjectCountRes, attachmentAnalyses] = await Promise.all([
    ensureBrainWorkspace(params.projectId, params.user.id),
    readBrainContext({ projectId: params.projectId, userId: params.user.id }),
    supabaseAdmin
      .from('mentor_messages')
      .select('id, session_id, role, content, created_at')
      .eq('project_id', params.projectId)
      .eq('user_id', params.user.id)
      .order('created_at', { ascending: true })
      .limit(200)
      .returns<MentorMessageRow[]>(),
    Promise.all([
      supabaseAdmin
        .from('projects')
        .select('id, user_id, title')
        .eq('id', params.projectId)
        .eq('user_id', params.user.id)
        .maybeSingle<{ id: string; user_id: string; title: string | null }>(),
      supabaseAdmin
        .from('project_snapshots')
        .select('files, title, version, created_at')
        .eq('project_id', params.projectId)
        .eq('user_id', params.user.id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle<{ files: Record<string, string>; title: string | null; version: number; created_at: string }>(),
    ]),
    supabaseAdmin.from('projects').select('id', { count: 'exact', head: true }).eq('user_id', params.user.id),
    params.attachments.length > 0
      ? analyzeMentorAttachments(params.attachments).catch((error) => {
          const messageText = error instanceof Error ? error.message : String(error ?? 'unknown error');
          captureError(error, {
            route: 'api.mentor',
            userId: params.user.id,
            extra: { stage: 'attachment_analysis', projectId: params.projectId, attachmentCount: params.attachments.length },
          });
          logError(messageText, {
            route: 'mentor',
            userId: params.user.id,
            stack: error instanceof Error ? error.stack : undefined,
            metadata: { stage: 'attachment_analysis', projectId: params.projectId, attachmentCount: params.attachments.length },
          });
          console.error('[RIDVAN-ATTACHMENT] api.mentor:attachment_analysis_failed', {
            projectId: params.projectId,
            attachmentCount: params.attachments.length,
            error: messageText,
          });
          return params.attachments.map((attachment) => ({
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            extractedText: attachment.extractedText ?? null,
            documentKind: 'general' as const,
            expertRole: 'CEO — generell analys',
            readError:
              'Attachment analysis crashed before completion. Use filename only and state clearly that full file content was unavailable.',
            contentParts: [
              {
                type: 'text',
                text: `Filename: ${attachment.filename}\nMime type: ${attachment.mimeType}\nDetected mode: general\nRead status: Attachment analysis crashed before completion. Use filename and any provided text only.`,
              },
            ],
          }));
        })
      : Promise.resolve([] as Awaited<ReturnType<typeof analyzeMentorAttachments>>),
  ]);

  console.log('[mentor] after db', Date.now());

  logMentorPerf('parallel_io_batch_1', t);
  t = performance.now();

  if (!brain) {
    throw new Error('[RIDVAN-E852] Brain state not found');
  }

  const vertical = await getVerticalContext({
    projectId: params.projectId,
    userId: params.user.id,
    language: params.request.headers.get('accept-language'),
    env: params.env as Env,
    brain,
    mentorFastPath: true,
  }).catch(() => null);

  logMentorPerf('vertical_context_mentor_fast', t);
  t = performance.now();

  let crossProjectPatterns: string | null = null;
  if ((userProjectCountRes.count ?? 0) >= 2) {
    crossProjectPatterns = await buildCrossProjectMemorySummary({
      userId: params.user.id,
      currentProjectId: params.projectId,
    }).catch(() => null);
  }
  logMentorPerf('cross_project_optional', t);

  const mentorHistoryRows = mentorHistoryRes.data ?? [];
  let conversationMemory = buildConversationMemory([]);
  try {
    conversationMemory = buildConversationMemory(mentorHistoryRows);
  } catch {
    conversationMemory = buildConversationMemory([]);
  }

  const mentorAssistantRows = mentorHistoryRows.filter((r) => r.role === 'mentor');
  const recentMentorReplySnippets = mentorAssistantRows.slice(-5).map((r) => mentorContentSnippetForMemory(r.content));

  const [{ data: projectRow }, { data: snapshotRow }] = projectSnapshotPair;
  const projectTitle = projectRow?.title ?? null;
  const snapshotTitle = snapshotRow?.title ?? null;
  const snapshotFiles = snapshotRow?.files ?? null;
  const snapshotFileNames = snapshotFiles ? Object.keys(snapshotFiles) : [];
  const snapshotSummary = snapshotFiles
    ? {
        version: snapshotRow?.version ?? null,
        createdAt: snapshotRow?.created_at ?? null,
        title: snapshotTitle,
        totalFiles: snapshotFileNames.length,
        sampleFiles: snapshotFileNames.slice(0, 25),
      }
    : null;

  let projectStatusSummary = 'projektet är nytt och fortfarande i ett tidigt skede';
  let brainEventsSummary: string[] = [];
  try {
    projectStatusSummary = summarizeProjectStatus({ projectTitle, snapshotSummary, brainState: brain.state });
    brainEventsSummary = buildBrainEventsSummary(brain.activeEntries);
  } catch {
    projectStatusSummary = 'projektet är nytt och fortfarande i ett tidigt skede';
    brainEventsSummary = [];
  }

  const attachmentAnalysisContext = buildAttachmentPromptContext(attachmentAnalyses);
  const signalsForMemory = brain.state.currentSignals as Record<string, unknown> | undefined;
  const deepMemorySummary = formatDeepMemoryForPrompt(parseDeepMemory(signalsForMemory?.[MENTOR_DEEP_MEMORY_KEY]));

  return {
    workspace,
    brain,
    vertical,
    mentorHistoryRows,
    projectTitle,
    snapshotSummary,
    conversationMemory,
    recentMentorReplySnippets,
    projectStatusSummary,
    brainEventsSummary,
    attachmentAnalyses,
    attachmentAnalysisContext,
    deepMemorySummary,
    crossProjectPatterns,
    acceptLanguage,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  console.log('[mentor] start', Date.now());

  const access = await requireMentorAccess({ request, context });
  if (!access.ok) {
    return access.response;
  }

  console.log('[mentor] after auth', Date.now());

  const { user, projectId, message, sessionId, systemInstruction, attachments, stream } = access.value;

  const loadParams = {
    user,
    projectId,
    sessionId,
    attachments,
    request,
    env: context.cloudflare.env,
  };

  if (stream) {
    const encoder = new TextEncoder();
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

        let loaded: MentorApiLoaded;
        try {
          const mark = performance.now();
          loaded = await loadMentorApiContext(loadParams);
          logMentorPerf('loadMentorApiContext_total', mark);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e ?? 'Unknown error');
          if (msg.includes('RIDVAN-E852')) {
            send({ t: 'error', error: msg });
          } else {
            send({ t: 'error', error: msg });
          }
          controller.close();
          return;
        }

        const {
          workspace,
          brain,
          vertical,
          projectTitle,
          snapshotSummary,
          conversationMemory,
          recentMentorReplySnippets,
          projectStatusSummary,
          brainEventsSummary,
          attachmentAnalyses,
          attachmentAnalysisContext,
          deepMemorySummary,
          crossProjectPatterns,
          acceptLanguage,
        } = loaded;

        const complexity = attachmentAnalyses.length > 0 ? 'opus' : detectComplexity(message);
        const needsWebSearch = detectWebSearchNeeded(message);
        const mentorMaxTokens = detectMentorMaxTokens(message);
        const modelId = complexity === 'opus' ? 'claude-opus-4-5-20251101' : 'claude-sonnet-4-5-20250929';
        const apiKey = getAPIKey(context.cloudflare.env) ?? '';
        const searchApiKey = getOptionalServerEnv('SEARCH_API_KEY', context.cloudflare?.env) ?? null;

        try {
          const baseSystem = buildMentorSystemPrompt({
            state: brain.state,
            industryProfile: brain.industryProfile,
            geoProfile: brain.geoProfile,
            activeEntries: brain.activeEntries,
            verticalContext: vertical
              ? {
                  expectedBusinessModel: vertical.expectedBusinessModel,
                  revenueDrivers: vertical.revenueDrivers,
                  failurePatterns: vertical.failurePatterns,
                  modules: vertical.modules,
                  geoNotes: vertical.geoNotes.join(' | '),
                  insights: vertical.insights.map((item) => `${item.problem} — ${item.action}`),
                }
              : null,
            projectTitle,
            companyName: projectTitle,
            memorySummary: conversationMemory.latestFiveSummary,
            recentSessionSummaries: conversationMemory.recentSessionSummaries,
            priorDecisions: conversationMemory.importantDecisions,
            openQuestions: conversationMemory.openQuestions,
            projectStatusSummary,
            brainEventsSummary,
            attachmentAnalysisContext,
            latestSnapshotSummary: snapshotSummary,
            modelHint: complexity,
            recentMentorReplySnippets,
            deepMemorySummary,
            crossProjectPatterns,
            languageHint: acceptLanguage,
          });
          const systemCore = systemInstruction
            ? `${baseSystem}

ONE-OFF SYSTEM INSTRUCTION:
${systemInstruction}`
            : baseSystem;
          const docIntentAddendum =
            FEATURE_FLAGS.documentGeneration
              ? formatMentorDocumentIntentSystemAddendum(detectMentorDocumentIntent(message))
              : '';
          const system = `${systemCore}${docIntentAddendum ? `\n\n${docIntentAddendum}` : ''}\n\n${buildMentorOutputFormatOverride()}`;

          console.log('[mentor] after prompt build', Date.now());
          send({ t: 'started' });
          console.log('[mentor] after first sse', Date.now());

          const finalizeMentorReply = async (generated: {
            reply: string;
            events: Array<{ type: string; payload: Record<string, unknown>; idempotencyKey?: string | null; source?: unknown }>;
            rawText: string;
            insight: MentorInsightPayload | null;
          }) => {
            const events = normalizeMentorEvents(generated.events);
            let baseReply = generated.reply;
            if (FEATURE_FLAGS.documentGeneration && events.some((e) => e.type === 'document.ready')) {
              const docEv = events.find((e) => e.type === 'document.ready');
              const p = (docEv?.payload ?? {}) as Record<string, unknown>;
              const dt = typeof p.documentType === 'string' ? p.documentType : 'other';
              baseReply = shortMentorDocumentChatReplySv(dt);
            }

            let reply = appendMentorInsightTrailer(baseReply, generated.insight ?? null);
            try {
              reply = appendImplementationMarker(reply, projectTitle);
            } catch {
              reply = appendMentorInsightTrailer(baseReply, generated.insight ?? null);
            }

            try {
              await writeAndIngestMentorEvents({
                workspaceId: workspace.id,
                projectId,
                userId: user.id,
                events,
              });
            } catch (error) {
              const messageText = error instanceof Error ? error.message : String(error ?? 'Unknown error');
              logError(messageText, {
                route: 'mentor',
                userId: user.id,
                stack: error instanceof Error ? error.stack : undefined,
                metadata: { stage: 'writeAndIngestMentorEvents', projectId },
              });
              return { ok: false as const, error: messageText, reply, events, insight: generated.insight ?? null };
            }

            const shouldChargeReply = reply.trim().length > 0;
            if (shouldChargeReply) {
              const deduction = await deductCredit(user.id, 'Mentor reply', 1);
              if (!deduction.success) {
                return { ok: false as const, error: 'RIDVAN_NO_CREDITS', reply, events, noCredits: true as const, insight: generated.insight ?? null };
              }
            }

            await markMentorUnread({ userId: user.id, projectId, reply, eventCount: events.length });

            return { ok: true as const, reply, events, insight: generated.insight ?? null };
          };

          let generated: Awaited<ReturnType<typeof generateMentorAiResponse>>;
          try {
            generated = await generateMentorAiResponse({
              apiKey,
              modelId,
              system,
              message,
              maxTokens: mentorMaxTokens,
              needsWebSearch,
              searchApiKey,
              onSearchStatus: async ({ query, reason }) => {
                send({ t: 'search', query, reason });
              },
              attachmentAnalyses,
              attachmentAnalysisContext,
              onStreamDelta: (chunk) => {
                send({ t: 'delta', d: chunk });
              },
            });
          } catch (error) {
            const messageText = error instanceof Error ? error.message : String(error ?? 'Unknown error');
            const [safeMessage, raw = ''] = messageText.split('||RAW||');
            logError(safeMessage, {
              route: 'mentor',
              userId: user.id,
              stack: error instanceof Error ? error.stack : undefined,
              metadata: { stage: 'generateMentorAiResponse', projectId, rawSnippet: raw.slice(0, 2000) },
            });
            send({ t: 'error', error: safeMessage, raw });
            controller.close();
            return;
          }

          const finalized = await finalizeMentorReply(generated);
          if (!finalized.ok) {
            if ('noCredits' in finalized && finalized.noCredits) {
              send({
                t: 'error',
                error: 'RIDVAN_NO_CREDITS',
                message: 'Du har inga krediter kvar. Uppgradera till PRO för obegränsad access.',
              });
            } else {
              send({ t: 'error', error: finalized.error ?? 'Mentor finalize failed', reply: finalized.reply });
            }
            controller.close();
            return;
          }

          send({
            t: 'done',
            reply: finalized.reply,
            insight: finalized.insight ?? null,
            events: finalized.events,
            eventsWritten: finalized.events.length,
          });
          controller.close();
        } catch (outer) {
          const messageText = outer instanceof Error ? outer.message : String(outer ?? 'Unknown error');
          send({ t: 'error', error: messageText });
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  let loaded: MentorApiLoaded;
  try {
    let mark = performance.now();
    loaded = await loadMentorApiContext(loadParams);
    logMentorPerf('loadMentorApiContext_total_non_stream', mark);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? 'Unknown error');
    if (msg.includes('RIDVAN-E852')) {
      return Response.json({ error: msg }, { status: 404 });
    }
    throw e;
  }

  const {
    workspace,
    brain,
    vertical,
    projectTitle,
    snapshotSummary,
    conversationMemory,
    recentMentorReplySnippets,
    projectStatusSummary,
    brainEventsSummary,
    attachmentAnalyses,
    attachmentAnalysisContext,
    deepMemorySummary,
    crossProjectPatterns,
    acceptLanguage,
  } = loaded;

  const complexity = attachmentAnalyses.length > 0 ? 'opus' : detectComplexity(message);
  const needsWebSearch = detectWebSearchNeeded(message);
  const mentorMaxTokens = detectMentorMaxTokens(message);
  const modelId = complexity === 'opus' ? 'claude-opus-4-5-20251101' : 'claude-sonnet-4-5-20250929';
  const apiKey = getAPIKey(context.cloudflare.env) ?? '';
  const searchApiKey = getOptionalServerEnv('SEARCH_API_KEY', context.cloudflare?.env) ?? null;

  const baseSystem = buildMentorSystemPrompt({
    state: brain.state,
    industryProfile: brain.industryProfile,
    geoProfile: brain.geoProfile,
    activeEntries: brain.activeEntries,
    verticalContext: vertical
      ? {
          expectedBusinessModel: vertical.expectedBusinessModel,
          revenueDrivers: vertical.revenueDrivers,
          failurePatterns: vertical.failurePatterns,
          modules: vertical.modules,
          geoNotes: vertical.geoNotes.join(' | '),
          insights: vertical.insights.map((item) => `${item.problem} — ${item.action}`),
        }
      : null,
    projectTitle,
    companyName: projectTitle,
    memorySummary: conversationMemory.latestFiveSummary,
    recentSessionSummaries: conversationMemory.recentSessionSummaries,
    priorDecisions: conversationMemory.importantDecisions,
    openQuestions: conversationMemory.openQuestions,
    projectStatusSummary,
    brainEventsSummary,
    attachmentAnalysisContext,
    latestSnapshotSummary: snapshotSummary,
    modelHint: complexity,
    recentMentorReplySnippets,
    deepMemorySummary,
    crossProjectPatterns,
    languageHint: acceptLanguage,
  });
  const systemCore = systemInstruction
    ? `${baseSystem}

ONE-OFF SYSTEM INSTRUCTION:
${systemInstruction}`
    : baseSystem;
  const docIntentAddendum =
    FEATURE_FLAGS.documentGeneration
      ? formatMentorDocumentIntentSystemAddendum(detectMentorDocumentIntent(message))
      : '';
  const system = `${systemCore}${docIntentAddendum ? `\n\n${docIntentAddendum}` : ''}\n\n${buildMentorOutputFormatOverride()}`;

  console.log('[mentor] after prompt build', Date.now());

  const finalizeMentorReply = async (generated: {
    reply: string;
    events: Array<{ type: string; payload: Record<string, unknown>; idempotencyKey?: string | null; source?: unknown }>;
    rawText: string;
    insight: MentorInsightPayload | null;
  }) => {
    const events = normalizeMentorEvents(generated.events);
    let baseReply = generated.reply;
    if (FEATURE_FLAGS.documentGeneration && events.some((e) => e.type === 'document.ready')) {
      const docEv = events.find((e) => e.type === 'document.ready');
      const p = (docEv?.payload ?? {}) as Record<string, unknown>;
      const dt = typeof p.documentType === 'string' ? p.documentType : 'other';
      baseReply = shortMentorDocumentChatReplySv(dt);
    }

    let reply = appendMentorInsightTrailer(baseReply, generated.insight ?? null);
    try {
      reply = appendImplementationMarker(reply, projectTitle);
    } catch {
      reply = appendMentorInsightTrailer(baseReply, generated.insight ?? null);
    }

    try {
      await writeAndIngestMentorEvents({
        workspaceId: workspace.id,
        projectId,
        userId: user.id,
        events,
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error ?? 'Unknown error');
      logError(messageText, {
        route: 'mentor',
        userId: user.id,
        stack: error instanceof Error ? error.stack : undefined,
        metadata: { stage: 'writeAndIngestMentorEvents', projectId },
      });
      return { ok: false as const, error: messageText, reply, events, insight: generated.insight ?? null };
    }

    const shouldChargeReply = reply.trim().length > 0;
    if (shouldChargeReply) {
      const deduction = await deductCredit(user.id, 'Mentor reply', 1);
      if (!deduction.success) {
        return { ok: false as const, error: 'RIDVAN_NO_CREDITS', reply, events, noCredits: true as const, insight: generated.insight ?? null };
      }
    }

    await markMentorUnread({ userId: user.id, projectId, reply, eventCount: events.length });

    return { ok: true as const, reply, events, insight: generated.insight ?? null };
  };

  let generated: {
    reply: string;
    events: Array<{ type: string; payload: Record<string, unknown>; idempotencyKey?: string | null; source?: unknown }>;
    rawText: string;
    insight: MentorInsightPayload | null;
  };
  try {
    generated = await generateMentorAiResponse({
      apiKey,
      modelId,
      system,
      message,
      maxTokens: mentorMaxTokens,
      needsWebSearch,
      searchApiKey,
      attachmentAnalyses,
      attachmentAnalysisContext,
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error ?? 'Unknown error');
    const [safeMessage, raw = ''] = messageText.split('||RAW||');
    logError(safeMessage, {
      route: 'mentor',
      userId: user.id,
      stack: error instanceof Error ? error.stack : undefined,
      metadata: { stage: 'generateMentorAiResponse', projectId, rawSnippet: raw.slice(0, 2000) },
    });
    return Response.json({ error: safeMessage, raw }, { status: 500 });
  }

  const finalized = await finalizeMentorReply(generated);
  if (!finalized.ok) {
    if ('noCredits' in finalized && finalized.noCredits) {
      return noCreditsResponse();
    }
    return Response.json({ error: finalized.error, reply: finalized.reply }, { status: 500 });
  }

  return Response.json({
    reply: finalized.reply,
    insight: finalized.insight ?? null,
    events: finalized.events,
    eventsWritten: finalized.events.length,
  });
}
