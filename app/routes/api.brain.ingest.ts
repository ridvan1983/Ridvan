import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { ingestBrainEventsById } from '~/lib/brain/ingest.server';
import { supabaseAdmin } from '~/lib/supabase/server';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const { user } = await requireUserFromBearerToken(request);

  const body = (await request.json().catch(() => null)) as { eventIds?: string[] } | null;
  const eventIds = Array.isArray(body?.eventIds) ? body!.eventIds.filter((x) => typeof x === 'string') : [];

  if (eventIds.length === 0) {
    return Response.json({ error: '[RIDVAN-E871] Missing eventIds' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.from('brain_events').select('id, user_id').in('id', eventIds).returns<Array<{ id: string; user_id: string }>>();

  if (error) {
    return Response.json({ error: `[RIDVAN-E872] Failed to validate events: ${error.message}` }, { status: 500 });
  }

  const invalid = (data ?? []).some((e) => e.user_id !== user.id);

  if (invalid || (data ?? []).length !== eventIds.length) {
    return Response.json({ error: '[RIDVAN-E873] Unauthorized: event ownership mismatch' }, { status: 403 });
  }

  await ingestBrainEventsById(eventIds);

  return Response.json({ ok: true, ingested: eventIds.length });
}
