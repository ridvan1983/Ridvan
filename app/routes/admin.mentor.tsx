import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Form, Link, useLoaderData } from '@remix-run/react';
import { AdminNav } from '~/components/admin/AdminNav';
import { computeAdminMentorStats, type AdminMentorStats } from '~/lib/mentor/admin-stats.server';
import {
  ADMIN_SESSION_VALUE,
  buildAdminSessionCookie,
  clearAdminSessionCookie,
  getAdminSecret,
  isAdminPageAuthenticated,
} from '~/lib/server/admin-auth.server';

type LoaderData =
  | { authenticated: false; error: string | null }
  | { authenticated: true; error: null; stats: AdminMentorStats };

export async function action({ context, request }: ActionFunctionArgs) {
  const adminSecret = getAdminSecret(context);
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'logout') {
    return redirect('/admin/mentor', {
      headers: { 'Set-Cookie': clearAdminSessionCookie() },
    });
  }

  const secret = typeof formData.get('secret') === 'string' ? String(formData.get('secret')) : '';

  if (!adminSecret || secret !== adminSecret) {
    return redirect('/admin/mentor?error=invalid_secret');
  }

  return redirect('/admin/mentor', {
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

  const stats = await computeAdminMentorStats();
  return Response.json({ authenticated: true, error: null, stats } satisfies LoaderData);
}

export default function AdminMentorPage() {
  const data = useLoaderData<typeof loader>() as LoaderData;

  if (!data.authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <h1 className="text-2xl font-semibold">Mentor admin</h1>
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

  const { stats } = data;

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <AdminNav />
            <h1 className="text-3xl font-semibold">Mentor — statistik</h1>
            <p className="mt-2 text-base text-slate-300">Aggregerat från mentor_messages (sample för ämnesord).</p>
            <Link to="/admin" className="mt-3 inline-block text-sm text-sky-400 hover:underline">
              ← Översikt
            </Link>
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="logout" />
            <button type="submit" className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-900">
              Logga ut
            </button>
          </Form>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="text-sm text-slate-400">Mentor-meddelanden totalt</div>
            <div className="mt-1 text-3xl font-semibold text-white">{stats.totalMentorMessages}</div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="text-sm text-slate-400">Unika mentor-sessioner (sample)</div>
            <div className="mt-1 text-3xl font-semibold text-white">{stats.distinctSessions}</div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:col-span-2">
            <div className="text-sm text-slate-400">Genomsnitt meddelanden per session (sample)</div>
            <div className="mt-1 text-3xl font-semibold text-white">
              {stats.avgMessagesPerSession != null ? stats.avgMessagesPerSession.toFixed(1) : '—'}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-lg font-semibold text-white">Mest aktiva användare (efter antal mentor-rader i sample)</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            {stats.topUsers.map((row) => (
              <li key={row.user_id} className="flex justify-between gap-4 border-b border-slate-800/80 py-2">
                <span className="font-mono text-xs text-slate-400">{row.user_id}</span>
                <span>{row.message_count}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-lg font-semibold text-white">Vanligaste ämnesord (användarmeddelanden, sample)</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {stats.topicHints.map((h) => (
              <li key={h.term} className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs text-slate-200">
                {h.term} <span className="text-slate-500">({h.count})</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
