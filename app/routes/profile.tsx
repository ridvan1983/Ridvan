import { json, type MetaFunction } from '@remix-run/cloudflare';
import { Link, useNavigate } from '@remix-run/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Header } from '~/components/header/Header';
import TopUpModal from '~/components/credits/TopUpModal';
import { brand } from '~/config/brand';
import { PAID_PLAN_CHECKOUT_DISPLAY, type PaidPlanId } from '~/config/paid-plans';
import { useAuth } from '~/lib/auth/AuthContext';
import { CREDIT_REFRESH_EVENT } from '~/components/credits/CreditDisplay';

export const meta: MetaFunction = () => {
  return [{ title: 'Profil — Ridvan' }];
};

export async function loader() {
  return json({});
}

type ProfileApi = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  plan: string;
  planDisplayName: string;
  subscriptionStatus: string;
  remainingCredits: number;
  monthlyCreditsBalance: number | null;
  dailyCreditsBalance: number | null;
  periodBudget: number;
  currentPeriodEnd: string | null;
};

type LedgerRow = {
  id: string;
  createdAt: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string | null;
};

const FREE_PLAN_ROW = {
  id: 'free' as const,
  name: 'Free',
  priceLabel: '€0',
  monthlyCredits: 5,
};

function planRowsForOverview() {
  return [
    FREE_PLAN_ROW,
    ...PAID_PLAN_CHECKOUT_DISPLAY.map((p) => ({
      id: p.id as PaidPlanId | 'free',
      name: p.name,
      priceLabel: p.priceLabel,
      monthlyCredits: p.monthlyCredits,
    })),
  ];
}

function ledgerTypeLabel(type: string): string {
  const t = type.toLowerCase();
  if (t === 'free_signup') {
    return 'Registrering';
  }
  if (t === 'topup') {
    return 'Påfyllning';
  }
  if (t === 'manual_grant') {
    return 'Manuellt tilldelad';
  }
  if (t === 'deduction') {
    return 'Förbrukning';
  }
  if (t === 'grant') {
    return 'Tilldelning';
  }
  if (t === 'reset') {
    return 'Återställning';
  }
  if (t === 'webhook') {
    return 'Fakturering';
  }
  return type;
}

function initialsFrom(name: string, email: string) {
  const n = name.trim();
  if (n.length >= 2) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return n.slice(0, 2).toUpperCase();
  }
  const e = email.trim();
  if (e.length >= 2) {
    return e.slice(0, 2).toUpperCase();
  }
  return '?';
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold tracking-tight text-bolt-elements-textPrimary">{children}</h2>;
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

export default function ProfileRoute() {
  const navigate = useNavigate();
  const { user, session, loading: authLoading, signOut } = useAuth();
  const [profile, setProfile] = useState<ProfileApi | null>(null);
  const [history, setHistory] = useState<LedgerRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [checkoutPlanId, setCheckoutPlanId] = useState<PaidPlanId | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const token = session?.access_token;

  const loadAll = useCallback(async () => {
    if (!token) {
      setFetching(false);
      return;
    }
    setLoadError(null);
    setFetching(true);
    try {
      const [pRes, hRes] = await Promise.all([
        fetch('/api/profile', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/credits/history', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (!pRes.ok) {
        const j = (await pRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? 'Kunde inte ladda profil');
      }
      if (!hRes.ok) {
        const j = (await hRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? 'Kunde inte ladda historik');
      }
      const p = (await pRes.json()) as ProfileApi;
      const h = (await hRes.json()) as { entries: LedgerRow[] };
      setProfile(p);
      setHistory(h.entries ?? []);
      setNameDraft(p.displayName);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Något gick fel');
      setProfile(null);
    } finally {
      setFetching(false);
    }
  }, [token]);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!user || !token) {
      navigate(`/login?redirectTo=${encodeURIComponent('/profile')}`, { replace: true });
      return;
    }
    void loadAll();
  }, [authLoading, user, token, navigate, loadAll]);

  useEffect(() => {
    const onRefresh = () => {
      void loadAll();
    };
    window.addEventListener(CREDIT_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(CREDIT_REFRESH_EVENT, onRefresh);
  }, [loadAll]);

  const overviewPlans = useMemo(() => planRowsForOverview(), []);

  const saveName = async () => {
    if (!token || savingName) {
      return;
    }
    setSavingName(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ displayName: nameDraft.trim() }),
      });
      const j = (await res.json().catch(() => null)) as { displayName?: string; error?: string };
      if (!res.ok) {
        throw new Error(j?.error ?? 'Kunde inte spara namn');
      }
      setProfile((prev) =>
        prev ? { ...prev, displayName: typeof j.displayName === 'string' ? j.displayName : nameDraft.trim() } : prev,
      );
      setEditingName(false);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Kunde inte spara');
    } finally {
      setSavingName(false);
    }
  };

  const startCheckout = async (planId: PaidPlanId) => {
    if (!token || checkoutPlanId) {
      return;
    }
    setCheckoutPlanId(planId);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ planId }),
      });
      const payload = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? 'Checkout misslyckades');
      }
      if (payload.url) {
        window.location.href = payload.url;
        return;
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Checkout misslyckades');
    } finally {
      setCheckoutPlanId(null);
    }
  };

  const deleteAccount = async () => {
    if (!token || deleting || deleteConfirm !== 'DELETE_MY_ACCOUNT') {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ confirm: 'DELETE_MY_ACCOUNT' }),
      });
      const j = (await res.json().catch(() => null)) as { error?: string };
      if (!res.ok) {
        throw new Error(j?.error ?? 'Kunde inte radera konto');
      }
      await signOut();
      navigate('/login', { replace: true });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Kunde inte radera konto');
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
      setDeleteConfirm('');
    }
  };

  const handleSignOut = async () => {
    if (signingOut) {
      return;
    }
    setSigningOut(true);
    try {
      await signOut();
      navigate('/login', { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  const barTotal = profile ? Math.max(profile.periodBudget, profile.remainingCredits, 1) : 1;
  const remainingPct = profile ? Math.min(100, (profile.remainingCredits / barTotal) * 100) : 0;
  const usedPct = profile ? Math.max(0, 100 - remainingPct) : 0;

  const formattedCreated = profile
    ? new Date(profile.createdAt).toLocaleDateString('sv-SE', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  const formattedPeriodEnd = profile?.currentPeriodEnd
    ? new Date(profile.currentPeriodEnd).toLocaleDateString('sv-SE', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  if (authLoading || (!user && !loadError)) {
    return (
      <div className="flex h-full w-full flex-col">
        <Header />
        <main className="flex flex-1 items-center justify-center bg-bolt-elements-background-depth-1 text-bolt-elements-textSecondary">
          Laddar…
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-full w-full flex-col">
      <Header />
      <main className="flex-1 bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
          <div className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Profil</h1>
            <p className="mt-1 text-sm text-bolt-elements-textSecondary">Konto, credits och plan</p>
          </div>

          {loadError ? (
            <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{loadError}</div>
          ) : null}

          {fetching && !profile ? (
            <div className="text-bolt-elements-textSecondary">Hämtar din profil…</div>
          ) : profile ? (
            <div className="flex flex-col gap-8">
              {/* 1 — User */}
              <Card className="p-6 sm:p-8">
                <SectionTitle>Användarprofil</SectionTitle>
                <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start">
                  <div
                    className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl text-2xl font-semibold text-white shadow-md"
                    style={{
                      backgroundImage: `linear-gradient(135deg, ${brand.gradient.from}, ${brand.gradient.to})`,
                    }}
                    aria-hidden
                  >
                    {initialsFrom(profile.displayName, profile.email)}
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-bolt-elements-textSecondary">Namn</div>
                      {editingName ? (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            value={nameDraft}
                            onChange={(e) => setNameDraft(e.target.value)}
                            className="min-w-[12rem] flex-1 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary outline-none focus:border-bolt-elements-item-contentAccent"
                            placeholder="Visningsnamn"
                            maxLength={120}
                          />
                          <button
                            type="button"
                            disabled={savingName}
                            onClick={() => void saveName()}
                            className="rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                            style={{
                              backgroundImage: `linear-gradient(90deg, ${brand.gradient.from}, ${brand.gradient.to})`,
                            }}
                          >
                            {savingName ? 'Sparar…' : 'Spara'}
                          </button>
                          <button
                            type="button"
                            disabled={savingName}
                            onClick={() => {
                              setNameDraft(profile.displayName);
                              setEditingName(false);
                            }}
                            className="rounded-lg border border-bolt-elements-borderColor px-3 py-2 text-sm text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-3"
                          >
                            Avbryt
                          </button>
                        </div>
                      ) : (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="text-lg font-semibold">
                            {profile.displayName || 'Inget visningsnamn'}
                          </span>
                          <button
                            type="button"
                            onClick={() => setEditingName(true)}
                            className="text-sm font-medium text-violet-600 hover:text-violet-500 dark:text-violet-400"
                          >
                            Redigera
                          </button>
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-bolt-elements-textSecondary">E-post</div>
                      <div className="mt-1 text-sm">{profile.email}</div>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-bolt-elements-textSecondary">
                      <span>
                        <span className="text-bolt-elements-textPrimary/80">Konto skapat:</span> {formattedCreated}
                      </span>
                      <span>
                        <span className="text-bolt-elements-textPrimary/80">Plan:</span> {profile.planDisplayName}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>

              {/* 2 — Credits */}
              <Card className="p-6 sm:p-8">
                <SectionTitle>Credits &amp; plan</SectionTitle>
                <div className="mt-6">
                  <div className="text-4xl font-bold tracking-tight sm:text-5xl">{profile.remainingCredits}</div>
                  <div className="mt-1 text-sm text-bolt-elements-textSecondary">credits kvar</div>
                  <div className="mt-6 h-3 w-full overflow-hidden rounded-full bg-bolt-elements-background-depth-3">
                    <div className="flex h-full w-full">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-500"
                        style={{ width: `${remainingPct}%` }}
                        title="Kvar"
                      />
                      <div
                        className="h-full bg-bolt-elements-borderColor transition-all duration-500"
                        style={{ width: `${usedPct}%` }}
                        title="Använt (inom periodbudget)"
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-bolt-elements-textSecondary">
                    Jämfört med periodbudget ({profile.periodBudget} credits/månad för {profile.planDisplayName}). Vid rollover kan saldot vara högre.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2 text-sm">
                    <span className="rounded-lg border border-bolt-elements-borderColor px-3 py-1.5">
                      Nuvarande plan: <strong className="text-bolt-elements-textPrimary">{profile.planDisplayName}</strong>
                    </span>
                    {formattedPeriodEnd ? (
                      <span className="rounded-lg border border-bolt-elements-borderColor px-3 py-1.5 text-bolt-elements-textSecondary">
                        Nästa period / förnyelse: <strong className="text-bolt-elements-textPrimary">{formattedPeriodEnd}</strong>
                      </span>
                    ) : (
                      <span className="rounded-lg border border-bolt-elements-borderColor px-3 py-1.5 text-bolt-elements-textSecondary">
                        Credits för gratisplan förnyas inte automatiskt via prenumeration.
                      </span>
                    )}
                  </div>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link
                      to="/pricing"
                      className="inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm"
                      style={{
                        backgroundImage: `linear-gradient(90deg, ${brand.gradient.from}, ${brand.gradient.to})`,
                      }}
                    >
                      Uppgradera plan
                    </Link>
                    <button
                      type="button"
                      onClick={() => setTopUpOpen(true)}
                      className="inline-flex items-center justify-center rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-5 py-2.5 text-sm font-semibold text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3"
                    >
                      Köp mer credits
                    </button>
                  </div>
                </div>
              </Card>

              {/* 3 — Plans */}
              <Card className="p-6 sm:p-8">
                <SectionTitle>Planöversikt</SectionTitle>
                <p className="mt-2 text-sm text-bolt-elements-textSecondary">Välj en plan — du omdirigeras till säker betalning med Stripe.</p>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {overviewPlans.map((row) => {
                    const isCurrent =
                      row.id === 'free' ? profile.plan === 'free' : profile.plan === row.id;
                    const isPaid = row.id !== 'free';
                    return (
                      <div
                        key={row.id}
                        className={`relative flex flex-col rounded-xl border p-5 ${
                          isCurrent
                            ? 'border-violet-500/60 bg-violet-500/5'
                            : 'border-bolt-elements-borderColor bg-bolt-elements-background-depth-1'
                        }`}
                      >
                        {isCurrent ? (
                          <span className="absolute right-3 top-3 rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-300">
                            Nuvarande
                          </span>
                        ) : null}
                        <div className="text-lg font-semibold">{row.name}</div>
                        <div className="mt-1 text-2xl font-bold">{row.priceLabel}</div>
                        <div className="mt-2 text-sm text-bolt-elements-textSecondary">{row.monthlyCredits} credits / månad</div>
                        <div className="mt-4 flex-1" />
                        {isCurrent ? (
                          <button
                            type="button"
                            disabled
                            className="mt-4 w-full rounded-lg border border-bolt-elements-borderColor py-2.5 text-sm font-medium text-bolt-elements-textSecondary"
                          >
                            Din plan
                          </button>
                        ) : isPaid ? (
                          <button
                            type="button"
                            disabled={checkoutPlanId !== null}
                            onClick={() => void startCheckout(row.id as PaidPlanId)}
                            className="mt-4 w-full rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                            style={{
                              backgroundImage: `linear-gradient(90deg, ${brand.gradient.from}, ${brand.gradient.to})`,
                            }}
                          >
                            {checkoutPlanId === row.id ? 'Öppnar…' : 'Välj plan'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="mt-4 w-full rounded-lg border border-bolt-elements-borderColor py-2.5 text-sm text-bolt-elements-textSecondary"
                          >
                            Basplan
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* 4 — History */}
              <Card className="overflow-hidden p-0">
                <div className="border-b border-bolt-elements-borderColor px-6 py-5 sm:px-8">
                  <SectionTitle>Credit-historik</SectionTitle>
                  <p className="mt-1 text-sm text-bolt-elements-textSecondary">Senaste 20 händelserna från credit_ledger.</p>
                </div>
                <div className="overflow-x-auto">
                  {history.length === 0 ? (
                    <div className="px-6 py-10 text-center text-sm text-bolt-elements-textSecondary sm:px-8">
                      Ingen historik ännu.
                    </div>
                  ) : (
                    <table className="w-full min-w-[32rem] text-left text-sm">
                      <thead className="border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-3/50 text-xs uppercase tracking-wide text-bolt-elements-textSecondary">
                        <tr>
                          <th className="px-4 py-3 sm:px-6">Datum</th>
                          <th className="px-4 py-3">Typ</th>
                          <th className="px-4 py-3 text-right">Belopp</th>
                          <th className="px-4 py-3 sm:pr-6">Beskrivning</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((row) => {
                          const positive = row.amount >= 0;
                          return (
                            <tr key={row.id} className="border-b border-bolt-elements-borderColor/80 last:border-0">
                              <td className="whitespace-nowrap px-4 py-3 text-bolt-elements-textSecondary sm:px-6">
                                {new Date(row.createdAt).toLocaleString('sv-SE', {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                })}
                              </td>
                              <td className="px-4 py-3">{ledgerTypeLabel(row.type)}</td>
                              <td
                                className={`px-4 py-3 text-right font-medium tabular-nums ${
                                  positive ? 'text-emerald-500' : 'text-red-400'
                                }`}
                              >
                                {positive ? '+' : ''}
                                {row.amount}
                              </td>
                              <td className="max-w-[14rem] truncate px-4 py-3 text-bolt-elements-textSecondary sm:max-w-xs sm:pr-6">
                                {row.description ?? '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </Card>

              {/* 5 — Settings */}
              <Card className="p-6 sm:p-8">
                <SectionTitle>Inställningar</SectionTitle>
                <div className="mt-6 flex flex-col gap-3">
                  <Link
                    to="/forgot-password"
                    className="inline-flex w-fit rounded-lg border border-bolt-elements-borderColor px-4 py-2.5 text-sm font-medium text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3"
                  >
                    Byt lösenord (återställning via e-post)
                  </Link>
                  <button
                    type="button"
                    onClick={() => setDeleteOpen(true)}
                    className="inline-flex w-fit rounded-lg border border-red-500/50 px-4 py-2.5 text-sm font-medium text-red-400 hover:bg-red-500/10"
                  >
                    Radera konto
                  </button>
                  <button
                    type="button"
                    disabled={signingOut}
                    onClick={() => void handleSignOut()}
                    className="inline-flex w-fit rounded-lg border border-bolt-elements-borderColor px-4 py-2.5 text-sm font-medium text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-3 disabled:opacity-50"
                  >
                    {signingOut ? 'Loggar ut…' : 'Logga ut'}
                  </button>
                </div>
              </Card>
            </div>
          ) : null}
        </div>
      </main>

      <TopUpModal isOpen={topUpOpen} onClose={() => setTopUpOpen(false)} />

      {deleteOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-6 shadow-2xl">
            <h2 id="delete-account-title" className="text-lg font-semibold text-bolt-elements-textPrimary">
              Radera konto?
            </h2>
            <p className="mt-2 text-sm text-bolt-elements-textSecondary">
              Detta kan inte ångras. All data kopplad till ditt konto kan tas bort. Skriv{' '}
              <code className="rounded bg-bolt-elements-background-depth-3 px-1 py-0.5 text-xs">DELETE_MY_ACCOUNT</code> för att
              bekräfta.
            </p>
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              className="mt-4 w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm"
              placeholder="DELETE_MY_ACCOUNT"
              autoComplete="off"
            />
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDeleteOpen(false);
                  setDeleteConfirm('');
                }}
                className="rounded-lg border border-bolt-elements-borderColor px-4 py-2 text-sm"
              >
                Avbryt
              </button>
              <button
                type="button"
                disabled={deleting || deleteConfirm !== 'DELETE_MY_ACCOUNT'}
                onClick={() => void deleteAccount()}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {deleting ? 'Raderar…' : 'Radera permanent'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
