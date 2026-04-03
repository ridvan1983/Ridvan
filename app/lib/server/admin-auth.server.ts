import { getOptionalServerEnv } from '~/lib/env.server';

export const ADMIN_COOKIE = 'ridvan_admin_auth';
export const ADMIN_SESSION_VALUE = 'true';

type AdminContext = { cloudflare?: { env?: unknown } } | undefined;

export function getAdminSecret(context: AdminContext) {
  return getOptionalServerEnv('ADMIN_SECRET', context?.cloudflare?.env);
}

export function parseAdminCookies(request: Request): Record<string, string> {
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

/** Cookie session for admin HTML routes (/admin, /admin/errors, …). */
export function isAdminPageAuthenticated(request: Request, adminSecret: string | undefined): boolean {
  if (!adminSecret) {
    return false;
  }

  return parseAdminCookies(request)[ADMIN_COOKIE] === ADMIN_SESSION_VALUE;
}

export function buildAdminSessionCookie(value: string, maxAge: number) {
  return `${ADMIN_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearAdminSessionCookie() {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** API routes: Bearer ADMIN_SECRET or valid admin session cookie. */
export function requireAdminApi(request: Request, adminSecret: string | undefined): void {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const cookies = parseAdminCookies(request);
  const hasAdminSession = cookies[ADMIN_COOKIE] === ADMIN_SESSION_VALUE;

  if (!adminSecret || ((!token || token !== adminSecret) && !hasAdminSession)) {
    throw Response.json({ error: '[RIDVAN-E1222] Unauthorized' }, { status: 401 });
  }
}
