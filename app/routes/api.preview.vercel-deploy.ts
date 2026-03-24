import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { supabaseAdmin } from '~/lib/supabase/server';

const VERCEL_API_URL = 'https://api.vercel.com/v13/deployments';
const VERCEL_PROJECT_DOMAIN_API_URL = 'https://api.vercel.com/v10/projects';
const RIDVAN_DOMAIN_SUFFIX = 'ridvan.app';

type VercelDeployFile = {
  file: string;
  data: string;
  encoding: 'utf-8' | 'base64';
};

type ProjectRow = {
  id: string;
  user_id: string;
  title: string | null;
  preview_url: string | null;
  preview_build_hash: string | null;
  vercel_project_id: string | null;
  custom_domain: string | null;
};

type VercelDeploymentResponse = {
  id?: string;
  url?: string;
  readyState?: string;
  aliasAssigned?: boolean;
  alias?: string[];
  automaticAliases?: string[];
  project?: {
    id?: string;
    name?: string;
  };
  error?: {
    message?: string;
    code?: string;
  };
};

async function waitForDeploymentReady(id: string, token: string) {
  const maxAttempts = 20;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(`${VERCEL_API_URL}/${id}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const data = (await res.json().catch(() => null)) as VercelDeploymentResponse | null;

    console.log('4b. Vercel deployment poll status:', res.status, 'readyState:', data?.readyState ?? null);

    if (!res.ok) {
      return data;
    }

    if (data?.readyState === 'READY') {
      return data;
    }

    if (data?.readyState === 'ERROR' || data?.readyState === 'CANCELED') {
      return data;
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  return null;
}

async function attachDomainToProject(vercelProjectId: string, domain: string, token: string) {
  const res = await fetch(`${VERCEL_PROJECT_DOMAIN_API_URL}/${vercelProjectId}/domains`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: domain }),
  });

  const data = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;

  return {
    ok: res.ok,
    error: data?.error?.message ?? null,
  };
}

function requireBearerToken(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    throw Response.json({ error: '[RIDVAN-E1930] Unauthorized: missing Bearer token' }, { status: 401 });
  }

  return token;
}

function slugifyProjectName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

async function requireOwnedProject(projectId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, user_id, title, preview_url, preview_build_hash, vercel_project_id, custom_domain')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle<ProjectRow>();

  if (error || !data) {
    throw Response.json({ error: `[RIDVAN-E1931] Project not found: ${error?.message ?? 'unknown error'}` }, { status: 404 });
  }

  return data;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  console.log('1. Endpoint called');

  const vercelToken = process.env.VERCEL_TOKEN;

  console.log('2. VERCEL_TOKEN exists:', !!vercelToken);

  if (!vercelToken) {
    return Response.json({ error: '[RIDVAN-E1932] Missing VERCEL_TOKEN environment variable' }, { status: 500 });
  }

  const token = requireBearerToken(request);

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return Response.json({ error: `[RIDVAN-E1933] Unauthorized: ${userError?.message ?? 'invalid token'}` }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    projectId?: string;
    projectName?: string;
    subdomain?: string;
    sourceHash?: string;
    files?: VercelDeployFile[];
  } | null;

  const projectId = body?.projectId?.trim();
  const sourceHash = body?.sourceHash?.trim() ?? null;
  const files = Array.isArray(body?.files) ? body.files : null;

  console.log('3. Files received:', files?.length ?? 0);

  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E1934] Missing project id' }, { status: 400 });
  }

  const project = await requireOwnedProject(projectId, user.id);

  if ((!files || files.length === 0) && sourceHash && project.preview_url && project.preview_build_hash === sourceHash) {
    return Response.json({
      ok: true,
      url: project.preview_url,
      reused: true,
      vercelProjectId: project.vercel_project_id,
      customDomain: project.custom_domain,
    });
  }

  if (!files || files.length === 0) {
    return Response.json({ error: '[RIDVAN-E1935] Deploy files required' }, { status: 409 });
  }

  const requestedSubdomain = body?.subdomain?.trim() || '';
  const rawProjectName = requestedSubdomain || body?.projectName?.trim() || project.title || 'ridvan-app';
  const slug = slugifyProjectName(rawProjectName) || 'ridvan-app';
  const deploymentName = `ridvan-${slug}`.slice(0, 100);

  const vercelRes = await fetch(VERCEL_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${vercelToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: deploymentName,
      public: true,
      target: 'production',
      files,
      projectSettings: {
        framework: null,
      },
    }),
  });

  const deployment = (await vercelRes.json().catch(() => null)) as VercelDeploymentResponse | null;

  console.log('4. Vercel API response status:', vercelRes.status);
  console.log('5. Vercel API response body:', JSON.stringify(deployment));

  if (!vercelRes.ok || !deployment?.id) {
    const message = deployment?.error?.message || `[RIDVAN-E1936] Vercel deploy failed (${vercelRes.status})`;
    return Response.json({ error: message }, { status: 500 });
  }

  const readyDeployment = await waitForDeploymentReady(deployment.id, vercelToken);

  if (!readyDeployment) {
    return Response.json({ error: '[RIDVAN-E1938] Vercel deployment timed out before becoming ready' }, { status: 504 });
  }

  if (readyDeployment.readyState === 'ERROR' || readyDeployment.readyState === 'CANCELED') {
    const message = readyDeployment.error?.message || `[RIDVAN-E1939] Vercel deployment failed with state ${readyDeployment.readyState}`;
    return Response.json({ error: message }, { status: 500 });
  }

  const liveHost = deployment.url ?? readyDeployment.url;

  if (!liveHost) {
    return Response.json({ error: '[RIDVAN-E1940] Vercel deployment became ready but returned no live URL' }, { status: 500 });
  }

  const previewUrl = `https://${liveHost}`;
  const vercelProjectId = deployment.project?.id ?? readyDeployment.project?.id ?? null;
  const ridvanDomain = slug ? `${slug}.${RIDVAN_DOMAIN_SUFFIX}` : null;
  let effectivePreviewUrl = previewUrl;
  let effectiveCustomDomain = project.custom_domain;

  if (vercelProjectId && ridvanDomain) {
    const domainResult = await attachDomainToProject(vercelProjectId, ridvanDomain, vercelToken);

    if (domainResult.ok) {
      effectivePreviewUrl = `https://${ridvanDomain}`;
      effectiveCustomDomain = ridvanDomain;
    }
  }

  console.log('6. Final live URL:', effectivePreviewUrl);

  const { error: updateError } = await supabaseAdmin
    .from('projects')
    .update({
      preview_url: effectivePreviewUrl,
      preview_build_hash: sourceHash,
      vercel_project_id: vercelProjectId,
      custom_domain: effectiveCustomDomain,
      preview_published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId)
    .eq('user_id', user.id);

  if (updateError) {
    return Response.json({ error: `[RIDVAN-E1937] Failed to save preview URL: ${updateError.message}` }, { status: 500 });
  }

  return Response.json({
    ok: true,
    url: effectivePreviewUrl,
    reused: false,
    vercelProjectId,
    customDomain: effectiveCustomDomain,
    suggestedSubdomain: ridvanDomain,
  });
}
