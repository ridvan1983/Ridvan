import { type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { supabaseAdmin } from '~/lib/supabase/server';

interface SnapshotRow {
  id: string;
  project_id: string;
  user_id: string;
  version: number;
  title: string | null;
  files: Record<string, string>;
  created_at: string;
}

interface ProjectRow {
  id: string;
  user_id: string;
}

function requireBearerToken(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    throw Response.json({ error: '[RIDVAN-E721] Unauthorized: missing Bearer token' }, { status: 401 });
  }

  return token;
}

async function requireUser(request: Request) {
  const token = requireBearerToken(request);

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    throw Response.json({ error: `[RIDVAN-E721] Unauthorized: ${userError?.message ?? 'invalid token'}` }, { status: 401 });
  }

  return { token, user };
}

async function requireProjectOwner(projectId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .maybeSingle<ProjectRow>();

  if (error) {
    throw Response.json({ error: `[RIDVAN-E722] Failed to load project: ${error.message}` }, { status: 500 });
  }

  if (!data || data.user_id !== userId) {
    throw Response.json({ error: '[RIDVAN-E723] Project not found' }, { status: 404 });
  }

  return data;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const projectId = params.id;

  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E724] Missing project id' }, { status: 400 });
  }

  const { user } = await requireUser(request);

  await requireProjectOwner(projectId, user.id);

  const url = new URL(request.url);
  const latest = url.searchParams.get('latest') === '1';

  if (latest) {
    const { data, error } = await supabaseAdmin
      .from('project_snapshots')
      .select('id, project_id, user_id, version, title, files, created_at')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle<SnapshotRow>();

    if (error) {
      return Response.json({ error: `[RIDVAN-E725] Failed to load snapshot: ${error.message}` }, { status: 500 });
    }

    if (!data) {
      return Response.json({ error: '[RIDVAN-E726] Snapshot not found' }, { status: 404 });
    }

    return Response.json({
      id: data.id,
      projectId: data.project_id,
      version: data.version,
      title: data.title,
      files: data.files,
      createdAt: data.created_at,
    });
  }

  const { data, error } = await supabaseAdmin
    .from('project_snapshots')
    .select('id, project_id, user_id, version, title, created_at')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .order('version', { ascending: false })
    .limit(50)
    .returns<Array<Pick<SnapshotRow, 'id' | 'project_id' | 'user_id' | 'version' | 'title' | 'created_at'>>>();

  if (error) {
    return Response.json({ error: `[RIDVAN-E725] Failed to list snapshots: ${error.message}` }, { status: 500 });
  }

  return Response.json(
    (data ?? []).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      version: row.version,
      title: row.title,
      createdAt: row.created_at,
    })),
  );
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const projectId = params.id;

  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E724] Missing project id' }, { status: 400 });
  }

  const { user } = await requireUser(request);

  await requireProjectOwner(projectId, user.id);

  const body = (await request.json().catch(() => null)) as { title?: string | null; files?: Record<string, string> } | null;

  const files = body?.files;

  if (!files || typeof files !== 'object') {
    return Response.json({ error: '[RIDVAN-E727] Missing files payload' }, { status: 400 });
  }

  const title = body?.title ?? null;

  const { data: latest, error: latestError } = await supabaseAdmin
    .from('project_snapshots')
    .select('version')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number }>();

  if (latestError) {
    return Response.json({ error: `[RIDVAN-E725] Failed to load snapshot version: ${latestError.message}` }, { status: 500 });
  }

  const nextVersion = (latest?.version ?? 0) + 1;

  const { data, error } = await supabaseAdmin
    .from('project_snapshots')
    .insert({
      project_id: projectId,
      user_id: user.id,
      version: nextVersion,
      title,
      files,
    })
    .select('id, project_id, user_id, version, title, files, created_at')
    .single<SnapshotRow>();

  if (error || !data) {
    return Response.json({ error: `[RIDVAN-E728] Failed to create snapshot: ${error?.message ?? 'unknown error'}` }, { status: 500 });
  }

  await supabaseAdmin
    .from('projects')
    .update({ updated_at: new Date().toISOString(), title: title ?? undefined })
    .eq('id', projectId)
    .eq('user_id', user.id);

  return Response.json({
    id: data.id,
    projectId: data.project_id,
    version: data.version,
    title: data.title,
    files: data.files,
    createdAt: data.created_at,
  });
}
