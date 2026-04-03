import { supabaseAdmin } from '~/lib/supabase/server';
import { checkAndResetDailyCredits } from './daily-reset';

const SIGNUP_BONUS_AMOUNT = 0;
const SIGNUP_DESCRIPTION = 'Välkommen! 5 gratis credits';

/**
 * One-time welcome credits after registration. Idempotent: unique partial index on credit_ledger (user_id) WHERE type = 'free_signup'.
 * Inserts ledger first so a second concurrent call hits the unique constraint instead of double-counting the subscription.
 */
export async function grantFreeSignupCreditsIfEligible(userId: string): Promise<{ granted: boolean }> {
  if (SIGNUP_BONUS_AMOUNT <= 0) {
    return { granted: false };
  }

  await checkAndResetDailyCredits(userId);

  const { data: subscription, error: subError } = await supabaseAdmin
    .from('subscriptions')
    .select('monthly_credits, daily_credits')
    .eq('user_id', userId)
    .maybeSingle<{ monthly_credits: number | null; daily_credits: number | null }>();

  if (subError && subError.code !== 'PGRST116') {
    throw new Error(`[RIDVAN-E1226] Failed to load subscription for signup bonus: ${subError.message}`);
  }

  const monthly = subscription?.monthly_credits ?? 0;
  const daily = subscription?.daily_credits ?? 0;
  const newMonthly = monthly + SIGNUP_BONUS_AMOUNT;
  const balanceAfter = newMonthly + daily;

  const { error: insertError } = await supabaseAdmin.from('credit_ledger').insert({
    user_id: userId,
    amount: SIGNUP_BONUS_AMOUNT,
    balance_after: balanceAfter,
    type: 'free_signup',
    description: SIGNUP_DESCRIPTION,
  });

  if (insertError?.code === '23505') {
    return { granted: false };
  }

  if (insertError) {
    throw new Error(`[RIDVAN-E1227] Failed to record signup bonus: ${insertError.message}`);
  }

  const { error: updateError } = await supabaseAdmin
    .from('subscriptions')
    .update({ monthly_credits: newMonthly })
    .eq('user_id', userId);

  if (updateError) {
    throw new Error(`[RIDVAN-E1228] Failed to apply signup bonus to balance: ${updateError.message}`);
  }

  return { granted: true };
}
