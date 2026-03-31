import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { FEATURE_FLAGS } from '~/config/feature-flags';
import { getOptionalServerEnv } from '~/lib/env.server';
import { supabaseAdmin } from '~/lib/supabase/server';

const VERCEL_PROJECT_DOMAIN_API_URL = 'https://api.vercel.com/v10/projects';
const CNAME_TARGET = 'cname.vercel-dns.com';

type ProjectRow = {
  id: string;
  user_id: string;
  vercel_project_id: string | null;
};

function requireBearerToken(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    throw Response.json({ error: '[RIDVAN-E1941] Unauthorized: missing Bearer token' }, { status: 401 });
  }

  return token;
}

async function requireOwnedProject(projectId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, user_id, vercel_project_id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle<ProjectRow>();

  if (error || !data) {
    throw Response.json({ error: `[RIDVAN-E1942] Project not found: ${error?.message ?? 'unknown error'}` }, { status: 404 });
  }

  return data;
}

export async function action({ context, request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  if (!FEATURE_FLAGS.customDomains) {
    return Response.json({ error: '[RIDVAN-E1943] Custom domains are disabled for MVP' }, { status: 404 });
  }

  const vercelToken = getOptionalServerEnv('VERCEL_TOKEN', context.cloudflare?.env);

  if (!vercelToken) {
    return Response.json({ error: '[RIDVAN-E1943] Missing VERCEL_TOKEN environment variable' }, { status: 500 });
  }

  const token = requireBearerToken(request);

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return Response.json({ error: `[RIDVAN-E1944] Unauthorized: ${userError?.message ?? 'invalid token'}` }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    projectId?: string;
    domain?: string;
    vercelProjectId?: string;
  } | null;

  const projectId = body?.projectId?.trim();
  const domain = body?.domain?.trim().toLowerCase();

  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E1945] Missing project id' }, { status: 400 });
  }

  if (!domain) {
    return Response.json({ error: '[RIDVAN-E1946] Missing domain' }, { status: 400 });
  }

  const project = await requireOwnedProject(projectId, user.id);
  const vercelProjectId = body?.vercelProjectId?.trim() || project.vercel_project_id;

  if (!vercelProjectId) {
    return Response.json({ error: '[RIDVAN-E1947] Missing Vercel project id' }, { status: 400 });
  }

  const vercelRes = await fetch(`${VERCEL_PROJECT_DOMAIN_API_URL}/${vercelProjectId}/domains`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${vercelToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: domain }),
  });

  const vercelJson = (await vercelRes.json().catch(() => null)) as { error?: { message?: string } } | null;

  if (!vercelRes.ok) {
    return Response.json(
      { error: vercelJson?.error?.message || `[RIDVAN-E1948] Failed to attach domain (${vercelRes.status})` },
      { status: 500 },
    );
  }

  const { error: updateError } = await supabaseAdmin
    .from('projects')
    .update({
      custom_domain: domain,
      vercel_project_id: vercelProjectId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId)
    .eq('user_id', user.id);

  if (updateError) {
    return Response.json({ error: `[RIDVAN-E1949] Failed to save custom domain: ${updateError.message}` }, { status: 500 });
  }

  return Response.json({ ok: true, domain, cnameTarget: CNAME_TARGET });
}
