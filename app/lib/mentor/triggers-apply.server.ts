import { ingestBrainEventsById } from '~/lib/brain/ingest.server';
import { insertBrainEventsBatch } from '~/lib/brain/server';
import { markMentorUnread } from '~/lib/mentor/brain-events.server';
import type { MentorBuilderTriggerType } from '~/lib/mentor/triggers.server';
import {
  buildMentorTriggerMessage,
  inferTriggersFromBrainEvent,
  inferTriggersFromBuilderSeedContext,
  nextRefactorBurstState,
  pickHighestPriorityTrigger,
  type MentorRefactorBurstState,
} from '~/lib/mentor/triggers.server';
import { captureError } from '~/lib/server/monitoring.server';
import { supabaseAdmin } from '~/lib/supabase/server';

const DEDUPE_KEY = 'mentor_trigger_dedupe_v1';
const BURST_KEY = 'mentor_refactor_burst_v1';

type DedupeV1 = {
  v: 1;
  bySession: Record<string, Partial<Record<MentorBuilderTriggerType, string>>>;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeDedupe(raw: unknown): DedupeV1 {
  const o = asObject(raw);
  const bySessionRaw = o.bySession;
  const bySession: DedupeV1['bySession'] = {};
  if (bySessionRaw && typeof bySessionRaw === 'object' && !Array.isArray(bySessionRaw)) {
    for (const [sk, mapVal] of Object.entries(bySessionRaw as Record<string, unknown>)) {
      if (mapVal && typeof mapVal === 'object' && !Array.isArray(mapVal)) {
        bySession[sk] = { ...(mapVal as Partial<Record<MentorBuilderTriggerType, string>>) };
      }
    }
  }
  return { v: 1, bySession };
}

function normalizeBurst(raw: unknown): MentorRefactorBurstState | null {
  const o = asObject(raw);
  const windowStartMs = typeof o.windowStartMs === 'number' ? o.windowStartMs : Number(o.windowStartMs);
  const eventCount = typeof o.eventCount === 'number' ? o.eventCount : Number(o.eventCount);
  if (!Number.isFinite(windowStartMs) || !Number.isFinite(eventCount)) {
    return null;
  }
  return { windowStartMs, eventCount };
}

async function loadCurrentSignals(workspaceId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin
    .from('brain_project_state')
    .select('current_signals')
    .eq('workspace_id', workspaceId)
    .maybeSingle<{ current_signals: Record<string, unknown> | null }>();

  if (error) {
    throw new Error(`[RIDVAN-E1801] loadCurrentSignals: ${error.message}`);
  }

  return (data?.current_signals as Record<string, unknown>) ?? {};
}

async function persistSignalPatches(args: {
  workspaceId: string;
  projectId: string;
  userId: string;
  patches: Array<{ key: string; payload: unknown }>;
}) {
  if (args.patches.length === 0) {
    return;
  }

  const eventIds = await insertBrainEventsBatch({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    userId: args.userId,
    source: 'system',
    events: [
      {
        type: 'signals.updated',
        payload: { patches: args.patches },
      },
    ],
  });

  void ingestBrainEventsById(eventIds).catch((err) => {
    console.error('[RIDVAN-E1802] mentor trigger signal ingest failed', err);
  });
}

function sessionBucket(mentorSessionId: string | null | undefined): string {
  const t = mentorSessionId?.trim();
  return t && t.length > 0 ? t : '_default';
}

async function tryEmitMentorTrigger(args: {
  workspaceId: string;
  projectId: string;
  userId: string;
  mentorSessionId: string | null | undefined;
  trigger: MentorBuilderTriggerType;
  currentSignals: Record<string, unknown>;
  extraPatches?: Array<{ key: string; payload: unknown }>;
}): Promise<'emitted' | 'deduped'> {
  const bucket = sessionBucket(args.mentorSessionId);
  const dedupe = normalizeDedupe(args.currentSignals[DEDUPE_KEY]);
  if (dedupe.bySession[bucket]?.[args.trigger]) {
    return 'deduped';
  }

  const content = buildMentorTriggerMessage(args.trigger);
  const nextDedupe: DedupeV1 = {
    v: 1,
    bySession: {
      ...dedupe.bySession,
      [bucket]: {
        ...(dedupe.bySession[bucket] ?? {}),
        [args.trigger]: new Date().toISOString(),
      },
    },
  };

  const { error: insertError } = await supabaseAdmin.from('mentor_messages').insert({
    project_id: args.projectId,
    user_id: args.userId,
    session_id: args.mentorSessionId?.trim() || null,
    role: 'mentor',
    content: content.slice(0, 20_000),
  });

  if (insertError) {
    throw new Error(`[RIDVAN-E1803] mentor trigger insert failed: ${insertError.message}`);
  }

  await markMentorUnread({ userId: args.userId, projectId: args.projectId, reply: content, eventCount: 0 });

  const patches: Array<{ key: string; payload: unknown }> = [{ key: DEDUPE_KEY, payload: nextDedupe }, ...(args.extraPatches ?? [])];

  await persistSignalPatches({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    userId: args.userId,
    patches,
  });

  return 'emitted';
}

function burstResetPatch(): { key: string; payload: MentorRefactorBurstState } {
  return { key: BURST_KEY, payload: { windowStartMs: Date.now(), eventCount: 0 } };
}

/**
 * After a builder brain event is stored: optionally insert a proactive mentor row (deduped per session × trigger type).
 */
export async function processMentorTriggersAfterBrainEvent(args: {
  workspaceId: string;
  projectId: string;
  userId: string;
  eventType: string;
  payload: Record<string, unknown>;
  mentorSessionId?: string | null;
}): Promise<void> {
  try {
    const currentSignals = await loadCurrentSignals(args.workspaceId);
    const inferred = inferTriggersFromBrainEvent(args.eventType, args.payload);
    const candidates = new Set(inferred);

    let burstNext: MentorRefactorBurstState | null = null;
    let shouldFireRefactor = false;

    if (args.eventType === 'project.files_changed') {
      const prevBurst = normalizeBurst(currentSignals[BURST_KEY]);
      const rolled = nextRefactorBurstState(prevBurst, Date.now());
      burstNext = rolled.next;
      shouldFireRefactor = rolled.shouldFireRefactor;
      if (shouldFireRefactor) {
        candidates.add('MAJOR_REFACTOR');
      }
    }

    const chosen = pickHighestPriorityTrigger([...candidates]);

    if (!chosen) {
      if (args.eventType === 'project.files_changed' && burstNext) {
        await persistSignalPatches({
          workspaceId: args.workspaceId,
          projectId: args.projectId,
          userId: args.userId,
          patches: [{ key: BURST_KEY, payload: burstNext }],
        });
      }
      return;
    }

    const extraForEmit =
      args.eventType === 'project.files_changed' && burstNext
        ? chosen === 'MAJOR_REFACTOR' && shouldFireRefactor
          ? [burstResetPatch()]
          : [{ key: BURST_KEY, payload: burstNext }]
        : [];

    const status = await tryEmitMentorTrigger({
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      userId: args.userId,
      mentorSessionId: args.mentorSessionId,
      trigger: chosen,
      currentSignals,
      extraPatches: extraForEmit,
    });

    if (status === 'deduped' && args.eventType === 'project.files_changed' && burstNext) {
      if (chosen === 'MAJOR_REFACTOR' && shouldFireRefactor) {
        await persistSignalPatches({
          workspaceId: args.workspaceId,
          projectId: args.projectId,
          userId: args.userId,
          patches: [burstResetPatch()],
        });
        return;
      }

      await persistSignalPatches({
        workspaceId: args.workspaceId,
        projectId: args.projectId,
        userId: args.userId,
        patches: [{ key: BURST_KEY, payload: burstNext }],
      });
    }
  } catch (error) {
    captureError(error, {
      route: 'api.brain.events',
      userId: args.userId,
      extra: { stage: 'mentor_triggers', projectId: args.projectId, eventType: args.eventType },
    });
  }
}

export async function processMentorTriggersForBuilderSeed(args: {
  workspaceId: string;
  projectId: string;
  userId: string;
  initialPrompt: string;
  filePaths: string[];
  mentorSessionId?: string | null;
}): Promise<void> {
  try {
    const currentSignals = await loadCurrentSignals(args.workspaceId);
    const candidates = inferTriggersFromBuilderSeedContext({
      initialPrompt: args.initialPrompt,
      filePaths: args.filePaths,
    });
    const trigger = pickHighestPriorityTrigger(candidates);
    if (!trigger) {
      return;
    }

    await tryEmitMentorTrigger({
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      userId: args.userId,
      mentorSessionId: args.mentorSessionId,
      trigger,
      currentSignals,
    });
  } catch (error) {
    captureError(error, {
      route: 'api.brain.builder-seed',
      userId: args.userId,
      extra: { stage: 'mentor_triggers_seed', projectId: args.projectId },
    });
  }
}
