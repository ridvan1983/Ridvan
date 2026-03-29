import { supabaseAdmin } from '~/lib/supabase/server';

type StripeWebhookEventRow = {
  id: string;
  type: string;
  processed_at: string;
  status: string;
  error: string | null;
};

export async function isEventProcessed(eventId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('stripe_webhook_events')
    .select('id, status')
    .eq('id', eventId)
    .maybeSingle<{ id: string; status: string }>();

  if (error) {
    throw new Error(`[RIDVAN-E1210] Failed to load Stripe webhook event: ${error.message}`);
  }

  return Boolean(data?.id && data.status === 'processed');
}

export async function markEventProcessed(eventId: string, type: string): Promise<void> {
  const { error } = await supabaseAdmin.from('stripe_webhook_events').upsert(
    {
      id: eventId,
      type,
      status: 'processed',
      processed_at: new Date().toISOString(),
      error: null,
    } satisfies Partial<StripeWebhookEventRow>,
    { onConflict: 'id' },
  );

  if (error) {
    throw new Error(`[RIDVAN-E1211] Failed to mark Stripe webhook event as processed: ${error.message}`);
  }
}

export async function markEventFailed(eventId: string, type: string, errorMessage: string): Promise<void> {
  const { error } = await supabaseAdmin.from('stripe_webhook_events').upsert(
    {
      id: eventId,
      type,
      status: 'failed',
      processed_at: new Date().toISOString(),
      error: errorMessage,
    } satisfies Partial<StripeWebhookEventRow>,
    { onConflict: 'id' },
  );

  if (error) {
    throw new Error(`[RIDVAN-E1212] Failed to mark Stripe webhook event as failed: ${error.message}`);
  }
}
