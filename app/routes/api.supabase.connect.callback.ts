import { type LoaderFunctionArgs, redirect } from '@remix-run/cloudflare';
import { getCloudflareEnv } from '~/lib/env.server';
import {
  exchangeSupabaseOauthCode,
  requireSupabaseOauthEnv,
  saveSupabaseUserTokens,
  verifySupabaseOauthState,
} from '~/lib/supabase/management.server';
import { getSupabaseConnectCallbackUrl } from './api.supabase.connect';

function getOrigin(request: Request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const cloudflareEnv = getCloudflareEnv(context);
  const { clientId, clientSecret } = requireSupabaseOauthEnv(cloudflareEnv);
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return Response.json({ error: '[RIDVAN-E2111] Missing Supabase OAuth code or state' }, { status: 400 });
  }

  const verifiedState = await verifySupabaseOauthState(state, clientSecret);

  if (!verifiedState) {
    return Response.json({ error: '[RIDVAN-E2112] Invalid Supabase OAuth state' }, { status: 400 });
  }

  try {
    const tokens = await exchangeSupabaseOauthCode({
      clientId,
      clientSecret,
      code,
      redirectUri: getSupabaseConnectCallbackUrl(request),
    });

    await saveSupabaseUserTokens(verifiedState.userId, tokens);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : '[RIDVAN-E2115] Failed to exchange Supabase OAuth code',
        redirectUri: getSupabaseConnectCallbackUrl(request),
      },
      { status: 400 },
    );
  }

  const nextUrl = new URL(verifiedState.returnTo || `${getOrigin(request)}/chat`, getOrigin(request));
  nextUrl.searchParams.set('supabase', 'connected');

  if (verifiedState.projectId) {
    nextUrl.searchParams.set('projectId', verifiedState.projectId);
  }

  return redirect(nextUrl.toString());
}
