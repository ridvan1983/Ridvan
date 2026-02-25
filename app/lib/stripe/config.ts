import Stripe from 'stripe';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  throw new Error('[RIDVAN-E010] Missing STRIPE_SECRET_KEY');
}

export const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion,
});

export const PLANS = {
  free: { name: 'Free', price: 0, monthlyCredits: 50, dailyCredits: 0, rolloverPercent: 0 },
  starter: { name: 'Starter', price: 1900, monthlyCredits: 200, dailyCredits: 0, rolloverPercent: 20 },
  pro: { name: 'Pro', price: 5900, monthlyCredits: 800, dailyCredits: 0, rolloverPercent: 20 },
  business: { name: 'Agency', price: 14900, monthlyCredits: 2500, dailyCredits: 0, rolloverPercent: 25 },
} as const;
