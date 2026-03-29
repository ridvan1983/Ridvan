import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { streamText as aiStreamText, convertToCoreMessages } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getAPIKey } from '~/lib/.server/llm/api-key';
import { MAX_TOKENS } from '~/lib/.server/llm/constants';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { ensureBrainWorkspace, insertBrainEventsBatch } from '~/lib/brain/server';
import { readBrainContext } from '~/lib/brain/read.server';
import { ingestBrainEventsById } from '~/lib/brain/ingest.server';
import { checkCredits } from '~/lib/credits/check';
import { deductCredit } from '~/lib/credits/deduct';
import { analyzeMentorAttachments, buildAttachmentPromptContext, type MentorAttachmentReference } from '~/lib/mentor/file-analysis.server';
import { buildMentorSystemPrompt } from '~/lib/mentor/prompt.server';
import { parseMentorJson } from '~/lib/mentor/parse.server';
import { checkRateLimit, mentorRateLimit } from '~/lib/security/distributed-rate-limit.server';
import { captureError } from '~/lib/server/monitoring.server';
import { supabaseAdmin } from '~/lib/supabase/server';
import { getVerticalContext } from '~/lib/vertical/context.server';

type SubscriptionRow = {
  plan: string | null;
};

function noCreditsResponse() {
  return Response.json(
    {
      error: 'RIDVAN_NO_CREDITS',
      message: 'Du har inga krediter kvar. Uppgradera till PRO för obegränsad access.',
    },
    { status: 403 },
  );
}

function monthStartUtcIso(d = new Date()) {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
  return start.toISOString();
}

function isProPlan(plan: string | null) {
  const p = (plan ?? 'free').toLowerCase();
  return p === 'pro' || p === 'business' || p === 'agency' || p === 'enterprise';
}

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

function hasCountryCode(payload: Record<string, unknown>) {
  const raw = typeof payload.country_code === 'string' ? payload.country_code.trim() : '';
  return raw.length > 0;
}

function normalizeDocumentReadyPayload(payload: Record<string, unknown>) {
  const title = typeof payload.title === 'string' && payload.title.trim().length > 0 ? payload.title.trim() : 'Document';
  const documentType =
    typeof payload.documentType === 'string' && payload.documentType.trim().length > 0 ? payload.documentType.trim() : 'other';
  const content = typeof payload.content === 'string' ? payload.content : '';

  const formatsRaw = Array.isArray(payload.formats) ? payload.formats : [];
  const formats = formatsRaw
    .map((f) => String(f).toLowerCase().trim())
    .filter((f) => f === 'pdf' || f === 'docx' || f === 'xlsx' || f === 'pptx');

  return {
    ...payload,
    title,
    documentType,
    formats: formats.length > 0 ? formats : ['pdf', 'docx'],
    content,
  };
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

export async function action({ context, request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const { user } = await requireUserFromBearerToken(request);

  const body = (await request.json().catch(() => null)) as
    | {
        projectId?: string;
        message?: string;
        sessionId?: string;
        attachments?: MentorAttachmentReference[];
        systemInstruction?: string;
      }
    | null;
  const projectId = body?.projectId;
  const message = body?.message?.trim();
  const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim().length > 0 ? body.sessionId.trim() : null;
  const systemInstruction = typeof body?.systemInstruction === 'string' ? body.systemInstruction.trim() : '';
  const attachments = Array.isArray(body?.attachments) ? body.attachments.filter(Boolean) : [];

  if (!projectId || !message || !sessionId) {
    return Response.json({ error: '[RIDVAN-E851] Missing projectId or message' }, { status: 400 });
  }

  const { success: mentorRateLimitSuccess, reset: mentorRateLimitReset } = await checkRateLimit(mentorRateLimit, user.id);

  if (!mentorRateLimitSuccess) {
    return Response.json(
      { error: 'Too many requests. Please wait before trying again.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((mentorRateLimitReset - Date.now()) / 1000)) },
      },
    );
  }

  // Monetization gate (Mentor-only): Free plan = max 3 conversation sessions per month.
  // This is intentionally additive and does not touch /api/chat.
  try {
    const monthStart = monthStartUtcIso();

    const { data: subRow } = await supabaseAdmin
      .from('subscriptions')
      .select('plan')
      .eq('user_id', user.id)
      .maybeSingle<SubscriptionRow>();

    const plan = subRow?.plan ?? 'free';
    const isPro = isProPlan(plan);

    if (!isPro) {
      const { data: sessionRows } = await supabaseAdmin
        .from('mentor_messages')
        .select('session_id')
        .eq('user_id', user.id)
        .gte('created_at', monthStart)
        .not('session_id', 'is', null)
        .limit(500)
        .returns<Array<{ session_id: string | null }>>();

      const distinctSessionIds = Array.from(new Set((sessionRows ?? []).map((r) => r.session_id).filter((value): value is string => Boolean(value))));
      const alreadyInThisSession = distinctSessionIds.includes(sessionId);

      if (!alreadyInThisSession && distinctSessionIds.length >= 3) {
        return Response.json(
          {
            reply: 'Du har använt dina 3 gratis Mentor-samtal denna månad. Uppgradera till Pro för obegränsad tillgång.',
            events: [],
            eventsWritten: 0,
          },
          { status: 403 },
        );
      }
    }
  } catch (error) {
    captureError(error, {
      route: 'api.mentor',
      userId: user.id,
      extra: { stage: 'mentor_gating', projectId, sessionId },
    });
    console.error('[RIDVAN-E858] Mentor gating failed (non-blocking)', error);
  }

  const creditState = await checkCredits(user.id);
  if (!creditState.allowed) {
    return noCreditsResponse();
  }

  const workspace = await ensureBrainWorkspace(projectId, user.id);
  const brain = await readBrainContext({ projectId, userId: user.id });

  if (!brain) {
    return Response.json({ error: '[RIDVAN-E852] Brain state not found' }, { status: 404 });
  }

  const vertical = await getVerticalContext({ projectId, userId: user.id }).catch(() => null);

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
  const anthropic = createAnthropic({ apiKey });

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
      attachmentAnalysisContext,
      latestSnapshotSummary: snapshotSummary,
      modelHint: complexity,
    });
    const system = systemInstruction ? `${baseSystem}

ONE-OFF SYSTEM INSTRUCTION:
${systemInstruction}` : baseSystem;

    let finalText = '';

    const userContent: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text:
          attachmentAnalyses.length > 0
            ? `User request: ${message}\n\nAttached file context:\n${attachmentAnalysisContext ?? 'none'}`
            : message,
      },
    ];

    for (const analysis of attachmentAnalyses) {
      userContent.push(...analysis.contentParts);
    }

    const result = await aiStreamText({
      model: anthropic(modelId),
      system,
      maxTokens: MAX_TOKENS,
      temperature: 0.5,
      headers: {
        'anthropic-beta': 'max-tokens-3-5-sonnet-2024-07-15',
      },
      tools: needsWebSearch ? ([{ type: 'web_search_20250305', name: 'web_search' }] as any) : undefined,
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

    let parsed: { reply: string; events: Array<{ type: string; payload: Record<string, unknown>; idempotencyKey?: string | null; source?: any }> };

    try {
      parsed = parseMentorJson(finalText);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error ?? 'Unknown error');
      return Response.json({ error: `[RIDVAN-E853] Failed to parse Mentor output: ${messageText}`, raw: finalText }, { status: 500 });
    }

    const reply = parsed.reply;
    const events = parsed.events
      .map((e) => {
        const basePayload = {
          ...e.payload,
          assertion_source: (e.payload as any)?.assertion_source ?? undefined,
        } as Record<string, unknown>;

        if (e.type.trim() === 'world.geo_set') {
          if (!hasCountryCode(basePayload)) {
            return null;
          }
        }

        if (e.type.trim() === 'document.ready') {
          return {
            ...e,
            source: 'mentor' as const,
            idempotencyKey: null,
            payload: normalizeDocumentReadyPayload(basePayload),
          };
        }

        return {
          ...e,
          source: 'mentor' as const,
          idempotencyKey: null,
          payload: basePayload,
        };
      })
      .filter((e): e is NonNullable<typeof e> => Boolean(e));

    // Server-driven unread indicator: mark unread when Mentor produces output.
    // Best-effort; never block response.
    try {
      if ((reply ?? '').trim().length > 0 || events.length > 0) {
        await supabaseAdmin
          .from('mentor_unread')
          .upsert({ user_id: user.id, project_id: projectId, has_unread: true, updated_at: new Date().toISOString() }, { onConflict: 'user_id,project_id' });
      }
    } catch (error) {
      captureError(error, {
        route: 'api.mentor',
        userId: user.id,
        extra: { stage: 'mentor_unread_upsert', projectId },
      });
      console.error('[RIDVAN-E1706] Failed to update mentor_unread (non-blocking)', error);
    }

    const shouldChargeReply = reply.trim().length > 0;
    if (shouldChargeReply) {
      const deduction = await deductCredit(user.id, 'Mentor reply', 1);
      if (!deduction.success) {
        return noCreditsResponse();
      }
    }

    try {
      const eventIds = await insertBrainEventsBatch({
        workspaceId: workspace.id,
        projectId,
        userId: user.id,
        source: 'mentor',
        events,
      });

      const ingestPromise = ingestBrainEventsById(eventIds);

      try {
        await Promise.race([
          ingestPromise,
          new Promise<void>((resolve) => setTimeout(resolve, 1500)),
        ]);
      } catch (error) {
        captureError(error, {
          route: 'api.mentor',
          userId: user.id,
          extra: { stage: 'brain_ingestion_race', projectId, eventCount: eventIds.length },
        });
        console.error('[RIDVAN-E855] Brain ingestion failed', error);
      }

      void ingestPromise.catch((error) => {
        captureError(error, {
          route: 'api.mentor',
          userId: user.id,
          extra: { stage: 'brain_ingestion_async', projectId, eventCount: eventIds.length },
        });
        console.error('[RIDVAN-E856] Brain ingestion async continuation failed', error);
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error ?? 'Unknown error');
      captureError(error, {
        route: 'api.mentor',
        userId: user.id,
        extra: { stage: 'insert_brain_events', projectId, eventCount: events.length },
      });
      return Response.json({ error: `[RIDVAN-E854] Failed to write Brain events: ${messageText}`, reply: parsed.reply }, { status: 500 });
    }

    return Response.json({ reply: parsed.reply, events, eventsWritten: events.length });
  }
}
