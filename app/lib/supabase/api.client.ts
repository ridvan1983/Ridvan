import type { Project } from '~/lib/projects/types';

export type SupabaseManagedProject = {
  id: string;
  name: string;
  status: string | null;
  region: string | null;
  organizationId: string | null;
  projectUrl: string;
};

export type SupabaseConnectionState = {
  connected: boolean;
  projects: SupabaseManagedProject[];
  projectConnection: {
    id: string;
    user_id: string;
    supabase_project_id: string | null;
    supabase_project_url: string | null;
    supabase_anon_key: string | null;
    supabase_connected_at: string | null;
  } | null;
};

export async function startSupabaseConnect(accessToken: string, payload: { projectId?: string | null; returnTo?: string }) {
  const response = await fetch('/api/supabase/connect', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = (await response.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;

  if (!response.ok || !json?.url) {
    throw new Error(json?.error || `[RIDVAN-E2140] Failed to start Supabase connect (${response.status})`);
  }

  return json.url;
}

export async function disconnectSupabase(accessToken: string, projectId?: string | null) {
  const response = await fetch('/api/supabase/connect', {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectId }),
  });

  if (!response.ok) {
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(json?.error || `[RIDVAN-E2141] Failed to disconnect Supabase (${response.status})`);
  }
}

export async function getSupabaseConnectionStatus(accessToken: string, projectId?: string | null) {
  const url = new URL('/api/supabase/connect', window.location.origin);

  if (projectId) {
    url.searchParams.set('projectId', projectId);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const json = (await response.json().catch(() => null)) as { connected?: boolean; error?: string } | null;

  if (!response.ok) {
    throw new Error(json?.error || `[RIDVAN-E2146] Failed to load Supabase connection status (${response.status})`);
  }

  return {
    connected: Boolean(json?.connected),
  };
}

export async function loadSupabaseProjects(accessToken: string, projectId?: string | null) {
  const url = new URL('/api/supabase/projects', window.location.origin);

  if (projectId) {
    url.searchParams.set('projectId', projectId);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const json = (await response.json().catch(() => null)) as SupabaseConnectionState | { error?: string } | null;

  if (!response.ok) {
    throw new Error((json as { error?: string } | null)?.error || `[RIDVAN-E2142] Failed to load Supabase projects (${response.status})`);
  }

  return json as SupabaseConnectionState;
}

export async function createManagedSupabaseProject(
  accessToken: string,
  payload: { name: string; organizationId?: string | null; region?: string | null },
) {
  const response = await fetch('/api/supabase/projects', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = (await response.json().catch(() => null)) as { ok?: boolean; project?: SupabaseManagedProject; error?: string } | null;

  if (!response.ok || !json?.project) {
    throw new Error(json?.error || `[RIDVAN-E2143] Failed to create Supabase project (${response.status})`);
  }

  return json.project;
}

export async function setupSupabaseForProject(accessToken: string, payload: { projectId: string; supabaseProjectId: string; anonKey: string }) {
  const response = await fetch('/api/supabase/setup', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    projectUrl?: string;
    anonKey?: string;
    supabaseProjectId?: string;
  } | null;

  if (!response.ok || !json?.projectUrl || !json?.anonKey) {
    throw new Error(json?.error || `[RIDVAN-E2144] Failed to setup Supabase project (${response.status})`);
  }

  return json;
}

export async function clearSupabaseProjectConnection(accessToken: string, projectId: string) {
  const response = await fetch('/api/supabase/setup', {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectId }),
  });

  if (!response.ok) {
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(json?.error || `[RIDVAN-E2145] Failed to disconnect project Supabase (${response.status})`);
  }
}
