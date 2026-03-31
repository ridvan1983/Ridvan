import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { getAPIKey } from '~/lib/.server/llm/api-key';
import { ensureBrainWorkspace } from '~/lib/brain/server';
import { readBrainContext } from '~/lib/brain/read.server';
import { deductCredit } from '~/lib/credits/deduct';
import { requireMentorAccess, noCreditsResponse } from '~/lib/mentor/access.server';
import { generateMentorAiResponse } from '~/lib/mentor/ai-response.server';
import { markMentorUnread, normalizeMentorEvents, writeAndIngestMentorEvents } from '~/lib/mentor/brain-events.server';
import { analyzeMentorAttachments, buildAttachmentPromptContext, type MentorAttachmentReference } from '~/lib/mentor/file-analysis.server';
import { buildMentorSystemPrompt } from '~/lib/mentor/prompt.server';
import { captureError } from '~/lib/server/monitoring.server';
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

function buildProactiveIntelligenceSection(vertical: Awaited<ReturnType<typeof getVerticalContext>> | null) {
  if (!vertical) {
    return '';
  }

  const opportunities = (vertical.revenueDrivers ?? []).slice(0, 3);
  const risks = (vertical.failurePatterns ?? []).slice(0, 3);

  if (opportunities.length === 0 && risks.length === 0) {
    return '';
  }

  const opportunitiesBlock = opportunities.length
    ? opportunities.map((item, index) => `${index + 1}. ${item.driver}${item.lever ? ` — ${item.lever}` : ''}`).join('\n')
    : '1. Inga tydliga möjligheter ännu.';

  const risksBlock = risks.length
    ? risks.map((item, index) => `${index + 1}. ${item.pattern}${item.fast_fix ? ` — ${item.fast_fix}` : ''}`).join('\n')
    : '1. Inga tydliga risker ännu.';

  return `🎯 Intelligence för ditt projekt:\n\n**3 möjligheter:**\n${opportunitiesBlock}\n\n**3 risker att undvika:**\n${risksBlock}`;
}

function stripImplementationMarker(input: string) {
  return input.replace(/\[data-implement="true"[\s\S]*?\]$/m, '').trim();
}

function pickUserLanguage(message: string, acceptLanguage: string | null) {
  const lower = message.toLowerCase();
  const swedishSignals = [' jag ', ' du ', ' det ', ' och ', ' inte ', ' ska ', 'bolag', 'företag', 'kund'];
  if (swedishSignals.some((signal) => lower.includes(signal.trim()) || lower.includes(signal))) {
    return 'svenska';
  }

  if ((acceptLanguage ?? '').toLowerCase().includes('sv')) {
    return 'svenska';
  }

  return 'english';
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
    args.snapshotSummary ? `senaste snapshot version ${args.snapshotSummary.version ?? 'okänd'} med ${args.snapshotSummary.totalFiles} filer` : null,
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

  const latestTenSummary = cleaned
    .slice(-10)
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
    latestTenSummary: latestTenSummary || 'Inga tidigare mentor-samtal ännu.',
    recentSessionSummaries,
    importantDecisions,
    openQuestions,
  };
}

async function buildPersonalizedWelcome(args: {
  projectTitle: string | null;
  industryLabel: string;
  geoLabel: string;
  projectStatusSummary: string;
  conversationMemory: ReturnType<typeof buildConversationMemory>;
  brainEventsSummary: string[];
  requestLanguage: string;
}) {
  const company = args.projectTitle ?? 'bolaget';
  const brainEventText = args.brainEventsSummary.length > 0 ? args.brainEventsSummary.join(' | ') : 'inga större nya händelser ännu';
  const latestDecision = args.conversationMemory.importantDecisions[0] ?? null;
  const latestOpenQuestion = args.conversationMemory.openQuestions[args.conversationMemory.openQuestions.length - 1] ?? null;

  if (args.requestLanguage === 'svenska') {
    return [
      `Hej! Jag har tänkt på ${company} sedan sist.`,
      `Det jag ser nu är ${args.projectStatusSummary} i ${args.industryLabel} med fokus på ${args.geoLabel}.`,
      `Det tydligaste jag reagerar på är ${brainEventText}${latestDecision ? `, särskilt eftersom ni redan lutat åt ${latestDecision}` : ''}.`,
      `Idag hade jag prioriterat ett konkret steg som flyttar intäkt eller minskar risk direkt innan ni bygger mer.${latestOpenQuestion ? ` Senast lämnade vi också frågan öppen: ${latestOpenQuestion}` : ''}`,
      'Vad vill du fokusera på?',
    ].join(' ');
  }

  return [
    `Hi! I've been thinking about ${company} since last time.`,
    `What I see right now is ${args.projectStatusSummary} in ${args.industryLabel} with focus on ${args.geoLabel}.`,
    `The clearest signal is ${brainEventText}${latestDecision ? `, especially because you were already leaning toward ${latestDecision}` : ''}.`,
    `Today I would prioritize one concrete move that either drives revenue or lowers risk before building more.${latestOpenQuestion ? ` We also left this open last time: ${latestOpenQuestion}` : ''}`,
    'What do you want to focus on?',
  ].join(' ');
}

function buildBrainEventsSummary(activeEntries: BrainMemoryEntry[]) {
  return activeEntries
    .slice()
    .sort((a: BrainMemoryEntry, b: BrainMemoryEntry) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 6)
    .map((entry: BrainMemoryEntry) => entry.title ?? entry.summary ?? entry.entityKey)
    .filter((value: string): value is string => Boolean(value));
}

function buildImplementationPrompt(reply: string, projectTitle: string | null) {
  const cleanReply = stripImplementationMarker(reply).replace(/\s+/g, ' ').trim();
  if (!cleanReply) {
    return null;
  }

  const implementationSignals = [
    'implementera',
    'lägg till',
    'ändra',
    'bygg',
    'fixa',
    'skapa',
    'add',
    'update',
    'implement',
    'create',
    'fix',
    'remove',
  ];

  const lower = cleanReply.toLowerCase();
  const shouldImplement = implementationSignals.some((signal) => lower.includes(signal));

  if (!shouldImplement) {
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

export async function action({ context, request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const access = await requireMentorAccess({ request, context });
  if (!access.ok) {
    return access.response;
  }

  const { user, projectId, message, sessionId, systemInstruction, attachments } = access.value;

  const workspace = await ensureBrainWorkspace(projectId, user.id);
  const brain = await readBrainContext({ projectId, userId: user.id });

  if (!brain) {
    return Response.json({ error: '[RIDVAN-E852] Brain state not found' }, { status: 404 });
  }

  const vertical = await getVerticalContext({
    projectId,
    userId: user.id,
    language: request.headers.get('accept-language'),
    env: context.cloudflare.env,
  }).catch(() => null);

  const { data: mentorHistoryRows } = await supabaseAdmin
    .from('mentor_messages')
    .select('id, session_id, role, content, created_at')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(200)
    .returns<MentorMessageRow[]>();

  let conversationMemory = buildConversationMemory([]);
  try {
    conversationMemory = buildConversationMemory(mentorHistoryRows ?? []);
  } catch {
    conversationMemory = buildConversationMemory([]);
  }

  const { count: existingAssistantMessagesCount } = await supabaseAdmin
    .from('mentor_messages')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .eq('session_id', sessionId)
    .eq('role', 'assistant');

  const [{ data: projectRow }, { data: snapshotRow }] = await Promise.all([
    supabaseAdmin
      .from('projects')
      .select('id, user_id, title')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .maybeSingle<{ id: string; user_id: string; title: string | null }>(),
    supabaseAdmin
      .from('project_snapshots')
      .select('files, title, version, created_at')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle<{ files: Record<string, string>; title: string | null; version: number; created_at: string }>(),
  ]);

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
  const requestLanguage = pickUserLanguage(message, request.headers.get('accept-language'));
  let projectStatusSummary = 'projektet är nytt och fortfarande i ett tidigt skede';
  let brainEventsSummary: string[] = [];
  try {
    projectStatusSummary = summarizeProjectStatus({ projectTitle, snapshotSummary, brainState: brain.state });
    brainEventsSummary = buildBrainEventsSummary(brain.activeEntries);
  } catch {
    projectStatusSummary = 'projektet är nytt och fortfarande i ett tidigt skede';
    brainEventsSummary = [];
  }
  const industryLabel = brain.industryProfile?.normalizedIndustry ?? 'okänd bransch';
  const geoLabel = brain.geoProfile?.city
    ? `${brain.geoProfile.city}, ${brain.geoProfile.countryCode}`
    : brain.geoProfile?.countryCode ?? 'okänd marknad';

  let attachmentAnalyses: Awaited<ReturnType<typeof analyzeMentorAttachments>> = [];
  let attachmentAnalysisContext: string | null = null;

  try {
    attachmentAnalyses = attachments.length > 0 ? await analyzeMentorAttachments(attachments) : [];
    attachmentAnalysisContext = buildAttachmentPromptContext(attachmentAnalyses);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error ?? 'unknown error');
    captureError(error, {
      route: 'api.mentor',
      userId: user.id,
      extra: { stage: 'attachment_analysis', projectId, attachmentCount: attachments.length },
    });
    console.error('[RIDVAN-ATTACHMENT] api.mentor:attachment_analysis_failed', {
      projectId,
      attachmentCount: attachments.length,
      error: messageText,
    });

    attachmentAnalyses = attachments.map((attachment) => ({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      extractedText: attachment.extractedText ?? null,
      documentKind: 'general' as const,
      expertRole: 'CEO — generell analys',
      readError: 'Attachment analysis crashed before completion. Use filename only and state clearly that full file content was unavailable.',
      contentParts: [
        {
          type: 'text',
          text: `Filename: ${attachment.filename}\nMime type: ${attachment.mimeType}\nDetected mode: general\nRead status: Attachment analysis crashed before completion. Use filename and any provided text only.`,
        },
      ],
    }));

    attachmentAnalysisContext = buildAttachmentPromptContext(attachmentAnalyses);
  }

  const complexity = attachmentAnalyses.length > 0 ? 'opus' : detectComplexity(message);
  const needsWebSearch = detectWebSearchNeeded(message);
  const modelId =
    complexity === 'opus' ? 'claude-opus-4-5-20251101' : 'claude-sonnet-4-5-20250929';

  const apiKey = getAPIKey(context.cloudflare.env) ?? '';

  {
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
      memorySummary: conversationMemory.latestTenSummary,
      recentSessionSummaries: conversationMemory.recentSessionSummaries,
      priorDecisions: conversationMemory.importantDecisions,
      openQuestions: conversationMemory.openQuestions,
      projectStatusSummary,
      brainEventsSummary,
      attachmentAnalysisContext,
      latestSnapshotSummary: snapshotSummary,
      modelHint: complexity,
    });
    const system = systemInstruction ? `${baseSystem}

ONE-OFF SYSTEM INSTRUCTION:
${systemInstruction}` : baseSystem;
    let generated: { reply: string; events: Array<{ type: string; payload: Record<string, unknown>; idempotencyKey?: string | null; source?: unknown }>; rawText: string };
    try {
      generated = await generateMentorAiResponse({
        apiKey,
        modelId,
        system,
        message,
        needsWebSearch,
        attachmentAnalyses,
        attachmentAnalysisContext,
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error ?? 'Unknown error');
      const [safeMessage, raw = ''] = messageText.split('||RAW||');
      return Response.json({ error: safeMessage, raw }, { status: 500 });
    }

    const shouldAddIntro = (existingAssistantMessagesCount ?? 0) === 0;
    const intelligenceSection = shouldAddIntro ? buildProactiveIntelligenceSection(vertical) : '';

    let proactiveWelcome = '';
    if (shouldAddIntro) {
      try {
        proactiveWelcome = await buildPersonalizedWelcome({
          projectTitle,
          industryLabel,
          geoLabel,
          projectStatusSummary,
          conversationMemory,
          brainEventsSummary,
          requestLanguage,
        });
      } catch {
        proactiveWelcome = '';
      }
    }

    const combinedReply = [proactiveWelcome, intelligenceSection, generated.reply].filter((value) => value.trim().length > 0).join('\n\n');

    let reply = combinedReply || generated.reply;
    try {
      reply = appendImplementationMarker(reply, projectTitle);
    } catch {
      reply = combinedReply || generated.reply;
    }

    const events = normalizeMentorEvents(generated.events);

    await markMentorUnread({ userId: user.id, projectId, reply, eventCount: events.length });

    const shouldChargeReply = reply.trim().length > 0;
    if (shouldChargeReply) {
      const deduction = await deductCredit(user.id, 'Mentor reply', 1);
      if (!deduction.success) {
        return noCreditsResponse();
      }
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
      return Response.json({ error: messageText, reply }, { status: 500 });
    }

    return Response.json({ reply, events, eventsWritten: events.length });
  }
}
