import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { logError } from '~/lib/server/monitoring.server';

/**
 * Client-reported Mentor SSE failures → persisted to error_logs (route mentor-stream).
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const { user } = await requireUserFromBearerToken(request);

  const body = (await request.json().catch(() => null)) as {
    message?: string;
    metadata?: Record<string, unknown>;
  } | null;

  const message =
    typeof body?.message === 'string' && body.message.trim().length > 0
      ? body.message.trim()
      : '[RIDVAN-E1795] Mentor stream interrupted (no client message)';

  logError(message, {
    route: 'mentor-stream',
    userId: user.id,
    metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
  });

  return Response.json({ ok: true });
}
