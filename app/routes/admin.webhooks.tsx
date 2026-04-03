import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Form, Link, useFetcher, useLoaderData } from '@remix-run/react';
import { AdminNav } from '~/components/admin/AdminNav';
import {
  ADMIN_SESSION_VALUE,
  buildAdminSessionCookie,
  clearAdminSessionCookie,
  getAdminSecret,
  isAdminPageAuthenticated,
} from '~/lib/server/admin-auth.server';
import { supabaseAdmin } from '~/lib/supabase/server';

type WebhookEventRow = {
  id: string;
  type: string;
  processed_at: string | null;
  status: string;
  error: string | null;
};

type LoaderData =
  | { authenticated: false; error: string | null }
  | { authenticated: true; error: null; events: WebhookEventRow[] };

export async function action({ context, request }: ActionFunctionArgs) {
  const adminSecret = getAdminSecret(context);
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'logout') {
    return redirect('/admin/webhooks', {
      headers: { 'Set-Cookie': clearAdminSessionCookie() },
    });
  }

  const secret = typeof formData.get('secret') === 'string' ? String(formData.get('secret')) : '';

  if (!adminSecret || secret !== adminSecret) {
    return redirect('/admin/webhooks?error=invalid_secret');
  }

  return redirect('/admin/webhooks', {
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

  const { data: events, error: dbError } = await supabaseAdmin
    .from('stripe_webhook_events')
    .select('id, type, processed_at, status, error')
    .order('processed_at', { ascending: false })
    .limit(50)
    .returns<WebhookEventRow[]>();

  if (dbError) {
    throw new Error(`[RIDVAN-E1295] ${dbError.message}`);
  }

  return Response.json({
    authenticated: true,
    error: null,
    events: events ?? [],
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

export default function AdminWebhooksRoute() {
  const data = useLoaderData<typeof loader>() as LoaderData;
  const replayFetcher = useFetcher<{ ok?: boolean; error?: string; eventId?: string }>();

  if (!data.authenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <h1 className="text-2xl font-semibold">Webhooks</h1>
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <AdminNav />
            <div>
              <Link to="/admin" className="text-sm text-sky-400 hover:underline">
                ← Översikt
              </Link>
              <h1 className="mt-2 text-3xl font-semibold">Webhook events</h1>
              <p className="mt-2 text-sm text-slate-400">Senaste 50 rader från stripe_webhook_events.</p>
            </div>
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="logout" />
            <button type="submit" className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-900">
              Logga ut
            </button>
          </Form>
        </div>

        {replayFetcher.data?.error ? <div className="text-sm text-rose-300">{replayFetcher.data.error}</div> : null}
        {replayFetcher.data?.ok ? (
          <div className="text-sm text-emerald-300">Webhook {replayFetcher.data.eventId} kördes om.</div>
        ) : null}

        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-slate-400">
              <tr>
                <th className="px-3 py-2">Event ID</th>
                <th className="px-3 py-2">Typ</th>
                <th className="px-3 py-2">Processed at</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Error</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.events.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-slate-500" colSpan={6}>
                    Inga events.
                  </td>
                </tr>
              ) : (
                data.events.map((row) => (
                  <tr key={row.id} className="border-t border-slate-800/80 align-top">
                    <td className="px-3 py-3 font-mono text-xs text-slate-300 max-w-[200px] break-all">{row.id}</td>
                    <td className="px-3 py-3">{row.type}</td>
                    <td className="px-3 py-3 text-slate-400 whitespace-nowrap">{formatTime(row.processed_at)}</td>
                    <td className="px-3 py-3">
                      <span
                        className={
                          row.status === 'failed' ? 'text-rose-300' : row.status === 'processed' ? 'text-emerald-300' : 'text-slate-300'
                        }
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-rose-200 max-w-md break-words">{row.error ?? '—'}</td>
                    <td className="px-3 py-3 text-right">
                      {row.status === 'failed' ? (
                        <replayFetcher.Form method="post" action="/api/admin/webhooks/replay">
                          <input type="hidden" name="eventId" value={row.id} />
                          <button
                            type="submit"
                            className="rounded-lg border border-sky-500/40 px-3 py-1.5 text-xs text-sky-300 hover:bg-sky-500/10"
                          >
                            Kör om
                          </button>
                        </replayFetcher.Form>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
