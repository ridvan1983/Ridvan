import { supabaseAdmin } from '~/lib/supabase/server';
import type { BrainEventInput, BrainEventSource } from './types';

interface BrainWorkspaceRow {
  id: string;
  project_id: string;
  user_id: string;
}

async function getExistingBrainEventId(workspaceId: string, idempotencyKey: string) {
  const { data, error } = await supabaseAdmin
    .from('brain_events')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle<{ id: string }>();

  if (error) {
    throw new Error(`[RIDVAN-E816] Failed to load existing brain event: ${error.message}`);
  }

  if (!data?.id) {
    throw new Error('[RIDVAN-E817] Brain event was deduplicated but no existing row could be found');
  }

  return data.id;
}

function isMissingOnConflictConstraintError(message: string) {
  return message.includes('there is no unique or exclusion constraint matching the ON CONFLICT specification');
}

function isDuplicateIdempotencyError(message: string) {
  return message.includes('duplicate key value violates unique constraint') && message.includes('brain_events_workspace_idempotency_key_uq');
}

export async function ensureBrainWorkspace(projectId: string, userId: string) {
  const { data: existing, error: loadError } = await supabaseAdmin
    .from('brain_workspaces')
    .select('id, project_id, user_id')
    .eq('project_id', projectId)
    .maybeSingle<BrainWorkspaceRow>();

  if (loadError) {
    throw new Error(`[RIDVAN-E811] Failed to load brain workspace: ${loadError.message}`);
  }

  if (existing) {
    if (existing.user_id !== userId) {
      throw new Error('[RIDVAN-E812] Brain workspace project owner mismatch');
    }

    return existing;
  }

  const { data: created, error: createError } = await supabaseAdmin
    .from('brain_workspaces')
    .insert({ project_id: projectId, user_id: userId })
    .select('id, project_id, user_id')
    .single<BrainWorkspaceRow>();

  if (createError || !created) {
    throw new Error(`[RIDVAN-E813] Failed to create brain workspace: ${createError?.message ?? 'unknown error'}`);
  }

  return created;
}

export async function insertBrainEvent(args: {
  workspaceId: string;
  projectId: string;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  source?: BrainEventSource;
  idempotencyKey?: string | null;
}) {
  const row = {
    workspace_id: args.workspaceId,
    project_id: args.projectId,
    user_id: args.userId,
    source: args.source ?? ('system' as BrainEventSource),
    type: args.type,
    idempotency_key: args.idempotencyKey ?? null,
    payload: args.payload,
  };

  const query = supabaseAdmin.from('brain_events');
  const response = args.idempotencyKey
    ? await query.upsert(row, { onConflict: 'workspace_id,idempotency_key', ignoreDuplicates: true }).select('id')
    : await query.insert(row).select('id');

  const data = response.data as Array<{ id: string }> | null;
  const error = response.error;

  if (error) {
    if (args.idempotencyKey && isMissingOnConflictConstraintError(error.message)) {
      const existingId = await getExistingBrainEventId(args.workspaceId, args.idempotencyKey).catch(() => null);

      if (existingId) {
        return existingId;
      }

      const fallbackInsert = await supabaseAdmin.from('brain_events').insert(row).select('id');
      const fallbackData = fallbackInsert.data as Array<{ id: string }> | null;

      if (fallbackInsert.error) {
        if (isDuplicateIdempotencyError(fallbackInsert.error.message)) {
          return getExistingBrainEventId(args.workspaceId, args.idempotencyKey);
        }

        throw new Error(`[RIDVAN-E814] Failed to insert brain event: ${fallbackInsert.error.message}`);
      }

      const fallbackId = fallbackData?.[0]?.id;

      if (fallbackId) {
        return fallbackId;
      }
    }

    throw new Error(`[RIDVAN-E814] Failed to insert brain event: ${error?.message ?? 'unknown error'}`);
  }

  const insertedId = data?.[0]?.id;

  if (insertedId) {
    return insertedId;
  }

  if (args.idempotencyKey) {
    return getExistingBrainEventId(args.workspaceId, args.idempotencyKey);
  }

  throw new Error('[RIDVAN-E818] Brain event insert returned no id');
}

export async function insertBrainEventsBatch(args: {
  workspaceId: string;
  projectId: string;
  userId: string;
  source: BrainEventSource;
  events: BrainEventInput[];
}) {
  if (args.events.length === 0) {
    return [] as string[];
  }

  const rows = args.events.map((event) => ({
    workspace_id: args.workspaceId,
    project_id: args.projectId,
    user_id: args.userId,
    source: (event.source ?? args.source) as BrainEventSource,
    type: event.type,
    idempotency_key: event.idempotencyKey ?? null,
    payload: event.payload,
  }));

  const rowsWithIdempotencyKey = rows.filter((row) => typeof row.idempotency_key === 'string' && row.idempotency_key.length > 0);
  const rowsWithoutIdempotencyKey = rows.filter((row) => !(typeof row.idempotency_key === 'string' && row.idempotency_key.length > 0));

  const insertedIds: string[] = [];

  if (rowsWithIdempotencyKey.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('brain_events')
      .upsert(rowsWithIdempotencyKey, { onConflict: 'workspace_id,idempotency_key', ignoreDuplicates: true })
      .select('id, idempotency_key')
      .returns<Array<{ id: string; idempotency_key: string | null }>>();

    if (error) {
      if (isMissingOnConflictConstraintError(error.message)) {
        for (const row of rowsWithIdempotencyKey) {
          const idempotencyKey = row.idempotency_key as string;
          const existingId = await getExistingBrainEventId(args.workspaceId, idempotencyKey).catch(() => null);

          if (existingId) {
            insertedIds.push(existingId);
            continue;
          }

          const fallbackInsert = await supabaseAdmin.from('brain_events').insert(row).select('id').returns<Array<{ id: string }>>();

          if (fallbackInsert.error) {
            if (isDuplicateIdempotencyError(fallbackInsert.error.message)) {
              insertedIds.push(await getExistingBrainEventId(args.workspaceId, idempotencyKey));
              continue;
            }

            throw new Error(`[RIDVAN-E815] Failed to insert brain events batch: ${fallbackInsert.error.message}`);
          }

          const fallbackId = fallbackInsert.data?.[0]?.id;

          if (!fallbackId) {
            throw new Error('[RIDVAN-E820] Brain event batch fallback insert returned no id');
          }

          insertedIds.push(fallbackId);
        }

        return insertedIds;
      }

      throw new Error(`[RIDVAN-E815] Failed to insert brain events batch: ${error.message}`);
    }

    insertedIds.push(...(data ?? []).map((row) => row.id));

    const insertedKeys = new Set((data ?? []).map((row) => row.idempotency_key).filter((key): key is string => Boolean(key)));
    const requestedKeys = rowsWithIdempotencyKey
      .map((row) => row.idempotency_key)
      .filter((key): key is string => typeof key === 'string' && key.length > 0);
    const missingKeys = rowsWithIdempotencyKey
      .map((row) => row.idempotency_key)
      .filter((key): key is string => typeof key === 'string' && key.length > 0 && requestedKeys.includes(key) && !insertedKeys.has(key));

    if (missingKeys.length > 0) {
      const { data: existingRows, error: existingError } = await supabaseAdmin
        .from('brain_events')
        .select('id, idempotency_key')
        .eq('workspace_id', args.workspaceId)
        .in('idempotency_key', missingKeys)
        .returns<Array<{ id: string; idempotency_key: string | null }>>();

      if (existingError) {
        throw new Error(`[RIDVAN-E819] Failed to load deduplicated brain events: ${existingError.message}`);
      }

      insertedIds.push(...(existingRows ?? []).map((row) => row.id));
    }
  }

  if (rowsWithoutIdempotencyKey.length > 0) {
    const { data, error } = await supabaseAdmin.from('brain_events').insert(rowsWithoutIdempotencyKey).select('id').returns<Array<{ id: string }>>();

    if (error) {
      throw new Error(`[RIDVAN-E815] Failed to insert brain events batch: ${error.message}`);
    }

    insertedIds.push(...(data ?? []).map((row) => row.id));
  }

  return insertedIds;
}
