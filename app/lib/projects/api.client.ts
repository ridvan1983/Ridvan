import type { Project, ProjectSnapshot } from './types';

export async function listProjects(accessToken: string): Promise<Project[]> {
  const res = await fetch('/api/projects', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`[RIDVAN-E701] Failed to list projects (${res.status})`);
  }

  return (await res.json()) as Project[];
}

export async function getProject(accessToken: string, projectId: string): Promise<Project> {
  const res = await fetch(`/api/projects?projectId=${encodeURIComponent(projectId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 404) {
    throw new Error(`[RIDVAN-E705] Project not found`);
  }

  if (!res.ok) {
    throw new Error(`[RIDVAN-E706] Failed to load project (${res.status})`);
  }

  return (await res.json()) as Project;
}

export async function upsertProject(accessToken: string, project: { id: string; title?: string | null }): Promise<Project> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(project),
  });

  if (!res.ok) {
    throw new Error(`[RIDVAN-E702] Failed to create project (${res.status})`);
  }

  return (await res.json()) as Project;
}

export async function getLatestSnapshot(accessToken: string, projectId: string): Promise<ProjectSnapshot | null> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/snapshots?latest=1`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new Error(`[RIDVAN-E703] Failed to load snapshot (${res.status})`);
  }

  return (await res.json()) as ProjectSnapshot;
}

export async function deleteProject(accessToken: string, projectId: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 204) {
    return;
  }

  if (!res.ok) {
    throw new Error(`[RIDVAN-E749] Failed to delete project (${res.status})`);
  }
}

export async function createSnapshot(
  accessToken: string,
  payload: { projectId: string; title?: string | null; files: Record<string, string> },
): Promise<ProjectSnapshot> {
  const res = await fetch(`/api/projects/${encodeURIComponent(payload.projectId)}/snapshots`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: payload.title ?? null, files: payload.files }),
  });

  if (!res.ok) {
    throw new Error(`[RIDVAN-E704] Failed to create snapshot (${res.status})`);
  }

  return (await res.json()) as ProjectSnapshot;
}
