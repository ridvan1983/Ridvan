import { ingestBrainEventsById } from '~/lib/brain/ingest.server';
import { insertBrainEventsBatch } from '~/lib/brain/server';
import { captureError } from '~/lib/server/monitoring.server';
import { supabaseAdmin } from '~/lib/supabase/server';

export type MentorEventInput = {
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string | null;
  source?: unknown;
};

function hasCountryCode(payload: Record<string, unknown>) {
  const raw = typeof payload.country_code === 'string' ? payload.country_code.trim() : '';
  return raw.length > 0;
}

function normalizeDocumentReadyPayload(payload: Record<string, unknown>) {
  const title = typeof payload.title === 'string' && payload.title.trim().length > 0 ? payload.title.trim() : 'Document';
  const documentType =
    typeof payload.documentType === 'string' && payload.documentType.trim().length > 0 ? payload.documentType.trim() : 'other';
  const content = typeof payload.content === 'string' ? payload.content : '';

  const formatsRaw = Array.isArray(payload.formats) ? payload.formats : [];
  const formats = formatsRaw
    .map((f) => String(f).toLowerCase().trim())
    .filter((f) => f === 'pdf' || f === 'docx' || f === 'xlsx' || f === 'pptx');

  return {
    ...payload,
    title,
    documentType,
    formats: formats.length > 0 ? formats : ['pdf', 'docx'],
    content,
  };
}

export function normalizeMentorEvents(events: MentorEventInput[]) {
  return (Array.isArray(events) ? events : [])
    .map((e) => {
      const basePayload = {
        ...e.payload,
        assertion_source: (e.payload as any)?.assertion_source ?? undefined,
      } as Record<string, unknown>;

      if (e.type.trim() === 'world.geo_set' && !hasCountryCode(basePayload)) {
        return null;
      }

      if (e.type.trim() === 'document.ready') {
        return {
          ...e,
          source: 'mentor' as const,
          idempotencyKey: null,
          payload: normalizeDocumentReadyPayload(basePayload),
        };
      }

      return {
        ...e,
        source: 'mentor' as const,
        idempotencyKey: null,
        payload: basePayload,
      };
    })
    .filter((e): e is NonNullable<typeof e> => Boolean(e));
}

export async function markMentorUnread(args: { userId: string; projectId: string; reply: string; eventCount: number }) {
  try {
    if ((args.reply ?? '').trim().length > 0 || args.eventCount > 0) {
      await supabaseAdmin
        .from('mentor_unread')
        .upsert({ user_id: args.userId, project_id: args.projectId, has_unread: true, updated_at: new Date().toISOString() }, { onConflict: 'user_id,project_id' });
    }
  } catch (error) {
    captureError(error, {
      route: 'api.mentor',
      userId: args.userId,
      extra: { stage: 'mentor_unread_upsert', projectId: args.projectId },
    });
    console.error('[RIDVAN-E1706] Failed to update mentor_unread (non-blocking)', error);
  }
}

export async function writeAndIngestMentorEvents(args: {
  workspaceId: string;
  projectId: string;
  userId: string;
  events: ReturnType<typeof normalizeMentorEvents>;
}) {
  try {
    const eventIds = await insertBrainEventsBatch({
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      userId: args.userId,
      source: 'mentor',
      events: args.events,
    });

    const ingestPromise = ingestBrainEventsById(eventIds);

    try {
      await Promise.race([ingestPromise, new Promise<void>((resolve) => setTimeout(resolve, 1500))]);
    } catch (error) {
      captureError(error, {
        route: 'api.mentor',
        userId: args.userId,
        extra: { stage: 'brain_ingestion_race', projectId: args.projectId, eventCount: eventIds.length },
      });
      console.error('[RIDVAN-E855] Brain ingestion failed', error);
    }

    void ingestPromise.catch((error) => {
      captureError(error, {
        route: 'api.mentor',
        userId: args.userId,
        extra: { stage: 'brain_ingestion_async', projectId: args.projectId, eventCount: eventIds.length },
      });
      console.error('[RIDVAN-E856] Brain ingestion async continuation failed', error);
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error ?? 'Unknown error');
    captureError(error, {
      route: 'api.mentor',
      userId: args.userId,
      extra: { stage: 'insert_brain_events', projectId: args.projectId, eventCount: args.events.length },
    });
    throw new Error(`[RIDVAN-E854] Failed to write Brain events: ${messageText}`);
  }
}
