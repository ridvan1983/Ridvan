import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { ensureBrainWorkspace, insertBrainEventsBatch } from '~/lib/brain/server';
import { ingestBrainEventsById } from '~/lib/brain/ingest.server';
import { normalizeIndustry } from '~/lib/vertical/taxonomy.server';
import { getVerticalExpertContext, mapIndustryToExpertVertical } from '~/lib/vertical/expert.server';
import { supabaseAdmin } from '~/lib/supabase/server';
import { processMentorTriggersForBuilderSeed } from '~/lib/mentor/triggers-apply.server';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const { user } = await requireUserFromBearerToken(request);

  const body = (await request.json().catch(() => null)) as
    | { projectId?: string; initialPrompt?: string; sessionId?: string; filePaths?: string[] }
    | null;
  const projectId = body?.projectId;
  const initialPrompt = body?.initialPrompt?.trim();
  const mentorSessionId = typeof body?.sessionId === 'string' && body.sessionId.trim().length > 0 ? body.sessionId.trim() : null;
  const filePaths = Array.isArray(body?.filePaths)
    ? body.filePaths.map((p) => (typeof p === 'string' ? p.trim() : '')).filter((p) => p.length > 0)
    : [];

  if (!projectId || !initialPrompt) {
    return Response.json({ error: '[RIDVAN-E1781] Missing projectId or initialPrompt' }, { status: 400 });
  }

  const { data: projectRow, error: projectError } = await supabaseAdmin
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle<{ id: string; user_id: string }>();

  if (projectError) {
    return Response.json({ error: `[RIDVAN-E1783] Project lookup failed: ${projectError.message}` }, { status: 500 });
  }

  if (!projectRow) {
    return Response.json({ error: '[RIDVAN-E1784] Unauthorized project' }, { status: 403 });
  }

  const workspace = await ensureBrainWorkspace(projectId, user.id);
  const industry = normalizeIndustry(initialPrompt);
  const expertKey = mapIndustryToExpertVertical(industry.normalizedIndustry);
  const marketContext = getVerticalExpertContext(expertKey).slice(0, 12000);

  const seedPayload = {
    projectType: industry.normalizedIndustry === 'unknown' ? 'unknown' : industry.normalizedIndustry,
    vertical: industry.normalizedIndustry,
    initialPrompt,
    marketContext,
  };

  const eventIds = await insertBrainEventsBatch({
    workspaceId: workspace.id,
    projectId,
    userId: user.id,
    source: 'builder',
    events: [
      {
        type: 'signals.updated',
        payload: {
          patches: [{ key: 'mentor_builder_seed', payload: seedPayload }],
        },
      },
    ],
  });

  void ingestBrainEventsById(eventIds).catch((error) => {
    console.error('[RIDVAN-E1782] Builder mentor seed ingest failed', error);
  });

  void processMentorTriggersForBuilderSeed({
    workspaceId: workspace.id,
    projectId,
    userId: user.id,
    initialPrompt,
    filePaths,
    mentorSessionId,
  }).catch((error) => {
    console.error('[RIDVAN-E1805] Builder-seed mentor triggers failed', error);
  });

  return Response.json({ ok: true, wroteEvents: eventIds.length });
}
