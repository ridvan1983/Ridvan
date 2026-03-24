import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { supabaseAdmin } from '~/lib/supabase/server';

type Row = {
  id: string;
  project_id: string;
  user_id: string;
  session_id: string | null;
  role: 'user' | 'mentor';
  content: string;
  created_at: string;
};

export async function loader({ request }: ActionFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const { user } = await requireUserFromBearerToken(request);
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E1501] Missing projectId' }, { status: 400 });
  }

  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '200') || 200, 1), 1000);

  const { data, error } = await supabaseAdmin
    .from('mentor_messages')
    .select('id, project_id, user_id, session_id, role, content, created_at')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(limit)
    .returns<Row[]>();

  if (error) {
    return Response.json({ error: `[RIDVAN-E1502] Failed to load mentor messages: ${error.message}` }, { status: 500 });
  }

  return Response.json({ ok: true, messages: data ?? [] });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const { user } = await requireUserFromBearerToken(request);
  const body = (await request.json().catch(() => null)) as
    | { projectId?: string; role?: 'user' | 'mentor'; content?: string; createdAt?: string; sessionId?: string }
    | null;

  const projectId = body?.projectId;
  const role = body?.role;
  const content = typeof body?.content === 'string' ? body.content.trim() : '';
  const createdAt = typeof body?.createdAt === 'string' ? body.createdAt : null;
  const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim().length > 0 ? body.sessionId.trim() : null;

  if (!projectId || (role !== 'user' && role !== 'mentor') || !content) {
    return Response.json({ error: '[RIDVAN-E1503] Missing fields' }, { status: 400 });
  }

  const safeContent = content.slice(0, 20_000);

  const { data, error } = await supabaseAdmin
    .from('mentor_messages')
    .insert({ project_id: projectId, user_id: user.id, session_id: sessionId, role, content: safeContent, created_at: createdAt ?? undefined })
    .select('id, project_id, user_id, session_id, role, content, created_at')
    .single<Row>();

  if (error || !data) {
    return Response.json({ error: `[RIDVAN-E1504] Failed to write mentor message: ${error?.message ?? 'unknown error'}` }, { status: 500 });
  }

  return Response.json({ ok: true, message: data });
}
