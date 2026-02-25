import { supabaseAdmin } from '~/lib/supabase/server';
import { PLANS } from '~/lib/stripe/config';

interface SubscriptionResetRow {
  plan: string | null;
  daily_credits: number | null;
  updated_at: string | null;
}

export async function checkAndResetDailyCredits(userId: string): Promise<void> {
  const { data: subscription, error } = await supabaseAdmin
    .from('subscriptions')
    .select('plan, daily_credits, updated_at')
    .eq('user_id', userId)
    .maybeSingle<SubscriptionResetRow>();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`[RIDVAN-E011] Failed to query subscription for daily reset: ${error.message}`);
  }

  if (!subscription) {
    const { error: insertError } = await supabaseAdmin.from('subscriptions').insert({
      user_id: userId,
      plan: 'free',
      monthly_credits: PLANS.free.monthlyCredits,
      daily_credits: PLANS.free.dailyCredits,
      status: 'active',
    });

    if (insertError) {
      throw new Error(`[RIDVAN-E011] Failed to create default subscription: ${insertError.message}`);
    }

    return;
  }

  const now = new Date();
  const updatedAt = subscription.updated_at ? new Date(subscription.updated_at) : null;
  const planKey = (subscription.plan ?? 'free') as keyof typeof PLANS;
  const planDailyCredits = PLANS[planKey]?.dailyCredits ?? PLANS.free.dailyCredits;

  if (!updatedAt || getUTCDateKey(updatedAt) !== getUTCDateKey(now)) {
    const { error: updateError } = await supabaseAdmin
      .from('subscriptions')
      .update({
        daily_credits: planDailyCredits,
        updated_at: now.toISOString(),
      })
      .eq('user_id', userId);

    if (updateError) {
      throw new Error(`[RIDVAN-E011] Failed to reset daily credits: ${updateError.message}`);
    }
  }
}

function getUTCDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
}
