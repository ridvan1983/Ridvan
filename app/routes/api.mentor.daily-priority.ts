import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { streamText as aiStreamText, convertToCoreMessages } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { FEATURE_FLAGS } from '~/config/feature-flags';
import { getAPIKey } from '~/lib/.server/llm/api-key';
import { MAX_TOKENS } from '~/lib/.server/llm/constants';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { ensureBrainWorkspace } from '~/lib/brain/server';
import { readBrainContext } from '~/lib/brain/read.server';
import { buildMentorSystemPrompt } from '~/lib/mentor/prompt.server';
import { parseMentorJson } from '~/lib/mentor/parse.server';
import { supabaseAdmin } from '~/lib/supabase/server';
import { getVerticalContext } from '~/lib/vertical/context.server';

type Row = {
  id: string;
  project_id: string;
  user_id: string;
  priority_text: string;
  date: string;
  completed: boolean;
};

function isoDate(d = new Date()) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizePriorityText(text: string) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 400) : '';
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

export async function loader({ request }: ActionFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  if (!FEATURE_FLAGS.mentorDailyPriority) {
    return Response.json({ error: '[RIDVAN-E1208] Daily priority is disabled for MVP' }, { status: 404 });
  }

  const { user } = await requireUserFromBearerToken(request);
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E1201] Missing projectId' }, { status: 400 });
  }

  const today = isoDate();
  const { data, error } = await supabaseAdmin
    .from('mentor_daily_priorities')
    .select('id, project_id, user_id, priority_text, date, completed')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .eq('date', today)
    .maybeSingle<Row>();

  if (error) {
    return Response.json({ error: `[RIDVAN-E1202] Failed to load daily priority: ${error.message}` }, { status: 500 });
  }

  return Response.json({ ok: true, priority: data ?? null, date: today });
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  if (!FEATURE_FLAGS.mentorDailyPriority) {
    return Response.json({ error: '[RIDVAN-E1209] Daily priority is disabled for MVP' }, { status: 404 });
  }

  const { user } = await requireUserFromBearerToken(request);
  const body = (await request.json().catch(() => null)) as { projectId?: string; op?: string; completed?: boolean } | null;
  const projectId = body?.projectId;
  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E1203] Missing projectId' }, { status: 400 });
  }

  const today = isoDate();

  if (body?.op === 'toggle') {
    const completed = Boolean(body?.completed);
    const { data, error } = await supabaseAdmin
      .from('mentor_daily_priorities')
      .update({ completed, updated_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .eq('date', today)
      .select('id, project_id, user_id, priority_text, date, completed')
      .maybeSingle<Row>();

    if (error) {
      return Response.json({ error: `[RIDVAN-E1204] Failed to update daily priority: ${error.message}` }, { status: 500 });
    }

    return Response.json({ ok: true, priority: data ?? null, date: today });
  }

  // op === 'generate' (default)
  const workspace = await ensureBrainWorkspace(projectId, user.id);
  const brain = await readBrainContext({ projectId, userId: user.id });
  if (!brain) {
    return Response.json({ error: '[RIDVAN-E1205] Brain state not found' }, { status: 404 });
  }

  const vertical = await getVerticalContext({ projectId, userId: user.id }).catch(() => null);

  // Return existing priority if already generated today.
  const { data: existing } = await supabaseAdmin
    .from('mentor_daily_priorities')
    .select('id, project_id, user_id, priority_text, date, completed')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .eq('date', today)
    .maybeSingle<Row>();

  if (existing) {
    return Response.json({ ok: true, priority: existing, date: today });
  }

  const apiKey = getAPIKey(context.cloudflare.env) ?? '';
  const anthropic = createAnthropic({ apiKey });

  const system = buildMentorSystemPrompt({
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
    projectTitle: null,
    latestSnapshotSummary: null,
    modelHint: 'sonnet',
  });

  let finalText = '';

  const result = await aiStreamText({
    model: anthropic('claude-sonnet-4-5-20250929'),
    system: `${system}\n\nDAILY PRIORITY MODE:\nThe user is asking: \"Vad ska jag göra idag?\"\nYou MUST respond with valid JSON only, using the normal Mentor schema: {\"reply\": ..., \"events\": []}.\nIn reply, output exactly ONE line in this format:\nIdag: <specific action>. Det tar max 2 timmar och påverkar <revenue/cost/risk> direkt.\nUse Brain context. No generic advice. No extra text. events must be [].`,
    maxTokens: Math.min(600, MAX_TOKENS),
    temperature: 0.4,
    messages: convertToCoreMessages([
      {
        role: 'user',
        content: 'Vad är min viktigaste uppgift idag baserat på min situation?',
      },
    ]),
    onFinish: async (event) => {
      const { text } = event as { text: string };
      finalText = text;
    },
  });

  await drainReadableStream(result.toAIStream());

  let parsedReply = '';
  try {
    parsedReply = parseMentorJson(finalText).reply;
  } catch {
    parsedReply = finalText;
  }

  const priorityText = normalizePriorityText(parsedReply);
  if (!priorityText) {
    return Response.json({ error: '[RIDVAN-E1206] Failed to generate daily priority' }, { status: 500 });
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('mentor_daily_priorities')
    .insert({ project_id: projectId, user_id: user.id, priority_text: priorityText, date: today, completed: false })
    .select('id, project_id, user_id, priority_text, date, completed')
    .single<Row>();

  if (insertError || !inserted) {
    return Response.json({ error: `[RIDVAN-E1207] Failed to write daily priority: ${insertError?.message ?? 'unknown error'}` }, { status: 500 });
  }

  // Also emit a Brain event for traceability.
  await supabaseAdmin.from('brain_events').insert({
    workspace_id: workspace.id,
    project_id: projectId,
    user_id: user.id,
    source: 'mentor',
    type: 'mentor.daily_priority_generated',
    idempotency_key: null,
    payload: { date: today, priority_text: priorityText, assertion_source: 'system_inferred' },
  });

  return Response.json({ ok: true, priority: inserted, date: today });
}
