import type Stripe from 'stripe';
import { stripe } from '~/lib/stripe/config';
import { supabaseAdmin } from '~/lib/supabase/server';

type SubscriptionRow = {
  user_id: string;
  stripe_subscription_id: string | null;
  status: string | null;
};

type Mismatch = {
  userId: string;
  stripeSubscriptionId: string;
  dbStatus: string;
  stripeStatus: string;
};

export async function reconcileSubscriptions() {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id, stripe_subscription_id, status')
    .not('stripe_subscription_id', 'is', null)
    .returns<SubscriptionRow[]>();

  if (error) {
    throw new Error(`[RIDVAN-E1220] Failed to load subscriptions for reconciliation: ${error.message}`);
  }

  const mismatches: Mismatch[] = [];
  let checked = 0;

  for (const subscription of data ?? []) {
    const stripeSubscriptionId = subscription.stripe_subscription_id;

    if (!stripeSubscriptionId) {
      continue;
    }

    let stripeSubscription: Stripe.Subscription;

    try {
      stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
      throw new Error(`[RIDVAN-E1221] Failed to fetch Stripe subscription ${stripeSubscriptionId}: ${message}`);
    }

    checked += 1;

    const dbStatus = subscription.status ?? 'unknown';
    const stripeStatus = stripeSubscription.status;

    if (dbStatus !== stripeStatus) {
      mismatches.push({
        userId: subscription.user_id,
        stripeSubscriptionId,
        dbStatus,
        stripeStatus,
      });
    }
  }

  return { mismatches, checked };
}
