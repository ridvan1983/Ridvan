import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Form, useFetcher, useLoaderData, useSearchParams } from '@remix-run/react';
import { useMemo, useState } from 'react';
import { getOptionalServerEnv } from '~/lib/env.server';
import { getUserCreditHistory, type CreditLedgerEntry } from '~/lib/credits/ledger.server';
import { supabaseAdmin } from '~/lib/supabase/server';

type SubscriptionRow = {
  user_id: string;
  plan: string | null;
  status: string | null;
  monthly_credits: number | null;
  daily_credits: number | null;
  stripe_subscription_id: string | null;
};

type ProjectRow = {
  id: string;
  user_id: string;
  title: string | null;
  preview_url: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type AdminUser = {
  id: string;
  email: string | null;
  createdAt: string | null;
  plan: string;
  status: string;
  monthlyCredits: number;
  dailyCredits: number;
  stripeSubscriptionId: string | null;
};

type SelectedUserDetails = {
  user: { id: string; email: string | null; created_at: string | null } | null;
  subscription: SubscriptionRow | null;
  projects: ProjectRow[];
  credits: CreditLedgerEntry[];
};

type FailedWebhookEvent = {
  id: string;
  type: string;
  processed_at: string | null;
  error: string | null;
};

type LoaderData =
  | {
      authenticated: false;
      error: string | null;
    }
  | {
      authenticated: true;
      error: null;
      overview: {
        totalUsers: number;
        activeSubscriptions: number;
        totalCreditsGranted: number;
      };
      failedWebhookEvents: FailedWebhookEvent[];
      users: AdminUser[];
      selectedUserId: string | null;
      selectedUserDetails: SelectedUserDetails | null;
    };

const ADMIN_COOKIE = 'ridvan_admin_auth';
const ADMIN_SESSION_VALUE = 'true';

function getAdminSecret(context: LoaderFunctionArgs['context'] | ActionFunctionArgs['context']) {
  return getOptionalServerEnv('ADMIN_SECRET', context.cloudflare?.env);
}

function parseCookies(request: Request) {
  return Object.fromEntries(
    request.headers
      .get('cookie')
      ?.split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }) ?? [],
  );
}

function isAuthenticated(request: Request, adminSecret: string | undefined) {
  if (!adminSecret) {
    return false;
  }

  const cookies = parseCookies(request);
  return cookies[ADMIN_COOKIE] === ADMIN_SESSION_VALUE;
}

function buildCookie(value: string, maxAge: number) {
  return `${ADMIN_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie() {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

async function listAdminUsers() {
  const response = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return (response.data?.users ?? []).map((user) => ({
    id: user.id,
    email: user.email ?? null,
    created_at: user.created_at ?? null,
  }));
}

async function listSubscriptions() {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id, plan, status, monthly_credits, daily_credits, stripe_subscription_id')
    .returns<SubscriptionRow[]>();

  if (error) {
    throw new Error(`[RIDVAN-E1230] Failed to load subscriptions: ${error.message}`);
  }

  return data ?? [];
}

async function listProjectsForUser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, user_id, title, preview_url, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .returns<ProjectRow[]>();

  if (error) {
    throw new Error(`[RIDVAN-E1231] Failed to load user projects: ${error.message}`);
  }

  return data ?? [];
}

export async function action({ context, request }: ActionFunctionArgs) {
  const adminSecret = getAdminSecret(context);
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'logout') {
    return redirect('/admin', {
      headers: { 'Set-Cookie': clearCookie() },
    });
  }

  const secret = typeof formData.get('secret') === 'string' ? String(formData.get('secret')) : '';

  if (!adminSecret || secret !== adminSecret) {
    return redirect('/admin?error=invalid_secret');
  }

  return redirect('/admin', {
    headers: { 'Set-Cookie': buildCookie(ADMIN_SESSION_VALUE, 60 * 60 * 8) },
  });
}

export async function loader({ context, request }: LoaderFunctionArgs): Promise<Response> {
  const adminSecret = getAdminSecret(context);
  const url = new URL(request.url);
  const error = url.searchParams.get('error') === 'invalid_secret' ? 'Invalid admin secret.' : null;

  if (!isAuthenticated(request, adminSecret)) {
    return Response.json({ authenticated: false, error } satisfies LoaderData);
  }

  const selectedUserId = url.searchParams.get('userId');
  const [usersRaw, subscriptions, totalGrantedRows, failedWebhookRows] = await Promise.all([
    listAdminUsers(),
    listSubscriptions(),
    supabaseAdmin.from('credit_ledger').select('amount').returns<Array<{ amount: number }>>(),
    supabaseAdmin
      .from('stripe_webhook_events')
      .select('id, type, processed_at, error')
      .eq('status', 'failed')
      .order('processed_at', { ascending: false })
      .returns<FailedWebhookEvent[]>(),
  ]);

  if (totalGrantedRows.error) {
    throw new Error(`[RIDVAN-E1232] Failed to load credit ledger totals: ${totalGrantedRows.error.message}`);
  }

  if (failedWebhookRows.error) {
    throw new Error(`[RIDVAN-E1238] Failed to load failed webhook events: ${failedWebhookRows.error.message}`);
  }

  const subscriptionMap = new Map(subscriptions.map((subscription) => [subscription.user_id, subscription]));
  const users: AdminUser[] = usersRaw.map((user) => {
    const subscription = subscriptionMap.get(user.id);
    return {
      id: user.id,
      email: user.email,
      createdAt: user.created_at,
      plan: subscription?.plan ?? 'free',
      status: subscription?.status ?? 'inactive',
      monthlyCredits: subscription?.monthly_credits ?? 0,
      dailyCredits: subscription?.daily_credits ?? 0,
      stripeSubscriptionId: subscription?.stripe_subscription_id ?? null,
    };
  });

  let selectedUserDetails: SelectedUserDetails | null = null;

  if (selectedUserId) {
    const [projects, credits] = await Promise.all([listProjectsForUser(selectedUserId), getUserCreditHistory(selectedUserId, 100)]);
    const selectedUserRaw = usersRaw.find((user) => user.id === selectedUserId) ?? null;
    const selectedSubscription = subscriptions.find((subscription) => subscription.user_id === selectedUserId) ?? null;

    selectedUserDetails = {
      user: selectedUserRaw,
      subscription: selectedSubscription,
      projects,
      credits,
    };
  }

  const totalCreditsGranted = (totalGrantedRows.data ?? [])
    .map((row) => row.amount)
    .filter((amount) => amount > 0)
    .reduce((sum, amount) => sum + amount, 0);

  return Response.json({
    authenticated: true,
    error: null,
    overview: {
      totalUsers: users.length,
      activeSubscriptions: subscriptions.filter((subscription) => (subscription.status ?? '').toLowerCase() === 'active').length,
      totalCreditsGranted,
    },
    failedWebhookEvents: failedWebhookRows.data ?? [],
    users,
    selectedUserId,
    selectedUserDetails,
  } satisfies LoaderData);
}

export default function AdminRoute() {
  const data = useLoaderData<typeof loader>() as LoaderData;
  const replayFetcher = useFetcher<{ ok?: boolean; error?: string; eventId?: string; status?: string }>();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState('');

  const filteredUsers = useMemo(() => {
    if (!('authenticated' in data) || !data.authenticated) {
      return [] as AdminUser[];
    }

    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return data.users;
    }

    return data.users.filter((user) => {
      const haystack = [user.email ?? '', user.id, user.plan, user.status].join(' ').toLowerCase();
      return haystack.includes(normalized);
    });
  }, [data, query]);

  if (!data.authenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <h1 className="text-2xl font-semibold">Admin dashboard</h1>
          <p className="mt-2 text-sm text-slate-400">Ange din admin-secret för att öppna dashboarden.</p>
          <Form method="post" className="mt-6 space-y-4">
            <input type="hidden" name="intent" value="login" />
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

  const selected = data.selectedUserDetails;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Billing admin dashboard</h1>
            <p className="mt-2 text-sm text-slate-400">Översikt över användare, subscriptions och credit ledger.</p>
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="logout" />
            <button type="submit" className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-900">
              Logga ut
            </button>
          </Form>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="text-sm text-slate-400">Antal användare</div>
            <div className="mt-2 text-3xl font-semibold">{data.overview.totalUsers}</div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="text-sm text-slate-400">Aktiva subscriptions</div>
            <div className="mt-2 text-3xl font-semibold">{data.overview.activeSubscriptions}</div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="text-sm text-slate-400">Total credits utdelade</div>
            <div className="mt-2 text-3xl font-semibold">{data.overview.totalCreditsGranted}</div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Misslyckade webhooks</h2>
              <p className="mt-1 text-sm text-slate-400">Stripe-events som ligger markerade som failed och kan köras om manuellt.</p>
            </div>
            {replayFetcher.data?.error ? <div className="text-sm text-rose-300">{replayFetcher.data.error}</div> : null}
            {replayFetcher.data?.ok ? <div className="text-sm text-emerald-300">Webhook {replayFetcher.data.eventId} kördes om.</div> : null}
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-slate-400">
                <tr>
                  <th className="px-3 py-2">Event ID</th>
                  <th className="px-3 py-2">Typ</th>
                  <th className="px-3 py-2">Processed at</th>
                  <th className="px-3 py-2">Error</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.failedWebhookEvents.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-slate-500" colSpan={5}>
                      Inga misslyckade webhooks.
                    </td>
                  </tr>
                ) : (
                  data.failedWebhookEvents.map((event) => (
                    <tr key={event.id} className="border-t border-slate-800/80 align-top">
                      <td className="px-3 py-3 font-mono text-xs text-slate-300">{event.id}</td>
                      <td className="px-3 py-3">{event.type}</td>
                      <td className="px-3 py-3 text-slate-400">{event.processed_at ? new Date(event.processed_at).toLocaleString() : '—'}</td>
                      <td className="px-3 py-3 text-xs text-rose-200">{event.error ?? 'Unknown error'}</td>
                      <td className="px-3 py-3 text-right">
                        <replayFetcher.Form method="post" action="/api/admin/webhooks/replay">
                          <input type="hidden" name="eventId" value={event.id} />
                          <button
                            type="submit"
                            className="rounded-lg border border-sky-500/40 px-3 py-1.5 text-xs text-sky-300 hover:bg-sky-500/10"
                          >
                            Kör om
                          </button>
                        </replayFetcher.Form>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <h2 className="text-xl font-semibold">Användare</h2>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Sök email, plan eller user id"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm outline-none md:max-w-sm"
              />
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Plan</th>
                    <th className="px-3 py-2">Credits</th>
                    <th className="px-3 py-2">Skapad</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => {
                    const isSelected = user.id === data.selectedUserId;
                    return (
                      <tr key={user.id} className={isSelected ? 'bg-slate-800/80' : 'hover:bg-slate-800/40'}>
                        <td className="px-3 py-3">
                          <a href={`/admin?userId=${encodeURIComponent(user.id)}`} className="font-medium text-sky-300 hover:text-sky-200">
                            {user.email ?? user.id}
                          </a>
                          <div className="mt-1 text-xs text-slate-500">{user.id}</div>
                        </td>
                        <td className="px-3 py-3">{user.plan}</td>
                        <td className="px-3 py-3">
                          <div>{user.monthlyCredits} mån</div>
                          <div className="text-xs text-slate-500">{user.dailyCredits} dag</div>
                        </td>
                        <td className="px-3 py-3">{user.createdAt ? new Date(user.createdAt).toLocaleString() : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-xl font-semibold">Användardetaljer</h2>
            {!selected ? (
              <p className="mt-4 text-sm text-slate-400">Välj en användare i listan för att se projekt, credit-historik och Stripe subscription.</p>
            ) : (
              <div className="mt-4 space-y-5">
                <div>
                  <div className="text-sm text-slate-400">Email</div>
                  <div className="mt-1 font-medium">{selected.user?.email ?? selected.user?.id ?? 'Okänd användare'}</div>
                </div>
                <div>
                  <div className="text-sm text-slate-400">Stripe subscription</div>
                  <div className="mt-1 text-sm">
                    {selected.subscription?.stripe_subscription_id ?? 'Ingen aktiv Stripe subscription'}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Plan: {selected.subscription?.plan ?? 'free'} | Status: {selected.subscription?.status ?? 'inactive'}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-slate-400">Projekt</div>
                  <div className="mt-2 space-y-2">
                    {selected.projects.length === 0 ? (
                      <div className="text-sm text-slate-500">Inga projekt.</div>
                    ) : (
                      selected.projects.map((project) => (
                        <div key={project.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm">
                          <div className="font-medium">{project.title ?? 'Untitled project'}</div>
                          <div className="mt-1 text-xs text-slate-500">{project.id}</div>
                          <div className="mt-1 text-xs text-slate-400">{project.preview_url ?? 'Ingen preview-url'}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-slate-400">Credit-historik</div>
                    {searchParams.get('userId') ? (
                      <a
                        href={`/api/admin?view=credits&userId=${encodeURIComponent(searchParams.get('userId') ?? '')}`}
                        className="text-xs text-sky-300 hover:text-sky-200"
                      >
                        API view
                      </a>
                    ) : null}
                  </div>
                  <div className="mt-2 space-y-2">
                    {selected.credits.length === 0 ? (
                      <div className="text-sm text-slate-500">Ingen credit-historik.</div>
                    ) : (
                      selected.credits.map((entry) => (
                        <div key={entry.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-medium">{entry.type}</div>
                            <div className={entry.amount >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{entry.amount >= 0 ? `+${entry.amount}` : entry.amount}</div>
                          </div>
                          <div className="mt-1 text-xs text-slate-400">Balance after: {entry.balance_after}</div>
                          <div className="mt-1 text-xs text-slate-500">{entry.description ?? 'No description'}</div>
                          <div className="mt-1 text-xs text-slate-600">{new Date(entry.created_at).toLocaleString()}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
