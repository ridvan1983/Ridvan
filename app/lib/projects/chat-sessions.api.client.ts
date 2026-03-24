import type { Message } from 'ai';

export interface ProjectChatSession {
  id: string;
  projectId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectChatSessionDetail extends ProjectChatSession {
  messages: Message[];
}

export async function listChatSessions(accessToken: string, projectId: string): Promise<ProjectChatSession[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/sessions`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`[RIDVAN-E731] Failed to list sessions (${res.status})`);
  }

  return (await res.json()) as ProjectChatSession[];
}

export async function createChatSession(
  accessToken: string,
  projectId: string,
  payload?: { title?: string | null },
): Promise<ProjectChatSessionDetail> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: payload?.title ?? null }),
  });

  if (!res.ok) {
    throw new Error(`[RIDVAN-E732] Failed to create session (${res.status})`);
  }

  return (await res.json()) as ProjectChatSessionDetail;
}

export async function getChatSession(
  accessToken: string,
  projectId: string,
  sessionId: string,
): Promise<ProjectChatSessionDetail> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`[RIDVAN-E733] Failed to load session (${res.status})`);
  }

  return (await res.json()) as ProjectChatSessionDetail;
}

export async function updateChatSessionMessages(
  accessToken: string,
  projectId: string,
  sessionId: string,
  payload: { title?: string | null; messages: Message[] },
): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`[RIDVAN-E734] Failed to update session (${res.status})`);
  }
}
