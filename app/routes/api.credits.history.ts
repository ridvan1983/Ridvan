import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getUserCreditHistory } from '~/lib/credits/ledger.server';
import { supabaseAdmin } from '~/lib/supabase/server';

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return Response.json({ error: '[RIDVAN-E401] Unauthorized' }, { status: 401 });
  }

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return Response.json({ error: '[RIDVAN-E401] Unauthorized' }, { status: 401 });
  }

  try {
    const entries = await getUserCreditHistory(user.id, 20);
    return Response.json({
      entries: entries.map((e) => ({
        id: e.id,
        createdAt: e.created_at,
        type: e.type,
        amount: e.amount,
        balanceAfter: e.balance_after,
        description: e.description,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return Response.json({ error: msg }, { status: 500 });
  }
}
