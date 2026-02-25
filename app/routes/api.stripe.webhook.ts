import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import Stripe from 'stripe';
import { PLANS, stripe } from '~/lib/stripe/config';
import { supabaseAdmin } from '~/lib/supabase/server';

export async function action({ context, request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const signature = request.headers.get('stripe-signature');
  const secret = (context.cloudflare?.env as any)?.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !secret) {
    return Response.json({ error: '[RIDVAN-E404] Webhook signature verification failed' }, { status: 400 });
  }

  const payload = await request.text();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret);
  } catch {
    return Response.json({ error: '[RIDVAN-E404] Webhook signature verification failed' }, { status: 400 });
  }

  try {
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
    } else if (event.type === 'invoice.paid') {
      const invoice = event.data.object as Stripe.Invoice;
      const invoiceSubscription = (invoice as any).subscription;
      const subscriptionId = typeof invoiceSubscription === 'string' ? invoiceSubscription : null;

      if (subscriptionId) {
        const { data: subscription } = await supabaseAdmin
          .from('subscriptions')
          .select('user_id, plan, monthly_credits')
          .eq('stripe_subscription_id', subscriptionId)
          .maybeSingle<{ user_id: string; plan: keyof typeof PLANS | null; monthly_credits: number | null }>();

        if (subscription?.user_id) {
          const planKey = (subscription.plan ?? 'free') as keyof typeof PLANS;
          const plan = PLANS[planKey] ?? PLANS.free;
          const currentRemaining = subscription.monthly_credits ?? 0;
          const rolloverCredits = Math.floor(currentRemaining * (plan.rolloverPercent / 100));
          const rolledCarry = Math.min(rolloverCredits, plan.monthlyCredits);
          const nextCredits = rolledCarry + plan.monthlyCredits;

          await supabaseAdmin
            .from('subscriptions')
            .update({ monthly_credits: nextCredits, status: 'active' })
            .eq('stripe_subscription_id', subscriptionId);
        }
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription;
      const subscriptionId = subscription.id;

      if (subscriptionId) {
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

    return Response.json({ received: true });
  } catch {
    return Response.json({ received: true });
  }
}
