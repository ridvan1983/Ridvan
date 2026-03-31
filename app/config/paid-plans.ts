/**
 * Paid plan ids sent to POST /api/stripe/checkout (`planId`).
 * Must match ~/lib/stripe/config PLANS keys and STRIPE_PRICE_ID_* env names.
 */
export type PaidPlanId = 'starter' | 'pro' | 'business';

export const PAID_PLAN_CHECKOUT_ORDER: readonly PaidPlanId[] = ['starter', 'pro', 'business'];

export const PAID_PLAN_CHECKOUT_DISPLAY: Array<{
  id: PaidPlanId;
  name: string;
  priceLabel: string;
  monthlyCredits: number;
}> = [
  { id: 'starter', name: 'Starter', priceLabel: '€19', monthlyCredits: 200 },
  { id: 'pro', name: 'Pro', priceLabel: '€49', monthlyCredits: 800 },
  { id: 'business', name: 'Business', priceLabel: '€99', monthlyCredits: 2500 },
];
