import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import Stripe from 'stripe';
import { markEventFailed, markEventProcessed } from '~/lib/billing/webhook-events.server';
import { getAdminSecret, requireAdminApi } from '~/lib/server/admin-auth.server';
import { captureError } from '~/lib/server/monitoring.server';
import { PLANS, stripe } from '~/lib/stripe/config';
import { supabaseAdmin } from '~/lib/supabase/server';

type FailedWebhookRow = {
  id: string;
  type: string;
  status: string;
  error: string | null;
  processed_at: string | null;
};

async function processStripeEvent(event: Stripe.Event) {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;
    const planId = session.metadata?.planId as keyof typeof PLANS | undefined;
    const plan = planId ? PLANS[planId] : undefined;

    if (userId && planId && plan) {
      await supabaseAdmin.from('subscriptions').upsert(
        {
          user_id: userId,
          plan: planId,
          stripe_subscription_id: typeof session.subscription === 'string' ? session.subscription : null,
          monthly_credits: plan.monthlyCredits,
          daily_credits: plan.dailyCredits,
          status: 'active',
        },
        { onConflict: 'user_id' },
      );
    }

    return;
  }

  if (event.type === 'invoice.paid') {
    const invoice = event.data.object as Stripe.Invoice;
    const invoiceSubscription = (invoice as { subscription?: string | Stripe.Subscription | null }).subscription;
    const subscriptionId = typeof invoiceSubscription === 'string' ? invoiceSubscription : null;

    if (!subscriptionId) {
      return;
    }

    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('user_id, plan, monthly_credits')
      .eq('stripe_subscription_id', subscriptionId)
      .maybeSingle<{ user_id: string; plan: keyof typeof PLANS | null; monthly_credits: number | null }>();

    if (!subscription?.user_id) {
      return;
    }

    const planKey = (subscription.plan ?? 'free') as keyof typeof PLANS;
    const plan = PLANS[planKey] ?? PLANS.free;
    const currentRemaining = subscription.monthly_credits ?? 0;
    const rolloverCredits = Math.floor(currentRemaining * (plan.rolloverPercent / 100));
    const rolledCarry = Math.min(rolloverCredits, plan.monthlyCredits);
    const nextCredits = rolledCarry + plan.monthlyCredits;

    await supabaseAdmin.from('subscriptions').update({ monthly_credits: nextCredits, status: 'active' }).eq('stripe_subscription_id', subscriptionId);
    return;
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription;
    const subscriptionId = subscription.id;

    if (!subscriptionId) {
      return;
    }

    await supabaseAdmin
      .from('subscriptions')
      .update({
        status: 'cancelled',
        plan: 'free',
        monthly_credits: PLANS.free.monthlyCredits,
        daily_credits: PLANS.free.dailyCredits,
      })
      .eq('stripe_subscription_id', subscriptionId);
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const adminSecret = getAdminSecret(context);

  try {
    requireAdminApi(request, adminSecret);
  } catch (response) {
    return response as Response;
  }

  const contentType = request.headers.get('content-type') ?? '';
  let eventId: string | null = null;

  if (contentType.includes('application/json')) {
    const body = (await request.json().catch(() => null)) as { eventId?: string } | null;
    eventId = body?.eventId?.trim() ?? null;
  } else {
    const formData = await request.formData();
    const raw = formData.get('eventId');
    eventId = typeof raw === 'string' ? raw.trim() : null;
  }

  if (!eventId) {
    return Response.json({ error: '[RIDVAN-E1233] Missing eventId' }, { status: 400 });
  }

  const { data: failedEvent, error: failedEventError } = await supabaseAdmin
    .from('stripe_webhook_events')
    .select('id, type, status, error, processed_at')
    .eq('id', eventId)
    .eq('status', 'failed')
    .maybeSingle<FailedWebhookRow>();

  if (failedEventError) {
    return Response.json({ error: `[RIDVAN-E1234] Failed to load webhook event: ${failedEventError.message}` }, { status: 500 });
  }

  if (!failedEvent) {
    return Response.json({ error: '[RIDVAN-E1235] Failed webhook event not found' }, { status: 404 });
  }

  let event: Stripe.Event;

  try {
    event = await stripe.events.retrieve(eventId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
    captureError(error, {
      route: 'api.admin.webhooks.replay',
      extra: { eventId, stage: 'stripe.events.retrieve' },
    });
    return Response.json({ error: `[RIDVAN-E1236] Failed to retrieve Stripe event: ${message}` }, { status: 500 });
  }

  try {
    await processStripeEvent(event);
    await markEventProcessed(event.id, event.type);
    return Response.json({ ok: true, eventId: event.id, status: 'processed' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Stripe webhook replay error';

    try {
      await markEventFailed(event.id, event.type, message);
    } catch (markError) {
      captureError(markError, {
        route: 'api.admin.webhooks.replay',
        extra: { eventId: event.id, eventType: event.type, stage: 'markEventFailed' },
      });
    }

    captureError(error, {
      route: 'api.admin.webhooks.replay',
      extra: { eventId: event.id, eventType: event.type },
    });

    return Response.json({ error: `[RIDVAN-E1237] ${message}` }, { status: 500 });
  }
}
