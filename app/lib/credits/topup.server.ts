import type Stripe from 'stripe';
import { stripe } from '~/lib/stripe/config';
import { findTopupPackByStripePriceId } from '~/lib/stripe/topup-packs.server';
import { supabaseAdmin } from '~/lib/supabase/server';
import { checkAndResetDailyCredits } from './daily-reset';
import { recordCreditTransaction } from './ledger.server';

/**
 * Apply one-time top-up credits after Stripe Checkout (payment mode). Idempotent per checkout session via credit_ledger.reference_id.
 */
export async function applyTopupCreditsFromCheckoutSession(session: Stripe.Checkout.Session, envSource: unknown): Promise<void> {
  if (session.mode !== 'payment' || session.payment_status !== 'paid') {
    return;
  }

  const userId = session.metadata?.userId;
  if (!userId || session.metadata?.kind !== 'topup') {
    return;
  }

  const { data: existing } = await supabaseAdmin
    .from('credit_ledger')
    .select('id')
    .eq('reference_id', session.id)
    .maybeSingle<{ id: string }>();

  if (existing) {
    return;
  }

  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 5 });
  const paidPriceId = lineItems.data[0]?.price?.id;

  if (typeof paidPriceId !== 'string' || !paidPriceId) {
    throw new Error('[RIDVAN-E1230] Top-up checkout missing price on line item');
  }

  const pack = findTopupPackByStripePriceId(paidPriceId, envSource);

  if (!pack) {
    throw new Error('[RIDVAN-E1231] Top-up price does not match any configured pack');
  }

  await checkAndResetDailyCredits(userId);

  const { data: subscription, error: subError } = await supabaseAdmin
    .from('subscriptions')
    .select('monthly_credits, daily_credits')
    .eq('user_id', userId)
    .maybeSingle<{ monthly_credits: number | null; daily_credits: number | null }>();

  if (subError && subError.code !== 'PGRST116') {
    throw new Error(`[RIDVAN-E1232] Failed to load subscription for top-up: ${subError.message}`);
  }

  const monthly = subscription?.monthly_credits ?? 0;
  const daily = subscription?.daily_credits ?? 0;
  const newMonthly = monthly + pack.credits;
  const balanceAfter = newMonthly + daily;

  const { error: updateError } = await supabaseAdmin
    .from('subscriptions')
    .update({ monthly_credits: newMonthly })
    .eq('user_id', userId);

  if (updateError) {
    throw new Error(`[RIDVAN-E1233] Failed to apply top-up balance: ${updateError.message}`);
  }

  await recordCreditTransaction({
    userId,
    amount: pack.credits,
    balanceAfter,
    type: 'topup',
    description: `Top-up: ${pack.label} (€${pack.priceEur})`,
    referenceId: session.id,
  });
}
