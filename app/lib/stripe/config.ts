import Stripe from 'stripe';
import { requireServerEnv } from '~/lib/env.server';

let cachedStripe: Stripe | null = null;

function getStripeClient() {
  if (cachedStripe) {
    return cachedStripe;
  }

  const stripeSecretKey = requireServerEnv('STRIPE_SECRET_KEY', undefined, '[RIDVAN-E010] Missing required environment variable');
  cachedStripe = new Stripe(stripeSecretKey, {
    apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion,
  });

  return cachedStripe;
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    return Reflect.get(getStripeClient(), prop, receiver);
  },
});

export const PLANS = {
  free: { name: 'Free', price: 0, monthlyCredits: 50, dailyCredits: 0, rolloverPercent: 0 },
  starter: { name: 'Starter', price: 1900, monthlyCredits: 200, dailyCredits: 0, rolloverPercent: 20 },
  pro: { name: 'Pro', price: 5900, monthlyCredits: 800, dailyCredits: 0, rolloverPercent: 20 },
  business: { name: 'Agency', price: 14900, monthlyCredits: 2500, dailyCredits: 0, rolloverPercent: 25 },
} as const;
