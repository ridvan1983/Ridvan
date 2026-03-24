import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { supabaseAdmin } from '~/lib/supabase/server';

type Row = { user_id: string; project_id: string; has_unread: boolean; updated_at: string };

export async function loader({ request }: ActionFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const { user } = await requireUserFromBearerToken(request);
  const { data, error } = await supabaseAdmin
    .from('mentor_unread')
    .select('user_id, project_id, has_unread, updated_at')
    .eq('user_id', user.id)
    .limit(500)
    .returns<Row[]>();

  if (error) {
    return Response.json({ error: `[RIDVAN-E1701] Failed to load mentor_unread: ${error.message}` }, { status: 500 });
  }

  const byProject: Record<string, boolean> = {};
  for (const row of data ?? []) {
    byProject[row.project_id] = Boolean(row.has_unread);
  }

  return Response.json({ ok: true, unreadByProject: byProject });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const { user } = await requireUserFromBearerToken(request);
  const body = (await request.json().catch(() => null)) as { projectId?: string; hasUnread?: boolean } | null;

  const projectId = body?.projectId;
  const hasUnread = typeof body?.hasUnread === 'boolean' ? body.hasUnread : null;

  if (!projectId || hasUnread === null) {
    return Response.json({ error: '[RIDVAN-E1702] Missing fields' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('mentor_unread')
    .upsert({ user_id: user.id, project_id: projectId, has_unread: hasUnread, updated_at: new Date().toISOString() }, { onConflict: 'user_id,project_id' });

  if (error) {
    return Response.json({ error: `[RIDVAN-E1703] Failed to update mentor_unread: ${error.message}` }, { status: 500 });
  }

  return Response.json({ ok: true });
}
