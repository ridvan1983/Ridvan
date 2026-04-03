-- Optional columns for billing dashboard (nullable until Stripe sync writes them)
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz;

-- Aggregated billing row per auth user (no ORDER BY — sort in application)
CREATE OR REPLACE VIEW public.admin_billing_overview AS
SELECT
  u.id AS user_id,
  COALESCE(u.email::text, '') AS email,
  s.plan,
  s.status,
  s.monthly_credits,
  s.daily_credits,
  s.stripe_customer_id,
  s.stripe_subscription_id,
  s.current_period_end,
  s.updated_at AS subscription_updated_at,
  COALESCE(
    (SELECT SUM(cl.amount) FROM public.credit_ledger cl WHERE cl.user_id = u.id),
    0
  )::bigint AS total_credits_granted,
  COALESCE(
    (SELECT COUNT(*)::bigint FROM public.credit_ledger cl2 WHERE cl2.user_id = u.id),
    0
  ) AS total_transactions
FROM auth.users u
LEFT JOIN public.subscriptions s ON s.user_id = u.id;
