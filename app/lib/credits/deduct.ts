import { supabaseAdmin } from '~/lib/supabase/server';
import { checkCredits } from './check';

interface DeductCreditResult {
  success: boolean;
  remaining: number;
  error?: string;
}

export async function deductCredit(userId: string, description: string): Promise<DeductCreditResult> {
  const creditState = await checkCredits(userId);

  if (!creditState.allowed) {
    return {
      success: false,
      remaining: creditState.remaining,
      error: 'No credits remaining',
    };
  }

  try {
    const { data: subscription, error: subscriptionError } = await supabaseAdmin
      .from('subscriptions')
      .select('daily_credits, monthly_credits')
      .eq('user_id', userId)
      .maybeSingle<{ daily_credits: number | null; monthly_credits: number | null }>();

    if (subscriptionError && subscriptionError.code !== 'PGRST116') {
      throw new Error(`[RIDVAN-E012] Failed to load subscription balances: ${subscriptionError.message}`);
    }

    const dailyCredits = subscription?.daily_credits ?? 0;
    const monthlyCredits = subscription?.monthly_credits ?? 0;

    if (dailyCredits > 0) {
      const { error: updateError } = await supabaseAdmin
        .from('subscriptions')
        .update({ daily_credits: dailyCredits - 1 })
        .eq('user_id', userId);

      if (updateError) {
        throw new Error(`[RIDVAN-E012] Failed to deduct daily credit: ${updateError.message}`);
      }
    } else if (monthlyCredits > 0) {
      const { error: updateError } = await supabaseAdmin
        .from('subscriptions')
        .update({ monthly_credits: monthlyCredits - 1 })
        .eq('user_id', userId);

      if (updateError) {
        throw new Error(`[RIDVAN-E012] Failed to deduct monthly credit: ${updateError.message}`);
      }
    } else {
      return {
        success: false,
        remaining: 0,
        error: 'No credits remaining',
      };
    }

    const { error } = await supabaseAdmin.from('credit_transactions').insert({
      user_id: userId,
      amount: -1,
      type: 'generation',
      description,
    });

    if (error) {
      throw new Error(`[RIDVAN-E012] Failed to deduct credit: ${error.message}`);
    }

    return {
      success: true,
      remaining: Math.max(creditState.remaining - 1, 0),
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
