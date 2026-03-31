import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { Navigate, useSearchParams } from '@remix-run/react';
import { LoginPage } from '~/components/auth/LoginPage';
import { useAuth } from '~/lib/auth/AuthContext';
import { authRateLimit, checkRateLimit } from '~/lib/security/distributed-rate-limit.server';

function getRequestIp(request: Request) {
  const cfIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cfIp) {
    return cfIp;
  }

  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwardedFor) {
    return forwardedFor;
  }

  return 'unknown';
}

export async function action({ context, request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const body = (await request.json().catch(() => null)) as { email?: string; mode?: string } | null;
  const email = body?.email?.trim().toLowerCase() ?? 'unknown';
  const mode = body?.mode === 'signup' ? 'signup' : 'login';
  const ip = getRequestIp(request);
  const identifier = `${mode}:${ip}:${email}`;
  const { success, reset } = await checkRateLimit(authRateLimit, identifier, context.cloudflare.env);

  if (!success) {
    return Response.json(
      { error: 'Too many requests. Please wait before trying again.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((reset - Date.now()) / 1000)) },
      },
    );
  }

  return Response.json({ ok: true });
}

export default function LoginRoute() {
  const { user, loading } = useAuth();
  const [searchParams] = useSearchParams();
  const rawRedirect = searchParams.get('redirectTo');
  const redirectTo = rawRedirect?.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/chat';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-bolt-elements-textSecondary">
        Loading authentication...
      </div>
    );
  }

  if (user) {
    return <Navigate to={redirectTo} replace />;
  }

  return <LoginPage />;
}
