import { type ActionFunctionArgs, type LoaderFunctionArgs, redirect } from '@remix-run/cloudflare';
import {
  buildSupabaseOauthUrl,
  exchangeSupabaseOauthCode,
  getSupabaseUserToken,
  requireSupabaseOauthEnv,
  resolveSupabaseIntegrationUserId,
  saveSupabaseUserTokens,
  signSupabaseOauthState,
  verifySupabaseOauthState,
} from '~/lib/supabase/management.server';
import { supabaseAdmin } from '~/lib/supabase/server';

function requireBearerToken(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    throw Response.json({ error: '[RIDVAN-E2110] Unauthorized: missing Bearer token' }, { status: 401 });
  }

  return token;
}

function getOrigin(request: Request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export function getSupabaseConnectCallbackUrl(request: Request) {
  return `${getOrigin(request)}/api/supabase/connect/callback`;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const token = requireBearerToken(request);
  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return Response.json({ error: `[RIDVAN-E2113] Unauthorized: ${userError?.message ?? 'invalid token'}` }, { status: 401 });
  }

  const projectId = new URL(request.url).searchParams.get('projectId')?.trim() || null;
  const resolvedUserId = await resolveSupabaseIntegrationUserId(user.id, projectId);
  const tokenRow = await getSupabaseUserToken(resolvedUserId);

  return Response.json({
    connected: Boolean(tokenRow?.access_token),
    authUserId: user.id,
    resolvedUserId,
  });
}

export async function action({ context, request }: ActionFunctionArgs) {
  if (request.method !== 'POST' && request.method !== 'DELETE') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const token = requireBearerToken(request);
  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return Response.json({ error: `[RIDVAN-E2113] Unauthorized: ${userError?.message ?? 'invalid token'}` }, { status: 401 });
  }

  if (request.method === 'DELETE') {
    const body = (await request.json().catch(() => null)) as { projectId?: string } | null;
    const resolvedUserId = await resolveSupabaseIntegrationUserId(user.id, body?.projectId?.trim() || null);
    const { error } = await supabaseAdmin.from('user_supabase_tokens').delete().eq('user_id', resolvedUserId);

    if (error) {
      return Response.json({ error: `[RIDVAN-E2114] Failed to disconnect Supabase: ${error.message}` }, { status: 500 });
    }

    return Response.json({ ok: true });
  }

  const cloudflareEnv = context.cloudflare?.env as { SUPABASE_CLIENT_ID?: string; SUPABASE_CLIENT_SECRET?: string } | undefined;
  const { clientId, clientSecret } = requireSupabaseOauthEnv(cloudflareEnv);
  const body = (await request.json().catch(() => null)) as { projectId?: string; returnTo?: string } | null;
  const resolvedUserId = await resolveSupabaseIntegrationUserId(user.id, body?.projectId?.trim() || null);
  const state = await signSupabaseOauthState(
    {
      userId: resolvedUserId,
      projectId: body?.projectId?.trim() || null,
      returnTo: body?.returnTo?.trim() || `${getOrigin(request)}/chat`,
    },
    clientSecret,
  );

  return Response.json({
    ok: true,
    url: buildSupabaseOauthUrl({
      clientId,
      redirectUri: getSupabaseConnectCallbackUrl(request),
      state,
    }),
  });
}
