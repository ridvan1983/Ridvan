import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Form, Link, useLoaderData } from '@remix-run/react';
import { useState } from 'react';
import { getOptionalServerEnv } from '~/lib/env.server';
import { supabaseAdmin } from '~/lib/supabase/server';

const ADMIN_COOKIE = 'ridvan_admin_auth';
const ADMIN_SESSION_VALUE = 'true';

type ErrorLogRow = {
  id: string;
  created_at: string;
  level: string;
  message: string;
  stack: string | null;
  route: string | null;
  user_id: string | null;
  metadata: unknown;
  resolved: boolean;
};

type LoaderData =
  | { authenticated: false; error: string | null }
  | { authenticated: true; error: null; logs: ErrorLogRow[]; filter: 'open' | 'all' };

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

export async function action({ context, request }: ActionFunctionArgs) {
  const adminSecret = getAdminSecret(context);
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'logout') {
    return redirect('/admin/errors', {
      headers: { 'Set-Cookie': clearCookie() },
    });
  }

  if (intent === 'resolve') {
    if (!isAuthenticated(request, adminSecret)) {
      return redirect('/admin/errors?error=invalid_secret');
    }

    const logId = formData.get('logId');
    if (typeof logId === 'string' && logId.length > 0) {
      await supabaseAdmin.from('error_logs').update({ resolved: true }).eq('id', logId);
    }

    const nextUrl = new URL(request.url);
    return redirect(`${nextUrl.pathname}${nextUrl.search}`);
  }

  const secret = typeof formData.get('secret') === 'string' ? String(formData.get('secret')) : '';

  if (!adminSecret || secret !== adminSecret) {
    return redirect('/admin/errors?error=invalid_secret');
  }

  return redirect('/admin/errors', {
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

  const filter: 'open' | 'all' = url.searchParams.get('filter') === 'all' ? 'all' : 'open';

  let query = supabaseAdmin.from('error_logs').select('*').order('created_at', { ascending: false }).limit(100);

  if (filter === 'open') {
    query = query.eq('resolved', false);
  }

  const { data, error: dbError } = await query.returns<ErrorLogRow[]>();

  if (dbError) {
    throw new Error(`[RIDVAN-E1250] Failed to load error_logs: ${dbError.message}`);
  }

  return Response.json({
    authenticated: true,
    error: null,
    logs: data ?? [],
    filter,
  } satisfies LoaderData);
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('sv-SE');
  } catch {
    return iso;
  }
}

export default function AdminErrorsRoute() {
  const data = useLoaderData<typeof loader>() as LoaderData;
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!data.authenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <h1 className="text-2xl font-semibold">Error logs</h1>
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
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <nav className="flex flex-wrap gap-4 text-sm text-sky-400">
              <Link to="/admin" className="hover:underline">
                Billing admin
              </Link>
              <span className="text-slate-500">|</span>
              <span className="text-slate-200">Errors</span>
            </nav>
            <h1 className="mt-2 text-3xl font-semibold">Error logs</h1>
            <p className="mt-2 text-sm text-slate-400">Senaste 100 raderna från Supabase (nyast först).</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-xl border border-slate-700 p-0.5 text-sm">
              <Link
                to="/admin/errors"
                className={`rounded-lg px-3 py-1.5 ${data.filter === 'open' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                Olösta
              </Link>
              <Link
                to="/admin/errors?filter=all"
                className={`rounded-lg px-3 py-1.5 ${data.filter === 'all' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                Alla
              </Link>
            </div>
            <Form method="post">
              <input type="hidden" name="intent" value="logout" />
              <button type="submit" className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-900">
                Logga ut
              </button>
            </Form>
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-slate-400">
              <tr>
                <th className="px-3 py-2">Tid</th>
                <th className="px-3 py-2">Level</th>
                <th className="px-3 py-2">Route</th>
                <th className="px-3 py-2">Message</th>
                <th className="px-3 py-2">user_id</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.logs.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-slate-500" colSpan={6}>
                    Inga fel att visa.
                  </td>
                </tr>
              ) : (
                data.logs.map((row) => {
                  const isOpen = expandedId === row.id;
                  const messagePreview = row.message.length > 120 ? `${row.message.slice(0, 120)}…` : row.message;

                  return (
                    <tr key={row.id} className="border-t border-slate-800/80 align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-slate-400">{formatTime(row.created_at)}</td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            row.level === 'warning' ? 'text-amber-300' : 'text-rose-300'
                          }
                        >
                          {row.level}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-300">{row.route ?? '—'}</td>
                      <td className="px-3 py-2 max-w-md">
                        <button
                          type="button"
                          className="text-left text-slate-200 hover:text-sky-300 w-full"
                          onClick={() => setExpandedId(isOpen ? null : row.id)}
                        >
                          {isOpen ? row.message : messagePreview}
                        </button>
                        {isOpen ? (
                          <div className="mt-3 space-y-3 text-xs">
                            {row.stack ? (
                              <div>
                                <div className="font-semibold text-slate-400 mb-1">Stack</div>
                                <pre className="max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-slate-300 whitespace-pre-wrap break-words">
                                  {row.stack}
                                </pre>
                              </div>
                            ) : null}
                            <div>
                              <div className="font-semibold text-slate-400 mb-1">Metadata</div>
                              <pre className="max-h-48 overflow-auto rounded-lg bg-slate-950 p-3 text-slate-300 whitespace-pre-wrap break-words">
                                {row.metadata == null ? '—' : JSON.stringify(row.metadata, null, 2)}
                              </pre>
                            </div>
                            {!row.resolved ? (
                              <Form method="post" className="pt-1">
                                <input type="hidden" name="intent" value="resolve" />
                                <input type="hidden" name="logId" value={row.id} />
                                <button
                                  type="submit"
                                  className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 text-emerald-200 hover:bg-emerald-500/20"
                                >
                                  Markera som löst
                                </button>
                              </Form>
                            ) : (
                              <div className="text-slate-500">Löst</div>
                            )}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-400">{row.user_id ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-400">{row.resolved ? 'Löst' : 'Öppen'}</td>
                    </tr>
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
