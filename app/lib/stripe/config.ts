import Stripe from 'stripe';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  throw new Error('[RIDVAN-E010] Missing STRIPE_SECRET_KEY');
}

export const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion,
});

export const PLANS = {
  free: { name: 'Free', price: 0, monthlyCredits: 0, dailyCredits: 5, rolloverPercent: 0 },
  starter: { name: 'Starter', price: 1900, monthlyCredits: 100, dailyCredits: 5, rolloverPercent: 20 },
  pro: { name: 'Pro', price: 4900, monthlyCredits: 300, dailyCredits: 5, rolloverPercent: 20 },
  business: { name: 'Business', price: 9900, monthlyCredits: 800, dailyCredits: 5, rolloverPercent: 25 },
} as const;
