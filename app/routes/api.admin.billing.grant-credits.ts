import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { checkAndResetDailyCredits } from '~/lib/credits/daily-reset';
import { recordCreditTransaction } from '~/lib/credits/ledger.server';
import { getAdminSecret, requireAdminApi } from '~/lib/server/admin-auth.server';
import { supabaseAdmin } from '~/lib/supabase/server';

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

  let body: { userId?: string; amount?: number; reason?: string };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: '[RIDVAN-E1260] Invalid JSON body' }, { status: 400 });
  }

  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  const amount = Number(body.amount);
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  if (!userId || !Number.isFinite(amount) || amount <= 0 || !reason) {
    return Response.json({ error: '[RIDVAN-E1261] Missing or invalid userId, amount, or reason' }, { status: 400 });
  }

  const normalizedAmount = Math.floor(amount);

  try {
    await checkAndResetDailyCredits(userId);

    const { data: subscription, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .select('monthly_credits, daily_credits')
      .eq('user_id', userId)
      .maybeSingle<{ monthly_credits: number | null; daily_credits: number | null }>();

    if (subError && subError.code !== 'PGRST116') {
      return Response.json({ error: `[RIDVAN-E1262] ${subError.message}` }, { status: 500 });
    }

    const monthly = subscription?.monthly_credits ?? 0;
    const daily = subscription?.daily_credits ?? 0;
    const newMonthly = monthly + normalizedAmount;
    const balanceAfter = newMonthly + daily;

    const { error: updateError } = await supabaseAdmin
      .from('subscriptions')
      .update({ monthly_credits: newMonthly })
      .eq('user_id', userId);

    if (updateError) {
      return Response.json({ error: `[RIDVAN-E1263] ${updateError.message}` }, { status: 500 });
    }

    await recordCreditTransaction({
      userId,
      amount: normalizedAmount,
      balanceAfter,
      type: 'manual_grant',
      description: reason,
    });

    return Response.json({ ok: true, monthlyCredits: newMonthly, balanceAfter });
  } catch (error) {
    const message = error instanceof Error ? error.message : '[RIDVAN-E1264] Grant failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
