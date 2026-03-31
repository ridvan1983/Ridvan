import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { FEATURE_FLAGS } from '~/config/feature-flags';
import { createZip } from '~/lib/deploy/zip.server';
import { getOptionalServerEnv } from '~/lib/env.server';
import { supabaseAdmin } from '~/lib/supabase/server';

const NETLIFY_API_URL = 'https://api.netlify.com/api/v1';

type DeployFile = {
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
  custom_domain: string | null;
};

type NetlifySite = {
  id?: string;
  name?: string;
  ssl_url?: string;
  url?: string;
  admin_url?: string;
};

type NetlifyDeploy = {
  id?: string;
  state?: string;
  ssl_url?: string;
  url?: string;
  admin_url?: string;
  deploy_ssl_url?: string;
  deploy_url?: string;
  site_id?: string;
  error_message?: string;
  required?: string[];
};

const SPA_NETLIFY_REDIRECT = '/*    /index.html   200\n';

function ensureSpaRedirectFile(files: DeployFile[]) {
  const existing = files.find((file) => file.file === '_redirects');

  if (!existing) {
    return [...files, { file: '_redirects', data: SPA_NETLIFY_REDIRECT, encoding: 'utf-8' as const }];
  }

  if (existing.encoding !== 'utf-8') {
    return files;
  }

  if (existing.data.includes('/*') && existing.data.includes('/index.html') && existing.data.includes('200')) {
    return files;
  }

  return files.map((file) =>
    file.file === '_redirects'
      ? { ...file, data: `${file.data.trimEnd()}\n${SPA_NETLIFY_REDIRECT}` }
      : file,
  );
}

function requireBearerToken(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    throw Response.json({ error: '[RIDVAN-E1960] Unauthorized: missing Bearer token' }, { status: 401 });
  }

  return token;
}

function slugifyProjectName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

async function requireOwnedProject(projectId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, user_id, title, preview_url, preview_build_hash, custom_domain')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle<ProjectRow>();

  if (error || !data) {
    throw Response.json({ error: `[RIDVAN-E1961] Project not found: ${error?.message ?? 'unknown error'}` }, { status: 404 });
  }

  return data;
}

function toFileBytes(file: DeployFile) {
  if (file.encoding === 'base64') {
    return Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0));
  }

  return new TextEncoder().encode(file.data);
}

async function findSiteByName(name: string, token: string) {
  const response = await fetch(`${NETLIFY_API_URL}/sites/${name}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const json = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(json?.message || `[RIDVAN-E1962] Failed to fetch Netlify site (${response.status})`);
  }

  return (await response.json()) as NetlifySite;
}

async function createSite(name: string, token: string) {
  const response = await fetch(`${NETLIFY_API_URL}/sites`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  });

  const json = (await response.json().catch(() => null)) as { message?: string } & NetlifySite;

  if (!response.ok || !json?.id) {
    throw new Error(json?.message || `[RIDVAN-E1963] Failed to create Netlify site (${response.status})`);
  }

  return json;
}

async function ensureSite(name: string, token: string) {
  const existing = await findSiteByName(name, token).catch(() => null);

  if (existing?.id) {
    return existing;
  }

  return createSite(name, token);
}

async function waitForDeployReady(deployId: string, token: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(`${NETLIFY_API_URL}/deploys/${deployId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const json = (await response.json().catch(() => null)) as NetlifyDeploy | null;

    if (!response.ok) {
      return json;
    }

    if (json?.state === 'ready') {
      return json;
    }

    if (json?.state === 'error') {
      return json;
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  return null;
}

export async function action({ context, request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  if (!FEATURE_FLAGS.netlifyDeploy) {
    return Response.json({ error: '[RIDVAN-E1964] Netlify deploy is disabled for MVP', provider: 'netlify' }, { status: 404 });
  }

  const netlifyToken = getOptionalServerEnv('NETLIFY_TOKEN', context.cloudflare?.env);

  if (!netlifyToken) {
    return Response.json({ error: '[RIDVAN-E1964] Missing NETLIFY_TOKEN environment variable', provider: 'netlify' }, { status: 500 });
  }

  const token = requireBearerToken(request);
  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return Response.json({ error: `[RIDVAN-E1965] Unauthorized: ${userError?.message ?? 'invalid token'}`, provider: 'netlify' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    projectId?: string;
    projectName?: string;
    subdomain?: string;
    sourceHash?: string;
    files?: DeployFile[];
  } | null;

  const projectId = body?.projectId?.trim();
  const sourceHash = body?.sourceHash?.trim() ?? null;
  const files = Array.isArray(body?.files) ? body.files : null;

  if (!projectId) {
    return Response.json({ error: '[RIDVAN-E1966] Missing project id', provider: 'netlify' }, { status: 400 });
  }

  const project = await requireOwnedProject(projectId, user.id);

  if ((!files || files.length === 0) && sourceHash && project.preview_url && project.preview_build_hash === sourceHash) {
    return Response.json({
      ok: true,
      provider: 'netlify',
      status: 'live',
      url: project.preview_url,
      reused: true,
      customDomain: project.custom_domain,
    });
  }

  if (!files || files.length === 0) {
    return Response.json({ error: '[RIDVAN-E1967] Deploy files required', provider: 'netlify' }, { status: 409 });
  }

  try {
    const requestedSubdomain = body?.subdomain?.trim() || '';
    const rawProjectName = requestedSubdomain || body?.projectName?.trim() || project.title || 'ridvan-app';
    const slug = slugifyProjectName(rawProjectName) || 'ridvan-app';
    const siteName = `ridvan-${slug}-${projectId.slice(0, 8)}`.slice(0, 63);
    const site = await ensureSite(siteName, netlifyToken);
    const deployFiles = ensureSpaRedirectFile(files);

    if (!site.id) {
      throw new Error('[RIDVAN-E1968] Netlify site id missing after site creation');
    }

    const zip = createZip(
      deployFiles.map((file) => ({
        path: file.file.replace(/^\/+/, ''),
        data: toFileBytes(file),
      })),
    );

    const deployResponse = await fetch(`${NETLIFY_API_URL}/sites/${site.id}/deploys`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${netlifyToken}`,
        'Content-Type': 'application/zip',
      },
      body: zip,
    });

    const deployJson = (await deployResponse.json().catch(() => null)) as NetlifyDeploy | null;

    if (!deployResponse.ok || !deployJson?.id) {
      return Response.json(
        { error: deployJson?.error_message || `[RIDVAN-E1969] Netlify deploy failed (${deployResponse.status})`, provider: 'netlify', status: 'error' },
        { status: 500 },
      );
    }

    const readyDeploy = await waitForDeployReady(deployJson.id, netlifyToken);

    if (!readyDeploy) {
      return Response.json({ error: '[RIDVAN-E1970] Netlify deployment timed out before becoming ready', provider: 'netlify', status: 'error' }, { status: 504 });
    }

    if (readyDeploy.state === 'error') {
      return Response.json(
        { error: readyDeploy.error_message || '[RIDVAN-E1971] Netlify deployment failed', provider: 'netlify', status: 'error' },
        { status: 500 },
      );
    }

    const liveUrl = readyDeploy.ssl_url || readyDeploy.deploy_ssl_url || site.ssl_url || readyDeploy.url || readyDeploy.deploy_url || site.url;

    if (!liveUrl) {
      return Response.json({ error: '[RIDVAN-E1972] Netlify deployment became ready but returned no live URL', provider: 'netlify', status: 'error' }, { status: 500 });
    }

    const { error: updateError } = await supabaseAdmin
      .from('projects')
      .update({
        preview_url: liveUrl,
        preview_build_hash: sourceHash,
        custom_domain: project.custom_domain,
        preview_published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId)
      .eq('user_id', user.id);

    if (updateError) {
      return Response.json(
        { error: `[RIDVAN-E1973] Failed to save preview URL: ${updateError.message}`, provider: 'netlify', status: 'error' },
        { status: 500 },
      );
    }

    return Response.json({
      ok: true,
      provider: 'netlify',
      status: 'live',
      url: liveUrl,
      reused: false,
      netlifySiteId: site.id,
      netlifySiteName: site.name ?? siteName,
      customDomain: project.custom_domain,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '[RIDVAN-E1974] Netlify deployment failed', provider: 'netlify', status: 'error' },
      { status: 500 },
    );
  }
}
