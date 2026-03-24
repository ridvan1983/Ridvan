import { supabaseAdmin } from '~/lib/supabase/server';
import type { BrainEventInput, BrainEventSource } from './types';

interface BrainWorkspaceRow {
  id: string;
  project_id: string;
  user_id: string;
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
  const { data, error } = await supabaseAdmin
    .from('brain_events')
    .insert({
      workspace_id: args.workspaceId,
      project_id: args.projectId,
      user_id: args.userId,
      source: args.source ?? ('system' as BrainEventSource),
      type: args.type,
      idempotency_key: args.idempotencyKey ?? null,
      payload: args.payload,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) {
    throw new Error(`[RIDVAN-E814] Failed to insert brain event: ${error?.message ?? 'unknown error'}`);
  }

  return data.id;
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

  const { data, error } = await supabaseAdmin.from('brain_events').insert(rows).select('id').returns<Array<{ id: string }>>();

  if (error) {
    throw new Error(`[RIDVAN-E815] Failed to insert brain events batch: ${error.message}`);
  }

  return (data ?? []).map((row) => row.id);
}
