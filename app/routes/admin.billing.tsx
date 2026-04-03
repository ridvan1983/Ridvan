import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Form, Link, useLoaderData, useOutlet } from '@remix-run/react';
import { Fragment, useMemo, useState } from 'react';
import { AdminNav } from '~/components/admin/AdminNav';
import { getUserCreditHistory } from '~/lib/credits/ledger.server';
import {
  ADMIN_SESSION_VALUE,
  buildAdminSessionCookie,
  clearAdminSessionCookie,
  getAdminSecret,
  isAdminPageAuthenticated,
} from '~/lib/server/admin-auth.server';
import { PLANS } from '~/lib/stripe/config';
import { supabaseAdmin } from '~/lib/supabase/server';

export type AdminBillingOverviewRow = {
  user_id: string;
  email: string;
  plan: string | null;
  status: string | null;
  monthly_credits: number | null;
  daily_credits: number | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  subscription_updated_at: string | null;
  total_credits_granted: number;
  total_transactions: number;
};

type LoaderData =
  | { authenticated: false; error: string | null }
  | {
      authenticated: true;
      error: null;
      rows: AdminBillingOverviewRow[];
      stats: {
        totalUsers: number;
        planCounts: Record<string, number>;
        mrrCents: number;
      };
      planFilter: string;
      previewLedgerByUserId: Record<string, Awaited<ReturnType<typeof getUserCreditHistory>>>;
    };

const PLAN_FILTER_KEYS = ['all', 'free', 'starter', 'pro', 'business'] as const;

function isPaidPlanForMrr(plan: string | null, status: string | null) {
  const p = (plan ?? 'free').toLowerCase();
  const st = (status ?? '').toLowerCase();
  if (p === 'free' || !st.includes('active')) {
    return false;
  }

  return p === 'starter' || p === 'pro' || p === 'business';
}

export async function action({ context, request }: ActionFunctionArgs) {
  const adminSecret = getAdminSecret(context);
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'logout') {
    return redirect('/admin/billing', {
      headers: { 'Set-Cookie': clearAdminSessionCookie() },
    });
  }

  const secret = typeof formData.get('secret') === 'string' ? String(formData.get('secret')) : '';

  if (!adminSecret || secret !== adminSecret) {
    return redirect('/admin/billing?error=invalid_secret');
  }

  return redirect('/admin/billing', {
    headers: { 'Set-Cookie': buildAdminSessionCookie(ADMIN_SESSION_VALUE, 60 * 60 * 8) },
  });
}

export async function loader({ context, request }: LoaderFunctionArgs): Promise<Response> {
  const adminSecret = getAdminSecret(context);
  const url = new URL(request.url);
  const error = url.searchParams.get('error') === 'invalid_secret' ? 'Invalid admin secret.' : null;

  if (!isAdminPageAuthenticated(request, adminSecret)) {
    return Response.json({ authenticated: false, error } satisfies LoaderData);
  }

  const planParam = url.searchParams.get('plan') ?? 'all';
  const planFilter = PLAN_FILTER_KEYS.includes(planParam as (typeof PLAN_FILTER_KEYS)[number]) ? planParam : 'all';

  const { data: rawRows, error: viewError } = await supabaseAdmin
    .from('admin_billing_overview')
    .select('*')
    .returns<AdminBillingOverviewRow[]>();

  if (viewError) {
    throw new Error(`[RIDVAN-E1255] admin_billing_overview: ${viewError.message}`);
  }

  let rows = rawRows ?? [];

  if (planFilter !== 'all') {
    rows = rows.filter((row) => (row.plan ?? 'free').toLowerCase() === planFilter);
  }

  rows = [...rows].sort((a, b) => {
    const ta = a.subscription_updated_at ? new Date(a.subscription_updated_at).getTime() : 0;
    const tb = b.subscription_updated_at ? new Date(b.subscription_updated_at).getTime() : 0;
    return tb - ta;
  });

  const planCounts: Record<string, number> = { free: 0, starter: 0, pro: 0, business: 0, other: 0 };
  let mrrCents = 0;

  for (const row of rawRows ?? []) {
    const key = (row.plan ?? 'free').toLowerCase();
    if (key in planCounts) {
      planCounts[key] += 1;
    } else {
      planCounts.other += 1;
    }

    if (isPaidPlanForMrr(row.plan, row.status)) {
      const pk = key as keyof typeof PLANS;
      if (pk in PLANS && pk !== 'free') {
        mrrCents += PLANS[pk].price;
      }
    }
  }

  const previewLedgerByUserId: Record<string, Awaited<ReturnType<typeof getUserCreditHistory>>> = {};
  const previewIds = rows.slice(0, 50).map((r) => r.user_id);

  await Promise.all(
    previewIds.map(async (uid) => {
      try {
        previewLedgerByUserId[uid] = await getUserCreditHistory(uid, 20);
      } catch {
        previewLedgerByUserId[uid] = [];
      }
    }),
  );

  return Response.json({
    authenticated: true,
    error: null,
    rows,
    stats: {
      totalUsers: rawRows?.length ?? 0,
      planCounts,
      mrrCents,
    },
    planFilter,
    previewLedgerByUserId,
  } satisfies LoaderData);
}

function formatEurFromCents(cents: number) {
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
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

export default function AdminBillingRoute() {
  const outlet = useOutlet();
  const data = useLoaderData<typeof loader>() as LoaderData;
  const [query, setQuery] = useState('');
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const filteredRows = useMemo(() => {
    if (!data.authenticated) {
      return [];
    }

    const q = query.trim().toLowerCase();
    if (!q) {
      return data.rows;
    }

    return data.rows.filter((row) => (row.email ?? '').toLowerCase().includes(q));
  }, [data, query]);

  if (outlet) {
    return outlet;
  }

  if (!data.authenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <h1 className="text-2xl font-semibold">Billing admin</h1>
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

  const { stats, planFilter, previewLedgerByUserId } = data;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <AdminNav />
            <div>
              <h1 className="text-3xl font-semibold">Billing</h1>
              <p className="mt-2 text-sm text-slate-400">Vy baserad på admin_billing_overview + credit ledger.</p>
            </div>
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="logout" />
            <button type="submit" className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-900">
              Logga ut
            </button>
          </Form>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="text-sm text-slate-400">Användare totalt</div>
            <div className="mt-2 text-3xl font-semibold">{stats.totalUsers}</div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="text-sm text-slate-400">MRR (aktiva betalplaner)</div>
            <div className="mt-2 text-3xl font-semibold">{formatEurFromCents(stats.mrrCents)}</div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:col-span-2">
            <div className="text-sm text-slate-400">Per plan</div>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              <span>free: {stats.planCounts.free}</span>
              <span>starter: {stats.planCounts.starter}</span>
              <span>pro: {stats.planCounts.pro}</span>
              <span>business: {stats.planCounts.business}</span>
              {stats.planCounts.other > 0 ? <span>övriga: {stats.planCounts.other}</span> : null}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sök e‑post…"
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm outline-none md:max-w-md focus:border-sky-500"
          />
          <div className="flex flex-wrap gap-2 text-sm">
            {(['all', 'free', 'starter', 'pro', 'business'] as const).map((p) => (
              <Link
                key={p}
                to={p === 'all' ? '/admin/billing' : `/admin/billing?plan=${p}`}
                className={`rounded-lg border px-3 py-1.5 ${
                  planFilter === p ? 'border-sky-500 bg-sky-500/10 text-sky-200' : 'border-slate-700 text-slate-300 hover:bg-slate-900'
                }`}
              >
                {p === 'all' ? 'Alla planer' : p}
              </Link>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-slate-400">
              <tr>
                <th className="px-3 py-2">E‑post</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2">Credits kvar</th>
                <th className="px-3 py-2">Stripe sub</th>
                <th className="px-3 py-2">Period slut</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-slate-500" colSpan={6}>
                    Inga rader.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const creditsLeft = (row.monthly_credits ?? 0) + (row.daily_credits ?? 0);
                  const open = expandedUserId === row.user_id;
                  const preview = previewLedgerByUserId[row.user_id] ?? [];

                  return (
                    <Fragment key={row.user_id}>
                      <tr className="border-t border-slate-800/80 align-top">
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="text-left text-sky-300 hover:underline font-mono text-xs md:text-sm"
                            onClick={() => setExpandedUserId(open ? null : row.user_id)}
                          >
                            {row.email || row.user_id}
                          </button>
                        </td>
                        <td className="px-3 py-2">{row.plan ?? 'free'}</td>
                        <td className="px-3 py-2">{creditsLeft}</td>
                        <td className="px-3 py-2 font-mono text-xs max-w-[140px] truncate" title={row.stripe_subscription_id ?? ''}>
                          {row.stripe_subscription_id ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{formatTime(row.current_period_end)}</td>
                        <td className="px-3 py-2 text-right">
                          <Link to={`/admin/billing/${row.user_id}`} className="text-sky-400 hover:underline text-xs">
                            Detalj →
                          </Link>
                        </td>
                      </tr>
                      {open ? (
                        <tr className="border-t border-slate-800/40 bg-slate-950/80">
                          <td colSpan={6} className="px-3 py-3">
                            <div className="text-xs font-semibold text-slate-400 mb-2">Senaste 20 transaktioner (ledger)</div>
                            {preview.length === 0 ? (
                              <div className="text-slate-500 text-xs">Ingen historik (eller användaren utanför förhandsladdning — öppna detalj).</div>
                            ) : (
                              <ul className="space-y-1 text-xs font-mono text-slate-300">
                                {preview.map((e) => (
                                  <li key={e.id}>
                                    {formatTime(e.created_at)} · {e.type} · {e.amount} · {e.description ?? '—'}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
