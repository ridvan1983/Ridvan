CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'processed',
  error TEXT
);
