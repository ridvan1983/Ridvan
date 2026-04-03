import { useState } from 'react';
import { toast } from 'react-toastify';
import { TOPUP_PACKS, type TopupPackId } from '~/config/topup-packs';
import { brand } from '~/config/brand';
import { useAuth } from '~/lib/auth/AuthContext';

function formatEur(amount: number) {
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);
}

function formatEurPerCredit(priceEur: number, credits: number) {
  if (credits <= 0) {
    return '—';
  }

  const per = priceEur / credits;
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(per);
}

interface TopUpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function TopUpModal({ isOpen, onClose }: TopUpModalProps) {
  const { session } = useAuth();
  const [loadingPackId, setLoadingPackId] = useState<TopupPackId | null>(null);

  if (!isOpen) {
    return null;
  }

  const startCheckout = async (packId: TopupPackId) => {
    if (!session?.access_token || loadingPackId) {
      return;
    }

    setLoadingPackId(packId);

    try {
      const response = await fetch('/api/stripe/topup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ packId }),
      });

      const payload = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;

      if (!response.ok) {
        const message =
          payload && typeof payload.error === 'string' ? payload.error : '[RIDVAN-E1244] Kunde inte starta köp';
        toast.error(message);
        return;
      }

      if (payload?.url) {
        onClose();
        window.location.assign(payload.url);
        return;
      }

      toast.error('[RIDVAN-E1245] Ingen betalningslänk returnerades');
    } catch (error) {
      const message = error instanceof Error ? error.message : '[RIDVAN-E1244] Kunde inte starta köp';
      toast.error(message);
    } finally {
      setLoadingPackId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
      role="button"
      tabIndex={-1}
      aria-label="Stäng"
    >
      <div
        className="w-full max-w-4xl rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 shadow-2xl p-6 max-h-[90vh] overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="topup-modal-title"
      >
        <h2 id="topup-modal-title" className="text-2xl font-semibold text-bolt-elements-textPrimary">
          Köp mer credits
        </h2>
        <p className="mt-2 text-sm text-bolt-elements-textSecondary">Engångsköp — credits läggs till efter lyckad betalning.</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TOPUP_PACKS.map((pack) => (
            <button
              key={pack.id}
              type="button"
              className="text-left rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-4 flex flex-col gap-2 transition-theme hover:border-bolt-elements-item-contentAccent/50 hover:bg-bolt-elements-background-depth-3 disabled:opacity-60"
              onClick={() => startCheckout(pack.id)}
              disabled={loadingPackId !== null}
            >
              <div className="font-semibold text-bolt-elements-textPrimary">{pack.label}</div>
              <div className="text-2xl font-bold text-bolt-elements-textPrimary">{formatEur(pack.priceEur)}</div>
              <div className="text-xs text-bolt-elements-textSecondary">
                {formatEurPerCredit(pack.priceEur, pack.credits)} per credit
              </div>
              <div
                className="mt-2 inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold text-white"
                style={{
                  backgroundImage: `linear-gradient(90deg, ${brand.gradient.from}, ${brand.gradient.to})`,
                }}
              >
                {loadingPackId === pack.id ? 'Omdirigerar…' : 'Välj'}
              </div>
            </button>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            className="rounded-lg border border-bolt-elements-borderColor px-4 py-2 text-sm text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3"
            onClick={onClose}
          >
            Stäng
          </button>
        </div>
      </div>
    </div>
  );
}
