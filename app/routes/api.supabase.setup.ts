import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { buildSupabaseSetupSql } from '~/lib/supabase/project-setup.server';
import { getSupabaseUserToken, resolveSupabaseIntegrationUserId, runSupabaseSql } from '~/lib/supabase/management.server';
import { supabaseAdmin } from '~/lib/supabase/server';

function requireBearerToken(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    throw Response.json({ error: '[RIDVAN-E2130] Unauthorized: missing Bearer token' }, { status: 401 });
  }

  return token;
}

type ProjectRow = {
  id: string;
  user_id: string;
  title: string | null;
};

async function requireOwnedProject(projectId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, user_id, title')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle<ProjectRow>();

  if (error || !data) {
    throw Response.json({ error: `[RIDVAN-E2131] Project not found: ${error?.message ?? 'unknown error'}` }, { status: 404 });
  }

  return data;
}

export async function action({ request }: ActionFunctionArgs) {
  console.error('[SUPABASE_SETUP] action:start', { method: request.method, url: request.url });

  if (request.method !== 'POST' && request.method !== 'DELETE') {
    console.error('[SUPABASE_SETUP] action:method_not_allowed', { method: request.method });
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const token = requireBearerToken(request);
  console.error('[SUPABASE_SETUP] auth:bearer_token_present');
  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  console.error('[SUPABASE_SETUP] auth:get_user_result', {
    hasUser: Boolean(user),
    userId: user?.id ?? null,
    userError: userError?.message ?? null,
  });

  if (userError || !user) {
    console.error('[SUPABASE_SETUP] auth:unauthorized', { userError: userError?.message ?? 'invalid token' });
    return Response.json({ error: `[RIDVAN-E2132] Unauthorized: ${userError?.message ?? 'invalid token'}` }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { projectId?: string; supabaseProjectId?: string; anonKey?: string } | null;
  const projectId = body?.projectId?.trim();

  console.error('[SUPABASE_SETUP] body:parsed', {
    projectId: projectId ?? null,
    supabaseProjectId: body?.supabaseProjectId?.trim() ?? null,
  });

  if (!projectId) {
    console.error('[SUPABASE_SETUP] body:missing_project_id');
    return Response.json({ error: '[RIDVAN-E2133] Missing projectId' }, { status: 400 });
  }

  console.error('[SUPABASE_SETUP] project:require_owned:start', { projectId, authUserId: user.id });
  const project = await requireOwnedProject(projectId, user.id);
  console.error('[SUPABASE_SETUP] project:require_owned:success', { projectId: project.id, projectUserId: project.user_id, title: project.title });

  if (request.method === 'DELETE') {
    console.error('[SUPABASE_SETUP] disconnect:start', { projectId: project.id, authUserId: user.id });
    const { error: disconnectError } = await supabaseAdmin
      .from('projects')
      .update({
        supabase_project_id: null,
        supabase_project_url: null,
        supabase_anon_key: null,
        supabase_connected_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', project.id)
      .eq('user_id', user.id);

    console.error('[SUPABASE_SETUP] disconnect:update_result', { disconnectError: disconnectError?.message ?? null });

    if (disconnectError) {
      console.error('[SUPABASE_SETUP] disconnect:failed', { disconnectError: disconnectError.message });
      return Response.json({ error: `[RIDVAN-E2136] Failed to clear Supabase connection: ${disconnectError.message}` }, { status: 500 });
    }

    console.error('[SUPABASE_SETUP] disconnect:success', { projectId: project.id });
    return Response.json({ ok: true });
  }

  const supabaseProjectId = body?.supabaseProjectId?.trim();
  const anonKey = body?.anonKey?.trim();

  console.error('[SUPABASE_SETUP] connect:project_ref', { supabaseProjectId: supabaseProjectId ?? null });

  if (!supabaseProjectId) {
    console.error('[SUPABASE_SETUP] body:missing_supabase_project_id');
    return Response.json({ error: '[RIDVAN-E2137] Missing supabaseProjectId' }, { status: 400 });
  }

  console.error('[SUPABASE_SETUP] body:anon_key_received', { hasAnonKey: Boolean(anonKey) });

  if (!anonKey) {
    console.error('[SUPABASE_SETUP] body:missing_anon_key');
    return Response.json({ error: '[RIDVAN-E2138] Missing Supabase anon key' }, { status: 400 });
  }

  console.error('[SUPABASE_SETUP] token:resolve_user_id:start', { authUserId: user.id, projectId: project.id });
  const resolvedUserId = await resolveSupabaseIntegrationUserId(user.id, project.id);
  console.error('[SUPABASE_SETUP] token:resolve_user_id:success', { resolvedUserId });

  console.error('[SUPABASE_SETUP] token:load:start', { resolvedUserId });
  const tokenRow = await getSupabaseUserToken(resolvedUserId);
  console.error('[SUPABASE_SETUP] token:load:result', { hasAccessToken: Boolean(tokenRow?.access_token), tokenUserId: tokenRow?.user_id ?? null });

  if (!tokenRow?.access_token) {
    console.error('[SUPABASE_SETUP] token:missing_access_token', { resolvedUserId });
    return Response.json({ error: '[RIDVAN-E2134] Supabase is not connected for this user' }, { status: 409 });
  }

  const projectUrl = `https://${supabaseProjectId}.supabase.co`;
  console.error('[SUPABASE_SETUP] anon_key:manual_input:accepted', { hasAnonKey: Boolean(anonKey), projectUrl });

  const sql = buildSupabaseSetupSql();
  console.error('[SUPABASE_SETUP] sql:build:success', { sqlLength: sql.length });

  console.error('[SUPABASE_SETUP] sql:run:start', { supabaseProjectId });
  await runSupabaseSql(tokenRow.access_token, supabaseProjectId, sql);
  console.error('[SUPABASE_SETUP] sql:run:success', { supabaseProjectId });

  console.error('[SUPABASE_SETUP] project:update:start', { projectId: project.id, authUserId: user.id, supabaseProjectId, projectUrl });
  const { error: updateError } = await supabaseAdmin
    .from('projects')
    .update({
      supabase_project_id: supabaseProjectId,
      supabase_project_url: projectUrl,
      supabase_anon_key: anonKey,
      supabase_connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', project.id)
    .eq('user_id', user.id);

  console.error('[SUPABASE_SETUP] project:update:result', { updateError: updateError?.message ?? null });

  if (updateError) {
    console.error('[SUPABASE_SETUP] project:update:failed', { updateError: updateError.message });
    return Response.json({ error: `[RIDVAN-E2135] Failed to save Supabase connection: ${updateError.message}` }, { status: 500 });
  }

  console.error('[SUPABASE_SETUP] connect:success', { projectId, supabaseProjectId, projectUrl });
  return Response.json({
    ok: true,
    projectId,
    supabaseProjectId,
    projectUrl,
    anonKey,
    sqlApplied: true,
  });
}
