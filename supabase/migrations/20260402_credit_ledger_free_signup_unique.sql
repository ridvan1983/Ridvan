-- At most one welcome bonus row per user (idempotent signup bonus).
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_ledger_one_free_signup_per_user
  ON public.credit_ledger (user_id)
  WHERE (type = 'free_signup');
