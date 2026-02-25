import type { MetaFunction } from '@remix-run/cloudflare';
import { PricingPage } from '~/components/pricing/PricingPage';

export const meta: MetaFunction = () => {
  return [{ title: 'Pricing — Ridvan' }];
};

export default function PricingRoute() {
  return <PricingPage />;
}
