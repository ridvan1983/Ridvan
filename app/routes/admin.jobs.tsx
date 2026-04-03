import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Form, Link, useLoaderData } from '@remix-run/react';
import { AdminNav } from '~/components/admin/AdminNav';
import {
  ADMIN_SESSION_VALUE,
  buildAdminSessionCookie,
  clearAdminSessionCookie,
  getAdminSecret,
  isAdminPageAuthenticated,
} from '~/lib/server/admin-auth.server';

type LoaderData = { authenticated: false; error: string | null } | { authenticated: true; error: null };

export async function action({ context, request }: ActionFunctionArgs) {
  const adminSecret = getAdminSecret(context);
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'logout') {
    return redirect('/admin/jobs', {
      headers: { 'Set-Cookie': clearAdminSessionCookie() },
    });
  }

  const secret = typeof formData.get('secret') === 'string' ? String(formData.get('secret')) : '';

  if (!adminSecret || secret !== adminSecret) {
    return redirect('/admin/jobs?error=invalid_secret');
  }

  return redirect('/admin/jobs', {
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

  return Response.json({ authenticated: true, error: null } satisfies LoaderData);
}

export default function AdminJobsPlaceholder() {
  const data = useLoaderData<typeof loader>() as LoaderData;

  if (!data.authenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <h1 className="text-2xl font-semibold">Jobs</h1>
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
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <AdminNav />
            <h1 className="text-3xl font-semibold">Jobs</h1>
            <p className="text-slate-300 text-base mt-2">Jobs kommer snart.</p>
            <Link to="/admin" className="mt-3 inline-block text-sky-400 text-sm hover:underline">
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
      </div>
    </div>
  );
}
