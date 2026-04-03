import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Form, Link, useLoaderData, useRevalidator } from '@remix-run/react';
import { useState } from 'react';
import { AdminNav } from '~/components/admin/AdminNav';
import { getUserCreditHistory, type CreditLedgerEntry } from '~/lib/credits/ledger.server';
import {
  ADMIN_SESSION_VALUE,
  buildAdminSessionCookie,
  clearAdminSessionCookie,
  getAdminSecret,
  isAdminPageAuthenticated,
} from '~/lib/server/admin-auth.server';
import { PLANS } from '~/lib/stripe/config';
import { supabaseAdmin } from '~/lib/supabase/server';

type SubscriptionDetail = {
  user_id: string;
  plan: string | null;
  status: string | null;
  monthly_credits: number | null;
  daily_credits: number | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  current_period_end: string | null;
  updated_at: string | null;
};

type LoaderData =
  | { authenticated: false; error: string | null }
  | {
      authenticated: true;
      error: null;
      userId: string;
      email: string | null;
      subscription: SubscriptionDetail | null;
      ledger: CreditLedgerEntry[];
    }
  | { authenticated: true; error: 'not_found'; userId: string };

const PLAN_OPTIONS = ['free', 'starter', 'pro', 'business'] as const;

export async function action({ context, request }: ActionFunctionArgs) {
  const adminSecret = getAdminSecret(context);
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'logout') {
    const url = new URL(request.url);
    return redirect(`${url.pathname}`, {
      headers: { 'Set-Cookie': clearAdminSessionCookie() },
    });
  }

  const secret = typeof formData.get('secret') === 'string' ? String(formData.get('secret')) : '';

  if (!adminSecret || secret !== adminSecret) {
    const url = new URL(request.url);
    return redirect(`${url.pathname}?error=invalid_secret`);
  }

  const url = new URL(request.url);
  return redirect(url.pathname, {
    headers: { 'Set-Cookie': buildAdminSessionCookie(ADMIN_SESSION_VALUE, 60 * 60 * 8) },
  });
}

export async function loader({ context, request, params }: LoaderFunctionArgs): Promise<Response> {
  const adminSecret = getAdminSecret(context);
  const url = new URL(request.url);
  const error = url.searchParams.get('error') === 'invalid_secret' ? 'Invalid admin secret.' : null;
  const userId = params.userId?.trim() ?? '';

  if (!userId) {
    return Response.json({ authenticated: true, error: 'not_found', userId: '' } satisfies LoaderData);
  }

  if (!isAdminPageAuthenticated(request, adminSecret)) {
    return Response.json({ authenticated: false, error } satisfies LoaderData);
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);

  if (userError || !userData?.user) {
    return Response.json({ authenticated: true, error: 'not_found', userId } satisfies LoaderData);
  }

  const { data: subRow, error: subError } = await supabaseAdmin
    .from('subscriptions')
    .select(
      'user_id, plan, status, monthly_credits, daily_credits, stripe_subscription_id, stripe_customer_id, current_period_end, updated_at',
    )
    .eq('user_id', userId)
    .maybeSingle<SubscriptionDetail>();

  if (subError && subError.code !== 'PGRST116') {
    throw new Error(`[RIDVAN-E1280] ${subError.message}`);
  }

  const ledger = await getUserCreditHistory(userId, 500);

  return Response.json({
    authenticated: true,
    error: null,
    userId,
    email: userData.user.email ?? null,
    subscription: subRow ?? null,
    ledger,
  } satisfies LoaderData);
}

function formatTime(iso: string | null | undefined) {
  if (!iso) {
    return '—';
  }

  try {
    return new Date(iso).toLocaleString('sv-SE');
  } catch {
    return iso;
  }
}

export default function AdminBillingUserRoute() {
  const data = useLoaderData<typeof loader>() as LoaderData;
  const revalidator = useRevalidator();
  const [grantAmount, setGrantAmount] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<string>('free');
  const [busy, setBusy] = useState<'grant' | 'plan' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  if (!data.authenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <h1 className="text-2xl font-semibold">Billing — användare</h1>
          <p className="mt-2 text-sm text-slate-400">Admin-inloggning krävs.</p>
          <Form method="post" className="mt-6 space-y-4">
            <div>
              <label htmlFor="secret" className="mb-2 block text-sm text-slate-300">
                Admin secret
              </label>
              <input
                id="secret"
                name="secret"
                type="password"
                required
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none focus:border-sky-500"
              />
            </div>
            {data.error ? <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{data.error}</div> : null}
            <button type="submit" className="w-full rounded-xl bg-sky-600 px-4 py-3 font-medium text-white hover:bg-sky-500">
              Logga in
            </button>
          </Form>
        </div>
      </div>
    );
  }

  if (data.error === 'not_found') {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
        <div className="mx-auto max-w-3xl space-y-4">
          <AdminNav />
          <p className="text-slate-300">Användaren hittades inte.</p>
          <Link to="/admin/billing" className="text-sky-400 hover:underline">
            ← Till billing
          </Link>
        </div>
      </div>
    );
  }

  const { email, subscription, ledger, userId } = data;

  const runGrant = async () => {
    setFormError(null);
    setBusy('grant');
    try {
      const res = await fetch('/api/admin/billing/grant-credits', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          amount: Number(grantAmount),
          reason: grantReason.trim(),
        }),
      });
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setFormError(payload?.error ?? 'Kunde inte tilldela credits');
        return;
      }

      setGrantAmount('');
      setGrantReason('');
      revalidator.revalidate();
    } catch {
      setFormError('Nätverksfel');
    } finally {
      setBusy(null);
    }
  };

  const runChangePlan = async () => {
    setFormError(null);
    setBusy('plan');
    try {
      const res = await fetch('/api/admin/billing/change-plan', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, planId: selectedPlan }),
      });
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setFormError(payload?.error ?? 'Kunde inte ändra plan');
        return;
      }

      revalidator.revalidate();
    } catch {
      setFormError('Nätverksfel');
    } finally {
      setBusy(null);
    }
  };

  const creditsLeft = (subscription?.monthly_credits ?? 0) + (subscription?.daily_credits ?? 0);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <AdminNav />
            <div>
              <Link to="/admin/billing" className="text-sm text-sky-400 hover:underline">
                ← Billing
              </Link>
              <h1 className="mt-2 text-3xl font-semibold">Användare</h1>
              <p className="mt-1 font-mono text-sm text-slate-400">{email ?? userId}</p>
            </div>
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="logout" />
            <button type="submit" className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-900">
              Logga ut
            </button>
          </Form>
        </div>

        {formError ? <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{formError}</div> : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-2 text-sm">
            <h2 className="text-lg font-semibold text-white">Subscription</h2>
            <div>Plan: {subscription?.plan ?? 'free'}</div>
            <div>Status: {subscription?.status ?? '—'}</div>
            <div>Credits kvar: {creditsLeft}</div>
            <div className="font-mono text-xs break-all">Stripe customer: {subscription?.stripe_customer_id ?? '—'}</div>
            <div className="font-mono text-xs break-all">Stripe subscription: {subscription?.stripe_subscription_id ?? '—'}</div>
            <div>Period slut: {formatTime(subscription?.current_period_end)}</div>
            <div>Uppdaterad: {formatTime(subscription?.updated_at)}</div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
            <h2 className="text-lg font-semibold text-white">Åtgärder</h2>
            <div className="space-y-2">
              <div className="text-xs text-slate-400">Ge credits manuellt</div>
              <input
                type="number"
                min={1}
                value={grantAmount}
                onChange={(e) => setGrantAmount(e.target.value)}
                placeholder="Antal"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
              <input
                value={grantReason}
                onChange={(e) => setGrantReason(e.target.value)}
                placeholder="Anledning (obligatorisk)"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={busy !== null}
                onClick={runGrant}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy === 'grant' ? '…' : 'Ge credits'}
              </button>
            </div>
            <div className="space-y-2 border-t border-slate-800 pt-4">
              <div className="text-xs text-slate-400">Ändra plan</div>
              <select
                value={selectedPlan}
                onChange={(e) => setSelectedPlan(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                {PLAN_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p} ({PLANS[p].name}) — {PLANS[p].monthlyCredits} credits/mån
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy !== null}
                onClick={runChangePlan}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {busy === 'plan' ? '…' : 'Spara plan'}
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-lg font-semibold text-white mb-3">Credit ledger (senaste {ledger.length})</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="text-left text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-2 py-2">Tid</th>
                  <th className="px-2 py-2">Typ</th>
                  <th className="px-2 py-2">Amount</th>
                  <th className="px-2 py-2">Balance after</th>
                  <th className="px-2 py-2">Beskrivning</th>
                </tr>
              </thead>
              <tbody>
                {ledger.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-2 py-4 text-slate-500">
                      Inga transaktioner.
                    </td>
                  </tr>
                ) : (
                  ledger.map((row) => (
                    <tr key={row.id} className="border-t border-slate-800/80">
                      <td className="px-2 py-2 whitespace-nowrap">{formatTime(row.created_at)}</td>
                      <td className="px-2 py-2">{row.type}</td>
                      <td className="px-2 py-2">{row.amount}</td>
                      <td className="px-2 py-2">{row.balance_after}</td>
                      <td className="px-2 py-2 max-w-md break-words">{row.description ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
