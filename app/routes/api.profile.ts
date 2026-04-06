import { type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { PLANS } from '~/lib/stripe/config';
import { supabaseAdmin } from '~/lib/supabase/server';

async function getUserFromBearer(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return null;
  }
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    return null;
  }
  return user;
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const user = await getUserFromBearer(request);
  if (!user) {
    return Response.json({ error: '[RIDVAN-E401] Unauthorized' }, { status: 401 });
  }

  const { data: sub, error: subError } = await supabaseAdmin
    .from('subscriptions')
    .select('plan, status, monthly_credits, daily_credits, current_period_end')
    .eq('user_id', user.id)
    .maybeSingle<{
      plan: string | null;
      status: string | null;
      monthly_credits: number | null;
      daily_credits: number | null;
      current_period_end: string | null;
    }>();

  if (subError) {
    return Response.json({ error: '[RIDVAN-E1301] Failed to load subscription' }, { status: 500 });
  }

  const planKey = (sub?.plan ?? 'free') as keyof typeof PLANS;
  const planConfig = PLANS[planKey] ?? PLANS.free;

  const remainingCredits = sub
    ? Math.max((sub.monthly_credits ?? 0) + (sub.daily_credits ?? 0), 0)
    : PLANS.free.monthlyCredits + PLANS.free.dailyCredits;

  const periodBudget = planConfig.monthlyCredits + planConfig.dailyCredits;
  const displayName =
    (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()) ||
    (typeof user.user_metadata?.name === 'string' && user.user_metadata.name.trim()) ||
    '';

  return Response.json({
    id: user.id,
    email: user.email ?? '',
    displayName,
    createdAt: user.created_at,
    plan: planKey,
    planDisplayName: planKey === 'business' ? 'Business' : planConfig.name,
    subscriptionStatus: sub?.status ?? 'active',
    remainingCredits,
    monthlyCreditsBalance: sub?.monthly_credits ?? null,
    dailyCreditsBalance: sub?.daily_credits ?? null,
    periodBudget,
    currentPeriodEnd: sub?.current_period_end ?? null,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return Response.json({ error: '[RIDVAN-E401] Unauthorized' }, { status: 401 });
  }

  if (request.method === 'PATCH') {
    let body: { displayName?: unknown };
    try {
      body = (await request.json()) as { displayName?: unknown };
    } catch {
      return Response.json({ error: '[RIDVAN-E1302] Invalid JSON' }, { status: 400 });
    }

    const raw = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    if (raw.length > 120) {
      return Response.json({ error: '[RIDVAN-E1303] Name too long' }, { status: 400 });
    }

    const { data: existing, error: loadMetaError } = await supabaseAdmin.auth.admin.getUserById(user.id);
    if (loadMetaError || !existing.user) {
      return Response.json({ error: '[RIDVAN-E1307] Failed to load user metadata' }, { status: 500 });
    }

    const mergedMeta = { ...(existing.user.user_metadata ?? {}), full_name: raw };
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: mergedMeta,
    });

    if (error || !data.user) {
      return Response.json(
        { error: `[RIDVAN-E1304] Failed to update profile: ${error?.message ?? 'unknown'}` },
        { status: 500 },
      );
    }

    const u = data.user;
    const displayName =
      (typeof u.user_metadata?.full_name === 'string' && u.user_metadata.full_name.trim()) ||
      (typeof u.user_metadata?.name === 'string' && u.user_metadata.name.trim()) ||
      '';

    return Response.json({ ok: true, displayName });
  }

  if (request.method === 'DELETE') {
    let body: { confirm?: unknown };
    try {
      body = (await request.json()) as { confirm?: unknown };
    } catch {
      return Response.json({ error: '[RIDVAN-E1302] Invalid JSON' }, { status: 400 });
    }

    if (body.confirm !== 'DELETE_MY_ACCOUNT') {
      return Response.json({ error: '[RIDVAN-E1305] Confirmation required' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (error) {
      return Response.json({ error: `[RIDVAN-E1306] Failed to delete account: ${error.message}` }, { status: 500 });
    }

    return Response.json({ ok: true });
  }

  return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
}
