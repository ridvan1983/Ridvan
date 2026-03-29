import { supabaseAdmin } from '~/lib/supabase/server';

const SUPABASE_MANAGEMENT_API_URL = 'https://api.supabase.com/v1';
const SUPABASE_OAUTH_API_URL = 'https://api.supabase.com/v1/oauth';

type CloudflareEnvWithSupabaseOauth = {
  SUPABASE_CLIENT_ID?: string;
  SUPABASE_CLIENT_SECRET?: string;
};

type SupabaseTokenRow = {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
};

type ProjectOwnerRow = {
  user_id: string;
};

type SupabaseProject = {
  id?: string;
  organization_id?: string;
  name?: string;
  region?: string;
  status?: string;
  inserted_at?: string;
  created_at?: string;
  database?: {
    host?: string;
    version?: string;
  };
};

type SupabaseApiKey = {
  api_key?: string;
  name?: string;
  type?: string;
};

export type ConnectedSupabaseProject = {
  id: string;
  name: string;
  status: string | null;
  region: string | null;
  organizationId: string | null;
  projectUrl: string;
};

type SupabaseOauthStatePayload = {
  userId: string;
  projectId: string | null;
  returnTo: string;
};

function toBase64Url(value: Uint8Array) {
  const base64 = btoa(String.fromCharCode(...value));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function signPayload(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

export async function signSupabaseOauthState(payload: SupabaseOauthStatePayload, secret: string) {
  const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await signPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export async function verifySupabaseOauthState(state: string, secret: string) {
  const [encodedPayload, signature] = state.split('.');

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = await signPayload(encodedPayload, secret);

  if (signature !== expectedSignature) {
    return null;
  }

  try {
    const json = new TextDecoder().decode(fromBase64Url(encodedPayload));
    return JSON.parse(json) as SupabaseOauthStatePayload;
  } catch {
    return null;
  }
}

function getOauthEnv(env: CloudflareEnvWithSupabaseOauth | undefined) {
  const clientId = env?.SUPABASE_CLIENT_ID ?? process.env.SUPABASE_CLIENT_ID;
  const clientSecret = env?.SUPABASE_CLIENT_SECRET ?? process.env.SUPABASE_CLIENT_SECRET;

  return { clientId, clientSecret };
}

export function requireSupabaseOauthEnv(env: CloudflareEnvWithSupabaseOauth | undefined) {
  const { clientId, clientSecret } = getOauthEnv(env);

  if (!clientId || !clientSecret) {
    throw new Error('[RIDVAN-E2100] Missing SUPABASE_CLIENT_ID or SUPABASE_CLIENT_SECRET');
  }

  return { clientId, clientSecret };
}

export function buildSupabaseOauthUrl(args: { clientId: string; redirectUri: string; state: string }) {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: 'code',
    state: args.state,
  });

  return `https://api.supabase.com/v1/oauth/authorize?${params.toString()}`;
}

export async function exchangeSupabaseOauthCode(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}) {
  const credentials = btoa(`${args.clientId}:${args.clientSecret}`);
  const requestBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
  });

  const response = await fetch(`${SUPABASE_OAUTH_API_URL}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: requestBody.toString(),
  });

  const responseText = await response.text().catch(() => '');

  const json = (() => {
    try {
      return JSON.parse(responseText) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error_description?: string;
        error?: string;
        message?: string;
      };
    } catch {
      return null;
    }
  })();

  if (!response.ok || !json?.access_token) {
    throw new Error(
      JSON.stringify({
        code: '[RIDVAN-E2101]',
        message: 'Failed to exchange Supabase OAuth code',
        request: {
          url: `${SUPABASE_OAUTH_API_URL}/token`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: 'Basic [REDACTED]',
          },
          body: requestBody.toString(),
        },
        response: {
          status: response.status,
          body: responseText || null,
          parsed: json,
        },
      }),
    );
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: typeof json.expires_in === 'number' ? new Date(Date.now() + json.expires_in * 1000).toISOString() : null,
  };
}

export async function saveSupabaseUserTokens(userId: string, tokens: { accessToken: string; refreshToken: string | null; expiresAt: string | null }) {
  const { error } = await supabaseAdmin.from('user_supabase_tokens').upsert({
    user_id: userId,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_at: tokens.expiresAt,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`[RIDVAN-E2102] Failed to store Supabase token: ${error.message}`);
  }
}

export async function getSupabaseUserToken(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('user_supabase_tokens')
    .select('user_id, access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .maybeSingle<SupabaseTokenRow>();

  if (error) {
    throw new Error(`[RIDVAN-E2103] Failed to read Supabase token: ${error.message}`);
  }

  return data;
}

export async function resolveSupabaseIntegrationUserId(authUserId: string, projectId?: string | null) {
  if (!projectId) {
    return authUserId;
  }

  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('user_id')
    .eq('id', projectId)
    .maybeSingle<ProjectOwnerRow>();

  if (error) {
    throw new Error(`[RIDVAN-E2107] Failed to resolve Supabase integration user id: ${error.message}`);
  }

  return data?.user_id ?? authUserId;
}

async function managementFetch<T>(path: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(`${SUPABASE_MANAGEMENT_API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const json = (await response.json().catch(() => null)) as T & { message?: string; error?: string } | null;

  if (!response.ok) {
    throw new Error(json?.message || json?.error || `[RIDVAN-E2104] Supabase management request failed (${response.status})`);
  }

  return json;
}

export async function listSupabaseProjects(accessToken: string): Promise<ConnectedSupabaseProject[]> {
  const json = (await managementFetch<unknown[]>('/projects', accessToken, { method: 'GET' })) ?? [];
  const projects = Array.isArray(json) ? (json as SupabaseProject[]) : [];

  return projects
    .filter((project) => Boolean(project.id))
    .map((project) => ({
      id: project.id ?? '',
      name: project.name ?? project.id ?? 'Untitled Supabase Project',
      status: project.status ?? null,
      region: project.region ?? null,
      organizationId: project.organization_id ?? null,
      projectUrl: `https://${project.id}.supabase.co`,
    }));
}

export async function createSupabaseProject(args: { accessToken: string; name: string; organizationId?: string | null; region?: string | null }) {
  const body = {
    name: args.name,
    organization_id: args.organizationId ?? undefined,
    region: args.region ?? undefined,
    plan: 'free',
  };

  const json = await managementFetch<SupabaseProject>('/projects', args.accessToken, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!json?.id) {
    throw new Error('[RIDVAN-E2105] Supabase project creation returned no project id');
  }

  return {
    id: json.id,
    name: json.name ?? body.name,
    status: json.status ?? null,
    region: json.region ?? null,
    organizationId: json.organization_id ?? null,
    projectUrl: `https://${json.id}.supabase.co`,
  } satisfies ConnectedSupabaseProject;
}

export async function getSupabaseAnonKey(accessToken: string, projectRef: string) {
  const json = (await managementFetch<unknown[]>(`/projects/${projectRef}/api-keys`, accessToken, { method: 'GET' })) ?? [];
  const keys = Array.isArray(json) ? (json as SupabaseApiKey[]) : [];
  const anonKey = keys.find((key) => key.name === 'anon' || key.type === 'anon' || key.name === 'publishable');

  if (!anonKey?.api_key) {
    throw new Error('[RIDVAN-E2106] Could not find Supabase anon key for project');
  }

  return anonKey.api_key;
}

export async function runSupabaseSql(accessToken: string, projectRef: string, query: string) {
  await managementFetch(`/projects/${projectRef}/database/query`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
}
