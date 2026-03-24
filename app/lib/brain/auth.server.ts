import { supabaseAdmin } from '~/lib/supabase/server';

export function requireBearerToken(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    throw Response.json({ error: '[RIDVAN-E801] Unauthorized: missing Bearer token' }, { status: 401 });
  }

  return token;
}

export async function requireUserFromBearerToken(request: Request) {
  const token = requireBearerToken(request);

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    throw Response.json({ error: `[RIDVAN-E802] Unauthorized: ${userError?.message ?? 'invalid token'}` }, { status: 401 });
  }

  return { user, token };
}
