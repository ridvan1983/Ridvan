import { type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { createSupabaseProject, getSupabaseUserToken, listSupabaseProjects, resolveSupabaseIntegrationUserId } from '~/lib/supabase/management.server';
import { supabaseAdmin } from '~/lib/supabase/server';

function requireBearerToken(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    throw Response.json({ error: '[RIDVAN-E2120] Unauthorized: missing Bearer token' }, { status: 401 });
  }

  return token;
}

type ProjectConnectionRow = {
  id: string;
  user_id: string;
  supabase_project_id: string | null;
  supabase_project_url: string | null;
  supabase_anon_key: string | null;
  supabase_connected_at: string | null;
};

async function requireOwnedProject(projectId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, user_id, supabase_project_id, supabase_project_url, supabase_anon_key, supabase_connected_at')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle<ProjectConnectionRow>();

  if (error || !data) {
    throw Response.json({ error: `[RIDVAN-E2121] Project not found: ${error?.message ?? 'unknown error'}` }, { status: 404 });
  }

  return data;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const token = requireBearerToken(request);
  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return Response.json({ error: `[RIDVAN-E2122] Unauthorized: ${userError?.message ?? 'invalid token'}` }, { status: 401 });
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId')?.trim() || null;
  const resolvedUserId = await resolveSupabaseIntegrationUserId(user.id, projectId);
  const tokenRow = await getSupabaseUserToken(resolvedUserId);

  if (!tokenRow?.access_token) {
    return Response.json({ connected: false, projects: [], projectConnection: null });
  }

  const projects = await listSupabaseProjects(tokenRow.access_token);
  const projectConnection = projectId ? await requireOwnedProject(projectId, user.id) : null;

  return Response.json({
    connected: true,
    projects,
    projectConnection,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const token = requireBearerToken(request);
  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return Response.json({ error: `[RIDVAN-E2123] Unauthorized: ${userError?.message ?? 'invalid token'}` }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    projectId?: string | null;
    name?: string;
    organizationId?: string | null;
    region?: string | null;
  } | null;

  const resolvedUserId = await resolveSupabaseIntegrationUserId(user.id, body?.projectId?.trim() || null);
  const tokenRow = await getSupabaseUserToken(resolvedUserId);

  if (!tokenRow?.access_token) {
    return Response.json({ error: '[RIDVAN-E2124] Supabase is not connected for this user' }, { status: 409 });
  }

  const name = body?.name?.trim();

  if (!name) {
    return Response.json({ error: '[RIDVAN-E2125] Missing Supabase project name' }, { status: 400 });
  }

  const project = await createSupabaseProject({
    accessToken: tokenRow.access_token,
    name,
    organizationId: body?.organizationId ?? null,
    region: body?.region ?? null,
  });

  return Response.json({ ok: true, project });
}
