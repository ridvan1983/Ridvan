/** Same key as mentor route — used when sending builder brain events with session-scoped dedupe. */
export function readMentorSessionIdForProject(projectId: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const v = window.localStorage.getItem(`ridvan:mentor-session:${projectId}`)?.trim();
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}
