import { useNavigate } from '@remix-run/react';
import { useState } from 'react';
import { brand } from '~/config/brand';
import { useAuth } from '~/lib/auth/AuthContext';

type PaidPlanId = 'starter' | 'pro' | 'business';

interface PaidPlan {
  id: PaidPlanId;
  name: string;
  price: string;
  monthlyCredits: string;
  dailyBonus: string;
  rollover: string;
  popular?: boolean;
}

const paidPlans: PaidPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: '€19/month',
    monthlyCredits: '100 monthly credits',
    dailyBonus: '+5 daily bonus credits',
    rollover: '20% rollover',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '€49/month',
    monthlyCredits: '300 monthly credits',
    dailyBonus: '+5 daily bonus credits',
    rollover: '20% rollover',
    popular: true,
  },
  {
    id: 'business',
    name: 'Business',
    price: '€99/month',
    monthlyCredits: '800 monthly credits',
    dailyBonus: '+5 daily bonus credits',
    rollover: '25% rollover',
  },
];

export function PricingPage() {
  const navigate = useNavigate();
  const { user, session, signOut } = useAuth();
  const [loadingPlanId, setLoadingPlanId] = useState<PaidPlanId | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);

    try {
      await signOut();
      navigate('/login', { replace: true });
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleUpgrade = async (planId: PaidPlanId) => {
    if (!session?.access_token) {
      window.location.href = `/login?redirectTo=${encodeURIComponent('/pricing')}`;
      return;
    }

    setLoadingPlanId(planId);

    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ planId }),
      });

      if (!response.ok) {
        throw new Error('Failed to create checkout session');
      }

      const payload = (await response.json()) as { url?: string };

      if (payload.url) {
        window.location.href = payload.url;
        return;
      }
    } finally {
      setLoadingPlanId(null);
    }
  };

  return (
    <div className="min-h-screen bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="mb-10 flex items-center justify-between gap-3">
          <a href="/" className="text-xl font-semibold">
            {brand.appName}
          </a>
          <div className="flex items-center gap-2">
            {user ? (
              <>
                <a
                  href="/chat"
                  className="rounded-lg border border-bolt-elements-borderColor px-3 py-1.5 text-sm hover:bg-bolt-elements-background-depth-3"
                >
                  Chat
                </a>
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="rounded-lg border border-bolt-elements-borderColor px-3 py-1.5 text-sm text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3 disabled:opacity-60"
                >
                  {isSigningOut ? 'Logging out...' : 'Log out'}
                </button>
              </>
            ) : (
              <a
                href={`/login?redirectTo=${encodeURIComponent('/pricing')}`}
                className="rounded-lg border border-bolt-elements-borderColor px-3 py-1.5 text-sm hover:bg-bolt-elements-background-depth-3"
              >
                Log in
              </a>
            )}
          </div>
        </div>
        <div className="text-center">
          <h1 className="text-4xl sm:text-5xl font-bold">Simple, transparent pricing</h1>
          <p className="mt-4 text-bolt-elements-textSecondary">
            Choose a plan that fits your build speed with {brand.appName}.
          </p>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-4">
          <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-6 flex flex-col">
            <div>
              <div className="text-lg font-semibold">Free</div>
              <div className="mt-2 text-3xl font-bold">€0/month</div>
              <ul className="mt-4 space-y-2 text-sm text-bolt-elements-textSecondary">
                <li>5 credits per day</li>
                <li>No monthly credits</li>
                <li>No rollover</li>
              </ul>
            </div>
            <a
              href={`/login?redirectTo=${encodeURIComponent('/pricing')}`}
              className="mt-6 inline-flex justify-center rounded-lg border border-bolt-elements-borderColor px-4 py-2 text-sm font-medium hover:bg-bolt-elements-background-depth-3"
            >
              Get Started
            </a>
          </div>

          {paidPlans.map((plan) => (
            <div
              key={plan.id}
              className={`rounded-xl border p-6 flex flex-col ${
                plan.popular
                  ? 'border-bolt-elements-item-contentAccent bg-bolt-elements-background-depth-2 shadow-lg shadow-black/20'
                  : 'border-bolt-elements-borderColor bg-bolt-elements-background-depth-2'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold">{plan.name}</div>
                  {plan.popular ? (
                    <span className="text-xs px-2 py-1 rounded-full bg-bolt-elements-item-contentAccent text-white">
                      Most Popular
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 text-3xl font-bold">{plan.price}</div>
                <ul className="mt-4 space-y-2 text-sm text-bolt-elements-textSecondary">
                  <li>{plan.monthlyCredits}</li>
                  <li>{plan.dailyBonus}</li>
                  <li>{plan.rollover}</li>
                </ul>
              </div>
              <button
                className="mt-6 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundImage: `linear-gradient(90deg, ${brand.gradient.from}, ${brand.gradient.to})` }}
                onClick={() => handleUpgrade(plan.id)}
                disabled={loadingPlanId !== null}
              >
                {loadingPlanId === plan.id ? 'Redirecting...' : 'Upgrade'}
              </button>
            </div>
          ))}
        </div>

        <div className="mt-16 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-6">
          <h2 className="text-2xl font-semibold">FAQ</h2>
          <div className="mt-6 space-y-5 text-sm">
            <div>
              <div className="font-medium">How do credits work?</div>
              <p className="mt-1 text-bolt-elements-textSecondary">
                Every generation uses credits. Paid plans include a monthly pool plus 5 daily bonus credits.
              </p>
            </div>
            <div>
              <div className="font-medium">Do unused credits roll over?</div>
              <p className="mt-1 text-bolt-elements-textSecondary">
                Yes, paid plans roll over part of your remaining monthly credits based on your plan percentage.
              </p>
            </div>
            <div>
              <div className="font-medium">Can I upgrade later?</div>
              <p className="mt-1 text-bolt-elements-textSecondary">
                Yes. You can upgrade any time and checkout will take you through a secure Stripe payment flow.
              </p>
            </div>
            <div>
              <div className="font-medium">What happens on cancellation?</div>
              <p className="mt-1 text-bolt-elements-textSecondary">
                Your subscription is marked cancelled and plan benefits stop at the end of your billing period.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
