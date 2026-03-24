import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { ensureBrainWorkspace } from '~/lib/brain/server';
import { ingestLatestBrainEventsForProject } from '~/lib/brain/ingest.server';
import { supabaseAdmin } from '~/lib/supabase/server';

interface ProjectRow {
  id: string;
  user_id: string;
}

async function requireProjectOwner(projectId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .maybeSingle<ProjectRow>();

  if (error) {
    throw Response.json({ error: `[RIDVAN-E881] Failed to load project: ${error.message}` }, { status: 500 });
  }

  if (!data || data.user_id !== userId) {
    throw Response.json({ error: '[RIDVAN-E882] Project not found' }, { status: 404 });
  }

  return data;
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const projectId = params.projectId;
  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E883] Missing projectId' }, { status: 400 });
  }

  const { user } = await requireUserFromBearerToken(request);
  await requireProjectOwner(projectId, user.id);

  await ensureBrainWorkspace(projectId, user.id);

  const ingested = await ingestLatestBrainEventsForProject({ projectId, userId: user.id, limit: 50 });

  return Response.json({ ok: true, ingested });
}
