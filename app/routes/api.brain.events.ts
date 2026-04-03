import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { ensureBrainWorkspace, insertBrainEvent } from '~/lib/brain/server';
import { requireUserFromBearerToken } from '~/lib/brain/auth.server';
import { ingestBrainEventsById } from '~/lib/brain/ingest.server';
import { processMentorTriggersAfterBrainEvent } from '~/lib/mentor/triggers-apply.server';

const ALLOWED = new Set(['project.built', 'project.files_changed', 'project.published']);

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const { user } = await requireUserFromBearerToken(request);

  const body = (await request.json().catch(() => null)) as
    | {
        projectId?: string;
        type?: string;
        source?: 'builder' | 'mentor' | 'vertical' | 'system';
        idempotencyKey?: string | null;
        payload?: Record<string, unknown>;
        mentorSessionId?: string | null;
      }
    | null;

  const projectId = body?.projectId;
  const type = body?.type;
  const payload = body?.payload;
  const mentorSessionId =
    typeof body?.mentorSessionId === 'string' && body.mentorSessionId.trim().length > 0 ? body.mentorSessionId.trim() : null;

  if (!projectId || !type || !payload) {
    return Response.json({ error: '[RIDVAN-E831] Missing projectId, type, or payload' }, { status: 400 });
  }

  const normalizedType = type.trim();
  if (!ALLOWED.has(normalizedType)) {
    return Response.json({ error: '[RIDVAN-E832] Event type not allowed' }, { status: 400 });
  }

  const workspace = await ensureBrainWorkspace(projectId, user.id);

  const eventId = await insertBrainEvent({
    workspaceId: workspace.id,
    projectId,
    userId: user.id,
    source: 'builder',
    type: normalizedType,
    idempotencyKey: body?.idempotencyKey ?? null,
    payload: {
      ...payload,
      assertion_source: (payload as any)?.assertion_source ?? 'system_inferred',
    },
  });

  void ingestBrainEventsById([eventId]).catch((error) => {
    console.error('[RIDVAN-E833] Builder brain event ingestion failed', error);
  });

  void processMentorTriggersAfterBrainEvent({
    workspaceId: workspace.id,
    projectId,
    userId: user.id,
    eventType: normalizedType,
    payload: {
      ...payload,
      assertion_source: (payload as any)?.assertion_source ?? 'system_inferred',
    },
    mentorSessionId,
  }).catch((error) => {
    console.error('[RIDVAN-E1804] Mentor builder trigger processing failed', error);
  });

  return Response.json({ ok: true, eventId });
}
