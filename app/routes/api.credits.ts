import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { supabaseAdmin } from '~/lib/supabase/server';

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return Response.json(
      { error: '[RIDVAN-E401] Unauthorized: missing Bearer token' },
      {
        status: 401,
      },
    );
  }

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return Response.json(
      { error: `[RIDVAN-E401] Unauthorized: ${userError?.message ?? 'invalid token'}` },
      {
        status: 401,
      },
    );
  }

  const { data: subscription, error } = await supabaseAdmin
    .from('subscriptions')
    .select('plan, status, monthly_credits, daily_credits')
    .eq('user_id', user.id)
    .maybeSingle<{ plan: string | null; status: string | null; monthly_credits: number | null; daily_credits: number | null }>();

  if (error) {
    return Response.json({ error: '[RIDVAN-E403] Stripe error: failed to load credits' }, { status: 500 });
  }

  if (!subscription) {
    return Response.json({ plan: 'free', credits: 5, dailyCredits: 0, status: 'active' });
  }

  return Response.json({
    plan: subscription.plan ?? 'free',
    credits: subscription.monthly_credits ?? 0,
    dailyCredits: subscription.daily_credits ?? 0,
    status: subscription.status ?? 'active',
  });
}
