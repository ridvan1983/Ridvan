CREATE TABLE IF NOT EXISTS public.error_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now() NOT NULL,
  level text NOT NULL DEFAULT 'error',
  message text NOT NULL,
  stack text,
  route text,
  user_id uuid,
  metadata jsonb,
  resolved boolean DEFAULT false NOT NULL
);

CREATE INDEX IF NOT EXISTS error_logs_created_at_idx ON public.error_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS error_logs_resolved_created_at_idx ON public.error_logs (resolved, created_at DESC);
