import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Link, useLoaderData, useSearchParams } from '@remix-run/react';
import { useMemo, useState } from 'react';
import { AdminNav } from '~/components/admin/AdminNav';
import { readDashboardCache } from '~/lib/brain/project-dashboard-intelligence.server';
import {
  ADMIN_SESSION_VALUE,
  buildAdminSessionCookie,
  clearAdminSessionCookie,
  getAdminSecret,
  isAdminPageAuthenticated,
} from '~/lib/server/admin-auth.server';
import { supabaseAdmin } from '~/lib/supabase/server';
type Row = {
  projectId: string;
  userId: string;
  title: string | null;
  healthScore: number | null;
  updatedAt: string;
  lowScore: boolean;
};

export async function loader({ context, request }: LoaderFunctionArgs) {
  const adminSecret = getAdminSecret(context);

  if (!isAdminPageAuthenticated(request, adminSecret)) {
    return json({ authenticated: false as const, rows: [] as Row[] });
  }

  const { data: states, error: stateError } = await supabaseAdmin
    .from('brain_project_state')
    .select('project_id, user_id, current_signals, updated_at')
    .order('updated_at', { ascending: false })
    .limit(500)
    .returns<Array<{ project_id: string; user_id: string; current_signals: unknown; updated_at: string }>>();

  if (stateError) {
    throw new Error(`[RIDVAN-E2120] ${stateError.message}`);
  }

  const projectIds = [...new Set((states ?? []).map((s) => s.project_id))];
  const titles = new Map<string, string | null>();

  if (projectIds.length > 0) {
    const { data: projects, error: projError } = await supabaseAdmin
      .from('projects')
      .select('id, title')
      .in('id', projectIds)
      .returns<Array<{ id: string; title: string | null }>>();

    if (!projError && projects) {
      for (const p of projects) {
        titles.set(p.id, p.title);
      }
    }
  }

  const rows: Row[] = (states ?? []).map((s) => {
    const signals =
      s.current_signals && typeof s.current_signals === 'object' && !Array.isArray(s.current_signals)
        ? (s.current_signals as Record<string, unknown>)
        : {};
    const cached = readDashboardCache(signals);
    const score = cached?.dashboard?.healthScore ?? null;
    return {
      projectId: s.project_id,
      userId: s.user_id,
      title: titles.get(s.project_id) ?? null,
      healthScore: score != null ? Math.round(score) : null,
      updatedAt: s.updated_at,
      lowScore: score != null && score < 40,
    };
  });

  return json({ authenticated: true as const, rows });
}

export async function action({ context, request }: ActionFunctionArgs) {
  const adminSecret = getAdminSecret(context);
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'logout') {
    return redirect('/admin/intelligence', {
      headers: { 'Set-Cookie': clearAdminSessionCookie() },
    });
  }

  const secret = typeof formData.get('secret') === 'string' ? String(formData.get('secret')) : '';

  if (!adminSecret || secret !== adminSecret) {
    return redirect('/admin/intelligence?error=invalid_secret');
  }

  return redirect('/admin/intelligence', {
    headers: { 'Set-Cookie': buildAdminSessionCookie(ADMIN_SESSION_VALUE, 60 * 60 * 8) },
  });
}

export default function AdminIntelligenceRoute() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error') === 'invalid_secret' ? 'Invalid admin secret.' : null;
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = useMemo(() => {
    if (data.authenticated === false) {
      return [];
    }
    const copy = [...data.rows];
    copy.sort((a, b) => {
      const av = a.healthScore ?? -1;
      const bv = b.healthScore ?? -1;
      return sortDesc ? bv - av : av - bv;
    });
    return copy;
  }, [data, sortDesc]);

  if (!data.authenticated) {
    return (
      <div className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
        <div className="mx-auto max-w-md">
          <h1 className="text-xl font-semibold">Admin — Project Intelligence</h1>
          {error ? <p className="mt-2 text-sm text-rose-400">{error}</p> : null}
          <form method="post" className="mt-6 space-y-3">
            <label className="block text-sm text-slate-400" htmlFor="secret">
              Admin secret
            </label>
            <input
              id="secret"
              name="secret"
              type="password"
              autoComplete="off"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white">
              Log in
            </button>
          </form>
          <p className="mt-6 text-xs text-slate-500">
            <Link to="/admin" className="text-sky-400 hover:underline">
              Till admin-översikt
            </Link>
          </p>
        </div>
      </div>
    );
  }

  const lowCount = data.rows.filter((r) => r.lowScore).length;

  return (
    <div className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Project Intelligence</h1>
            <p className="mt-1 text-sm text-slate-400">
              Hälsa från cachad dashboard ({lowCount} under 40)
            </p>
          </div>
          <AdminNav />
        </div>

        <form method="post" className="mt-4">
          <input type="hidden" name="intent" value="logout" />
          <button type="submit" className="text-sm text-sky-400 hover:underline">
            Logga ut admin
          </button>
        </form>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSortDesc((v) => !v)}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-900"
          >
            Sortera: {sortDesc ? 'högst först' : 'lägst först'}
          </button>
        </div>

        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-900/80 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3">Projekt</th>
                <th className="px-4 py-3">user_id</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Uppdaterad</th>
                <th className="px-4 py-3">Flagga</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={`${r.projectId}-${r.userId}`} className="border-b border-slate-800/80">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-100">{r.title ?? r.projectId.slice(0, 8)}</div>
                    <div className="text-xs text-slate-500 font-mono">{r.projectId}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{r.userId}</td>
                  <td className="px-4 py-3">
                    {r.healthScore != null ? (
                      <span
                        className={
                          r.healthScore >= 80
                            ? 'text-emerald-400'
                            : r.healthScore >= 50
                              ? 'text-amber-400'
                              : 'text-red-400'
                        }
                      >
                        {r.healthScore}
                      </span>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{new Date(r.updatedAt).toLocaleString('sv-SE')}</td>
                  <td className="px-4 py-3">
                    {r.lowScore ? (
                      <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-semibold text-red-300">
                        Låg (&lt;40)
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sorted.length === 0 ? <p className="mt-6 text-slate-500">Inga brain_project_state-rader ännu.</p> : null}
      </div>
    </div>
  );
}
