import { json, type MetaFunction } from '@remix-run/cloudflare';
import { LandingPage } from '~/components/landing/LandingPage';

export const meta: MetaFunction = () => {
  return [{ title: 'Ridvan — Build apps with AI' }];
};

export const loader = () => json({});

export default function Index() {
  return <LandingPage />;
}
