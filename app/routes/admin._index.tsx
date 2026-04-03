import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Form, Link, useLoaderData } from '@remix-run/react';
import {
  ADMIN_SESSION_VALUE,
  buildAdminSessionCookie,
  clearAdminSessionCookie,
  getAdminSecret,
  isAdminPageAuthenticated,
} from '~/lib/server/admin-auth.server';
import { supabaseAdmin } from '~/lib/supabase/server';
import { AdminNav } from '~/components/admin/AdminNav';

type ErrorLogSummary = {
  id: string;
  created_at: string;
  level: string;
  message: string;
  route: string | null;
};

type WebhookEventSummary = {
  id: string;
  type: string;
  processed_at: string | null;
  status: string;
  error: string | null;
};

type LoaderData =
  | { authenticated: false; error: string | null }
  | {
      authenticated: true;
      error: null;
      totalUsers: number;
      activeSubscriptions: number;
      recentErrors: ErrorLogSummary[];
      recentWebhooks: WebhookEventSummary[];
    };

async function countUsers() {
  const response = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return response.data?.users?.length ?? 0;
}

export async function action({ context, request }: ActionFunctionArgs) {
  const adminSecret = getAdminSecret(context);
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'logout') {
    return redirect('/admin', {
      headers: { 'Set-Cookie': clearAdminSessionCookie() },
    });
  }

  const secret = typeof formData.get('secret') === 'string' ? String(formData.get('secret')) : '';

  if (!adminSecret || secret !== adminSecret) {
    return redirect('/admin?error=invalid_secret');
  }

  return redirect('/admin', {
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

  const [totalUsers, subscriptionsResult, recentErrorsResult, recentWebhooksResult] = await Promise.all([
    countUsers(),
    supabaseAdmin
      .from('subscriptions')
      .select('status')
      .returns<Array<{ status: string | null }>>(),
    supabaseAdmin
      .from('error_logs')
      .select('id, created_at, level, message, route')
      .order('created_at', { ascending: false })
      .limit(5)
      .returns<ErrorLogSummary[]>(),
    supabaseAdmin
      .from('stripe_webhook_events')
      .select('id, type, processed_at, status, error')
      .order('processed_at', { ascending: false })
      .limit(5)
      .returns<WebhookEventSummary[]>(),
  ]);

  if (subscriptionsResult.error) {
    throw new Error(`[RIDVAN-E1290] ${subscriptionsResult.error.message}`);
  }

  if (recentErrorsResult.error) {
    throw new Error(`[RIDVAN-E1291] ${recentErrorsResult.error.message}`);
  }

  if (recentWebhooksResult.error) {
    throw new Error(`[RIDVAN-E1292] ${recentWebhooksResult.error.message}`);
  }

  const activeSubscriptions = (subscriptionsResult.data ?? []).filter(
    (s) => (s.status ?? '').toLowerCase() === 'active',
  ).length;

  return Response.json({
    authenticated: true,
    error: null,
    totalUsers,
    activeSubscriptions,
    recentErrors: recentErrorsResult.data ?? [],
    recentWebhooks: recentWebhooksResult.data ?? [],
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

export default function AdminOverviewRoute() {
  const data = useLoaderData<typeof loader>() as LoaderData;

  if (!data.authenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <h1 className="text-2xl font-semibold">Admin — översikt</h1>
          <p className="mt-2 text-sm text-slate-400">Ange din admin-secret.</p>
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <AdminNav />
            <div>
              <h1 className="text-3xl font-semibold">Översikt</h1>
              <p className="mt-2 text-sm text-slate-400">Snabbkoll — använd länkarna för fullständiga listor.</p>
            </div>
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="logout" />
            <button type="submit" className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-900">
              Logga ut
            </button>
          </Form>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="text-sm text-slate-400">Antal användare</div>
            <div className="mt-2 text-3xl font-semibold">{data.totalUsers}</div>
            <Link to="/admin/billing" className="mt-3 inline-block text-sm text-sky-400 hover:underline">
              Öppna billing →
            </Link>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="text-sm text-slate-400">Aktiva subscriptions</div>
            <div className="mt-2 text-3xl font-semibold">{data.activeSubscriptions}</div>
            <Link to="/admin/billing" className="mt-3 inline-block text-sm text-sky-400 hover:underline">
              Öppna billing →
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold">Senaste fel (5)</h2>
            <Link to="/admin/errors" className="text-sm text-sky-400 hover:underline">
              Alla errors →
            </Link>
          </div>
          {data.recentErrors.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">Inga fel loggade.</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm">
              {data.recentErrors.map((row) => (
                <li key={row.id} className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2">
                  <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                    <span>{formatTime(row.created_at)}</span>
                    <span className="text-amber-200/90">{row.level}</span>
                    {row.route ? <span className="font-mono">{row.route}</span> : null}
                  </div>
                  <div className="mt-1 text-slate-200 line-clamp-2">{row.message}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold">Senaste webhook-events (5)</h2>
            <Link to="/admin/webhooks" className="text-sm text-sky-400 hover:underline">
              Alla webhooks →
            </Link>
          </div>
          {data.recentWebhooks.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">Inga events.</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm">
              {data.recentWebhooks.map((row) => (
                <li key={row.id} className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono text-slate-300">{row.id.slice(0, 24)}…</span>
                    <span className="text-slate-400">{row.type}</span>
                    <span
                      className={
                        row.status === 'failed' ? 'text-rose-300' : row.status === 'processed' ? 'text-emerald-300' : 'text-slate-400'
                      }
                    >
                      {row.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{formatTime(row.processed_at)}</div>
                  {row.error ? <div className="mt-1 text-xs text-rose-200/90 line-clamp-1">{row.error}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
