import { atom } from 'nanostores';

const STORAGE_KEY = 'ridvan:mentor_unread_by_project_v1';

function readStorage(): Record<string, boolean> {
  if (typeof localStorage === 'undefined') {
    return {};
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const obj = parsed as Record<string, unknown>;
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'boolean') {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeStorage(value: Record<string, boolean>) {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export const mentorUnreadByProject = atom<Record<string, boolean>>({});

export function hydrateMentorUnread() {
  mentorUnreadByProject.set(readStorage());
}

export function setMentorUnread(projectId: string, unread: boolean) {
  const current = { ...mentorUnreadByProject.get() };
  current[projectId] = unread;
  mentorUnreadByProject.set(current);
  writeStorage(current);
}

export function isMentorUnread(projectId: string | null) {
  if (!projectId) {
    return false;
  }
  return Boolean(mentorUnreadByProject.get()[projectId]);
}
