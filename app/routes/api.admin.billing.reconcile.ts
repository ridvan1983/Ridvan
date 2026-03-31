import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { reconcileSubscriptions } from '~/lib/billing/reconciliation.server';
import { getOptionalServerEnv } from '~/lib/env.server';

function requireAdminSecret(request: Request, adminSecret: string | undefined) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!adminSecret || !token || token !== adminSecret) {
    throw Response.json({ error: '[RIDVAN-E1222] Unauthorized' }, { status: 401 });
  }
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const adminSecret = getOptionalServerEnv('ADMIN_SECRET', context.cloudflare?.env);
  requireAdminSecret(request, adminSecret);

  const result = await reconcileSubscriptions();

  return Response.json(result);
}
