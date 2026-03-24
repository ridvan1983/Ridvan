export async function writeBrainEvent(args: {
  accessToken: string;
  projectId: string;
  type: 'project.built' | 'project.files_changed' | 'project.published';
  payload: Record<string, unknown>;
  idempotencyKey?: string | null;
}) {
  const res = await fetch('/api/brain/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      projectId: args.projectId,
      type: args.type,
      payload: args.payload,
      idempotencyKey: args.idempotencyKey ?? null,
    }),
  });

  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(json?.error || `[RIDVAN-E1710] Brain event write failed (${res.status})`);
  }

  return (await res.json()) as { ok: true; eventId: string };
}
