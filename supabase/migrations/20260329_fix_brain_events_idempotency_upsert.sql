CREATE UNIQUE INDEX IF NOT EXISTS brain_events_workspace_idempotency_key_uq
ON public.brain_events (workspace_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;
