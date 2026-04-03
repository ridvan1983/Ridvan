import { type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { supabaseAdmin } from '~/lib/supabase/server';
import { grantFreeSignupCreditsIfEligible } from '~/lib/credits/signup-bonus.server';

export async function loader(_args: LoaderFunctionArgs) {
  return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return Response.json({ error: '[RIDVAN-E401] Unauthorized: missing Bearer token' }, { status: 401 });
  }

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return Response.json(
      { error: `[RIDVAN-E401] Unauthorized: ${userError?.message ?? 'invalid token'}` },
      { status: 401 },
    );
  }

  try {
    const { granted } = await grantFreeSignupCreditsIfEligible(user.id);
    return Response.json({ granted });
  } catch (error) {
    const message = error instanceof Error ? error.message : '[RIDVAN-E1229] Signup bonus failed';
    console.error(message);
    return Response.json({ error: message }, { status: 500 });
  }
}
