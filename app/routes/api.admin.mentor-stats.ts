import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { computeAdminMentorStats } from '~/lib/mentor/admin-stats.server';
import { getAdminSecret, requireAdminApi } from '~/lib/server/admin-auth.server';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const adminSecret = getAdminSecret(context);
  try {
    requireAdminApi(request, adminSecret);
  } catch (res) {
    return res as Response;
  }

  try {
    const stats = await computeAdminMentorStats();
    return Response.json({ ok: true as const, stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'unknown');
    return Response.json({ error: message }, { status: 500 });
  }
}
