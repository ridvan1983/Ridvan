import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { supabaseAdmin } from '~/lib/supabase/server';

interface ProjectRow {
  id: string;
  user_id: string;
}

function requireBearerToken(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    throw Response.json({ error: '[RIDVAN-E741] Unauthorized: missing Bearer token' }, { status: 401 });
  }

  return token;
}

async function requireProjectOwner(projectId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .maybeSingle<ProjectRow>();

  if (error) {
    throw Response.json({ error: `[RIDVAN-E742] Failed to load project: ${error.message}` }, { status: 500 });
  }

  if (!data || data.user_id !== userId) {
    throw Response.json({ error: '[RIDVAN-E743] Project not found' }, { status: 404 });
  }

  return data;
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'DELETE') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const projectId = params.id;

  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E744] Missing project id' }, { status: 400 });
  }

  const token = requireBearerToken(request);

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return Response.json({ error: `[RIDVAN-E745] Unauthorized: ${userError?.message ?? 'invalid token'}` }, { status: 401 });
  }

  await requireProjectOwner(projectId, user.id);

  const { error: snapshotsError } = await supabaseAdmin.from('project_snapshots').delete().eq('project_id', projectId);

  if (snapshotsError) {
    return Response.json(
      { error: `[RIDVAN-E746] Failed to delete project snapshots: ${snapshotsError.message}` },
      { status: 500 },
    );
  }

  const { error: sessionsError } = await supabaseAdmin.from('project_chat_sessions').delete().eq('project_id', projectId);

  if (sessionsError) {
    return Response.json(
      { error: `[RIDVAN-E747] Failed to delete project chat sessions: ${sessionsError.message}` },
      { status: 500 },
    );
  }

  const { error: projectError } = await supabaseAdmin.from('projects').delete().eq('id', projectId);

  if (projectError) {
    return Response.json({ error: `[RIDVAN-E748] Failed to delete project: ${projectError.message}` }, { status: 500 });
  }

  return new Response(null, { status: 204 });
}
