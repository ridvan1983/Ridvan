/**
 * Stripe top-up packs (one-time payments). Price IDs come from Cloudflare env at runtime — see `getOptionalServerEnv(pack.envKey, ...)` on the server.
 */
export type TopupPackId =
  | 'topup_25'
  | 'topup_100'
  | 'topup_300'
  | 'topup_750'
  | 'topup_2000'
  | 'topup_5000';

export type TopupPackDefinition = {
  id: TopupPackId;
  /** Env var name holding Stripe Price ID (e.g. STRIPE_PRICE_ID_TOPUP_25) */
  envKey: string;
  credits: number;
  /** Display price in EUR (whole euros) */
  priceEur: number;
  label: string;
};

export const TOPUP_PACKS: readonly TopupPackDefinition[] = [
  { id: 'topup_25', envKey: 'STRIPE_PRICE_ID_TOPUP_25', credits: 25, priceEur: 5, label: '25 credits' },
  { id: 'topup_100', envKey: 'STRIPE_PRICE_ID_TOPUP_100', credits: 100, priceEur: 15, label: '100 credits' },
  { id: 'topup_300', envKey: 'STRIPE_PRICE_ID_TOPUP_300', credits: 300, priceEur: 35, label: '300 credits' },
  { id: 'topup_750', envKey: 'STRIPE_PRICE_ID_TOPUP_750', credits: 750, priceEur: 75, label: '750 credits' },
  { id: 'topup_2000', envKey: 'STRIPE_PRICE_ID_TOPUP_2000', credits: 2000, priceEur: 150, label: '2000 credits' },
  { id: 'topup_5000', envKey: 'STRIPE_PRICE_ID_TOPUP_5000', credits: 5000, priceEur: 300, label: '5000 credits' },
] as const;

export function getTopupPackById(packId: string): TopupPackDefinition | undefined {
  return TOPUP_PACKS.find((p) => p.id === packId);
}
