import { type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { supabaseAdmin } from '~/lib/supabase/server';

interface ProjectRow {
  id: string;
  user_id: string;
}

interface SessionRow {
  id: string;
  project_id: string;
  user_id: string;
  title: string | null;
  messages: unknown;
  created_at: string;
  updated_at: string;
}

function requireBearerToken(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    throw Response.json({ error: '[RIDVAN-E751] Unauthorized: missing Bearer token' }, { status: 401 });
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
    throw Response.json({ error: `[RIDVAN-E751] Unauthorized: ${userError?.message ?? 'invalid token'}` }, { status: 401 });
  }

  return user;
}

async function requireProjectOwner(projectId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .maybeSingle<ProjectRow>();

  if (error) {
    throw Response.json({ error: `[RIDVAN-E752] Failed to load project: ${error.message}` }, { status: 500 });
  }

  if (!data || data.user_id !== userId) {
    throw Response.json({ error: '[RIDVAN-E753] Project not found' }, { status: 404 });
  }

  return data;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const projectId = params.id;
  const sessionId = params.sessionId;

  if (!projectId || !sessionId) {
    return Response.json({ error: '[RIDVAN-E754] Missing ids' }, { status: 400 });
  }

  const user = await requireUser(request);
  await requireProjectOwner(projectId, user.id);

  const { data, error } = await supabaseAdmin
    .from('project_chat_sessions')
    .select('id, project_id, user_id, title, messages, created_at, updated_at')
    .eq('id', sessionId)
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .maybeSingle<SessionRow>();

  if (error) {
    return Response.json({ error: `[RIDVAN-E755] Failed to load session: ${error.message}` }, { status: 500 });
  }

  if (!data) {
    return Response.json({ error: '[RIDVAN-E756] Session not found' }, { status: 404 });
  }

  return Response.json({
    id: data.id,
    projectId: data.project_id,
    title: data.title,
    messages: (data.messages ?? []) as unknown,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const projectId = params.id;
  const sessionId = params.sessionId;

  if (!projectId || !sessionId) {
    return Response.json({ error: '[RIDVAN-E754] Missing ids' }, { status: 400 });
  }

  const user = await requireUser(request);
  await requireProjectOwner(projectId, user.id);

  if (request.method !== 'PUT') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const body = (await request.json().catch(() => null)) as { title?: string | null; messages?: unknown } | null;
  const messages = body?.messages;

  if (!Array.isArray(messages)) {
    return Response.json({ error: '[RIDVAN-E757] Missing messages payload' }, { status: 400 });
  }

  const title = body?.title ?? null;

  const now = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from('project_chat_sessions')
    .update({
      title,
      messages,
      updated_at: now,
    })
    .eq('id', sessionId)
    .eq('project_id', projectId)
    .eq('user_id', user.id);

  if (error) {
    return Response.json({ error: `[RIDVAN-E758] Failed to update session: ${error.message}` }, { status: 500 });
  }

  return Response.json({ ok: true });
}
