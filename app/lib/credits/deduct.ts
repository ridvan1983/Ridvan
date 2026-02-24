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
