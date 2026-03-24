import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { ensureBrainWorkspace, insertBrainEvent } from '~/lib/brain/server';
import { ingestBrainEventsById } from '~/lib/brain/ingest.server';
import { normalizeSignalPatches, type SignalPatchInput } from '~/lib/vertical/signals.server';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const { user } = await requireUserFromBearerToken(request);

  const body = (await request.json().catch(() => null)) as
    | {
        projectId?: string;
        patches?: SignalPatchInput[];
      }
    | null;

  const projectId = body?.projectId;
  const patches = Array.isArray(body?.patches) ? body!.patches : null;

  if (!projectId || !patches || patches.length === 0) {
    return Response.json({ error: '[RIDVAN-E961] Missing projectId or patches' }, { status: 400 });
  }

  const workspace = await ensureBrainWorkspace(projectId, user.id);

  let normalized;
  try {
    normalized = normalizeSignalPatches(patches);
  } catch (error) {
    const message = error instanceof Error ? error.message : '[RIDVAN-E962] Invalid signal patches';
    return Response.json({ error: message }, { status: 400 });
  }

  const eventId = await insertBrainEvent({
    workspaceId: workspace.id,
    projectId,
    userId: user.id,
    source: 'vertical',
    type: 'signals.updated',
    payload: {
      patches: normalized,
      assertion_source: 'user_stated',
    },
  });

  void ingestBrainEventsById([eventId]).catch((error) => {
    console.error('[RIDVAN-E963] Signals ingestion failed', error);
  });

  return Response.json({ ok: true, wroteEvent: eventId, patchCount: normalized.length });
}
