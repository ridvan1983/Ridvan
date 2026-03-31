import { useState } from 'react';
import { toast } from 'react-toastify';
import { PAID_PLAN_CHECKOUT_DISPLAY, type PaidPlanId } from '~/config/paid-plans';
import { useAuth } from '~/lib/auth/AuthContext';

interface OutOfCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function OutOfCreditsModal({ isOpen, onClose }: OutOfCreditsModalProps) {
  const { session } = useAuth();
  const [loadingPlanId, setLoadingPlanId] = useState<PaidPlanId | null>(null);

  if (!isOpen) {
    return null;
  }

  const startCheckout = async (planId: PaidPlanId) => {
    if (!session?.access_token || loadingPlanId) {
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

      const payload = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;

      if (!response.ok) {
        const message =
          payload && typeof payload.error === 'string' ? payload.error : '[RIDVAN-E408] Failed to create checkout session';
        toast.error(message);
        return;
      }

      if (payload?.url) {
        onClose();
        window.location.assign(payload.url);
        return;
      }

      toast.error('[RIDVAN-E409] Checkout started but no redirect URL was returned');
    } catch (error) {
      const message = error instanceof Error ? error.message : '[RIDVAN-E408] Failed to create checkout session';
      toast.error(message);
    } finally {
      setLoadingPlanId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
      role="button"
      tabIndex={-1}
    >
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl p-6" onClick={(event) => event.stopPropagation()}>
        <h2 className="text-2xl font-semibold text-gray-900">You've run out of credits</h2>
        <p className="mt-2 text-sm text-gray-600">Upgrade your plan to keep building</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {PAID_PLAN_CHECKOUT_DISPLAY.map((plan) => (
            <div key={plan.id} className="rounded-lg border border-gray-200 p-4 flex flex-col gap-3">
              <div>
                <div className="text-sm font-medium text-gray-900">{plan.name}</div>
                <div className="mt-1 text-2xl font-semibold text-gray-900">{plan.priceLabel}</div>
                <div className="mt-1 text-xs text-gray-500">{plan.monthlyCredits} monthly credits</div>
              </div>
              <button
                className="mt-auto rounded-md bg-bolt-elements-item-contentAccent text-white text-sm px-3 py-2 hover:opacity-90 disabled:opacity-60"
                onClick={() => startCheckout(plan.id)}
                disabled={loadingPlanId !== null}
              >
                {loadingPlanId === plan.id ? 'Redirecting...' : 'Upgrade'}
              </button>
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
