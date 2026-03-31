import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { FEATURE_FLAGS } from '~/config/feature-flags';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { ensureBrainWorkspace } from '~/lib/brain/server';
import { ingestBrainEventsById } from '~/lib/brain/ingest.server';
import { detectNewMilestones } from '~/lib/mentor/milestones.server';
import { supabaseAdmin } from '~/lib/supabase/server';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  if (!FEATURE_FLAGS.mentorMilestones) {
    return Response.json({ error: '[RIDVAN-E1412] Milestones are disabled for MVP' }, { status: 404 });
  }

  const { user } = await requireUserFromBearerToken(request);
  const body = (await request.json().catch(() => null)) as { projectId?: string } | null;
  const projectId = body?.projectId;

  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E1410] Missing projectId' }, { status: 400 });
  }

  const workspace = await ensureBrainWorkspace(projectId, user.id);
  const milestones = await detectNewMilestones({ workspaceId: workspace.id, projectId, userId: user.id });

  if (milestones.length > 0) {
    const { data } = await supabaseAdmin
      .from('brain_events')
      .select('id')
      .eq('workspace_id', workspace.id)
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .eq('source', 'mentor')
      .eq('type', 'mentor.milestone_logged')
      .order('occurred_at', { ascending: false })
      .limit(25)
      .returns<Array<{ id: string }>>();

    const ids = (data ?? []).map((r) => r.id);
    void ingestBrainEventsById(ids).catch((e) => {
      console.error('[RIDVAN-E1411] Milestone ingestion failed', e);
    });
  }

  return Response.json({ ok: true, milestones });
}
