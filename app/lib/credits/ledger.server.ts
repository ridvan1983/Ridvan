import { supabaseAdmin } from '~/lib/supabase/server';

export type CreditLedgerEntry = {
  id: string;
  user_id: string;
  amount: number;
  balance_after: number;
  type: 'deduction' | 'grant' | 'reset' | 'webhook';
  description: string | null;
  reference_id: string | null;
  created_at: string;
};

export async function recordCreditTransaction(args: {
  userId: string;
  amount: number;
  balanceAfter: number;
  type: 'deduction' | 'grant' | 'reset' | 'webhook';
  description?: string;
  referenceId?: string;
}) {
  const { error } = await supabaseAdmin.from('credit_ledger').insert({
    user_id: args.userId,
    amount: args.amount,
    balance_after: args.balanceAfter,
    type: args.type,
    description: args.description ?? null,
    reference_id: args.referenceId ?? null,
  });

  if (error) {
    throw new Error(`[RIDVAN-E1224] Failed to record credit transaction: ${error.message}`);
  }
}

export async function getUserCreditHistory(userId: string, limit = 50) {
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 200) : 50;

  const { data, error } = await supabaseAdmin
    .from('credit_ledger')
    .select('id, user_id, amount, balance_after, type, description, reference_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(safeLimit)
    .returns<CreditLedgerEntry[]>();

  if (error) {
    throw new Error(`[RIDVAN-E1225] Failed to load credit history: ${error.message}`);
  }

  return data ?? [];
}
