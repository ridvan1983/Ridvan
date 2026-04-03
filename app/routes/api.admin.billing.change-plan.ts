import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { checkAndResetDailyCredits } from '~/lib/credits/daily-reset';
import { getAdminSecret, requireAdminApi } from '~/lib/server/admin-auth.server';
import { PLANS } from '~/lib/stripe/config';
import { supabaseAdmin } from '~/lib/supabase/server';

type PlanKey = keyof typeof PLANS;

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const adminSecret = getAdminSecret(context);

  try {
    requireAdminApi(request, adminSecret);
  } catch (response) {
    return response as Response;
  }

  let body: { userId?: string; planId?: string };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: '[RIDVAN-E1270] Invalid JSON body' }, { status: 400 });
  }

  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  const planId = typeof body.planId === 'string' ? (body.planId.trim() as PlanKey) : ('' as PlanKey);

  if (!userId || !planId || !(planId in PLANS)) {
    return Response.json({ error: '[RIDVAN-E1271] Missing or invalid userId or planId' }, { status: 400 });
  }

  const plan = PLANS[planId];

  try {
    await checkAndResetDailyCredits(userId);

    const { data: existing, error: loadError } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_subscription_id, status')
      .eq('user_id', userId)
      .maybeSingle<{ stripe_subscription_id: string | null; status: string | null }>();

    if (loadError && loadError.code !== 'PGRST116') {
      return Response.json({ error: `[RIDVAN-E1272] ${loadError.message}` }, { status: 500 });
    }

    const { error: upsertError } = await supabaseAdmin.from('subscriptions').upsert(
      {
        user_id: userId,
        plan: planId,
        monthly_credits: plan.monthlyCredits,
        daily_credits: plan.dailyCredits,
        status: existing?.status && existing.status.length > 0 ? existing.status : 'active',
        stripe_subscription_id: existing?.stripe_subscription_id ?? null,
      },
      { onConflict: 'user_id' },
    );

    if (upsertError) {
      return Response.json({ error: `[RIDVAN-E1273] ${upsertError.message}` }, { status: 500 });
    }

    return Response.json({ ok: true, planId });
  } catch (error) {
    const message = error instanceof Error ? error.message : '[RIDVAN-E1274] Change plan failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
