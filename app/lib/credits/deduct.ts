import { supabaseAdmin } from '~/lib/supabase/server';
import { checkCredits } from './check';

interface DeductCreditResult {
  success: boolean;
  remaining: number;
  error?: string;
}

interface SubscriptionBalanceRow {
  daily_credits: number | null;
  monthly_credits: number | null;
}

const MAX_DEDUCTION_RETRIES = 3;

export async function deductCredit(userId: string, description: string, amount: number = 1): Promise<DeductCreditResult> {
  const normalizedAmount = Math.max(1, Math.floor(amount));
  const creditState = await checkCredits(userId);

  if (!creditState.allowed) {
    return {
      success: false,
      remaining: creditState.remaining,
      error: 'No credits remaining',
    };
  }

  try {
    let updatedBalance: SubscriptionBalanceRow | null = null;

    for (let attempt = 0; attempt < MAX_DEDUCTION_RETRIES; attempt++) {
      const { data: subscription, error: subscriptionError } = await supabaseAdmin
        .from('subscriptions')
        .select('daily_credits, monthly_credits')
        .eq('user_id', userId)
        .maybeSingle<SubscriptionBalanceRow>();

      if (subscriptionError && subscriptionError.code !== 'PGRST116') {
        throw new Error(`[RIDVAN-E012] Failed to load subscription balances: ${subscriptionError.message}`);
      }

      const dailyCredits = subscription?.daily_credits ?? 0;
      const monthlyCredits = subscription?.monthly_credits ?? 0;

      if (dailyCredits >= normalizedAmount) {
        const { data: dailyUpdate, error: dailyUpdateError } = await supabaseAdmin
          .from('subscriptions')
          .update({ daily_credits: dailyCredits - normalizedAmount })
          .eq('user_id', userId)
          .eq('daily_credits', dailyCredits)
          .gte('daily_credits', normalizedAmount)
          .select('daily_credits, monthly_credits')
          .maybeSingle<SubscriptionBalanceRow>();

        if (dailyUpdateError) {
          throw new Error(`[RIDVAN-E012] Failed to deduct daily credit: ${dailyUpdateError.message}`);
        }

        if (dailyUpdate) {
          updatedBalance = dailyUpdate;
          break;
        }

        continue;
      }

      if (monthlyCredits >= normalizedAmount) {
        const { data: monthlyUpdate, error: monthlyUpdateError } = await supabaseAdmin
          .from('subscriptions')
          .update({ monthly_credits: monthlyCredits - normalizedAmount })
          .eq('user_id', userId)
          .eq('monthly_credits', monthlyCredits)
          .gte('monthly_credits', normalizedAmount)
          .select('daily_credits, monthly_credits')
          .maybeSingle<SubscriptionBalanceRow>();

        if (monthlyUpdateError) {
          throw new Error(`[RIDVAN-E012] Failed to deduct monthly credit: ${monthlyUpdateError.message}`);
        }

        if (monthlyUpdate) {
          updatedBalance = monthlyUpdate;
          break;
        }

        continue;
      }

      return {
        success: false,
        remaining: Math.max(dailyCredits + monthlyCredits, 0),
        error: 'No credits remaining',
      };
    }

    if (!updatedBalance) {
      return {
        success: false,
        remaining: creditState.remaining,
        error: '[RIDVAN-E012] Failed to deduct credit',
      };
    }

    const { error } = await supabaseAdmin.from('credit_transactions').insert({
      user_id: userId,
      amount: -normalizedAmount,
      type: 'generation',
      description,
    });

    if (error) {
      throw new Error(`[RIDVAN-E012] Failed to deduct credit: ${error.message}`);
    }

    return {
      success: true,
      remaining: Math.max((updatedBalance.daily_credits ?? 0) + (updatedBalance.monthly_credits ?? 0), 0),
    };
  } catch (error) {
    console.error(error);
    return {
      success: false,
      remaining: creditState.remaining,
      error: '[RIDVAN-E012] Failed to deduct credit',
    };
  }
}
