import { PLANS } from '~/lib/stripe/config';
import { supabaseAdmin } from '~/lib/supabase/server';

interface CreditCheckResult {
  allowed: boolean;
  remaining: number;
  plan: string;
}

interface SubscriptionRow {
  plan: string | null;
  monthly_credits: number | null;
  daily_credits: number | null;
}

export async function checkCredits(userId: string): Promise<CreditCheckResult> {
  const fallback: CreditCheckResult = {
    allowed: false,
    remaining: 0,
    plan: 'free',
  };

  try {
    const { data: subscriptionData, error: subscriptionError } = await supabaseAdmin
      .from('subscriptions')
      .select('plan, monthly_credits, daily_credits')
      .eq('user_id', userId)
      .maybeSingle<SubscriptionRow>();

    if (subscriptionError && subscriptionError.code !== 'PGRST116') {
      throw new Error(`[RIDVAN-E011] Failed to query subscription: ${subscriptionError.message}`);
    }

    const planKey = (subscriptionData?.plan ?? 'free') as keyof typeof PLANS;
    const planConfig = PLANS[planKey] ?? PLANS.free;

    const monthlyCredits = subscriptionData?.monthly_credits ?? planConfig.monthlyCredits;
    const dailyCredits = subscriptionData?.daily_credits ?? planConfig.dailyCredits;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const { data: transactions, error: transactionError } = await supabaseAdmin
      .from('credit_transactions')
      .select('amount')
      .eq('user_id', userId)
      .eq('type', 'generation')
      .gte('created_at', startOfToday.toISOString());

    if (transactionError) {
      throw new Error(`[RIDVAN-E011] Failed to query credit transactions: ${transactionError.message}`);
    }

    const usedToday = (transactions ?? []).reduce((sum, row) => {
      const amount = typeof row.amount === 'number' ? row.amount : 0;
      return sum + Math.abs(Math.min(amount, 0));
    }, 0);

    const remaining = Math.max(monthlyCredits + dailyCredits - usedToday, 0);

    return {
      allowed: remaining > 0,
      remaining,
      plan: planKey,
    };
  } catch (error) {
    console.error(error);
    return fallback;
  }
}
