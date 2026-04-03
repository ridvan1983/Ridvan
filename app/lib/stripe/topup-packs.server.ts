import { TOPUP_PACKS, type TopupPackDefinition, type TopupPackId } from '~/config/topup-packs';
import { getOptionalServerEnv } from '~/lib/env.server';

export function resolveTopupStripePriceId(packId: TopupPackId, envSource: unknown): string | null {
  const pack = TOPUP_PACKS.find((p) => p.id === packId);
  if (!pack) {
    return null;
  }

  return getOptionalServerEnv(pack.envKey, envSource) ?? null;
}

/** Match a Stripe Price ID from checkout line items to a configured pack (validates payment). */
export function findTopupPackByStripePriceId(priceId: string, envSource: unknown): TopupPackDefinition | undefined {
  for (const pack of TOPUP_PACKS) {
    const configured = getOptionalServerEnv(pack.envKey, envSource);
    if (configured && configured === priceId) {
      return pack;
    }
  }

  return undefined;
}
