import { appendDeepMemoryInWorkspace } from '~/lib/mentor/memory.server';
import { supabaseAdmin } from '~/lib/supabase/server';

type AssertionSource = 'user_stated' | 'system_inferred' | 'externally_researched';

interface BrainEventRow {
  id: string;
  workspace_id: string;
  project_id: string;
  user_id: string;
  source: 'builder' | 'mentor' | 'vertical' | 'system';
  type: string;
  payload: unknown;
  occurred_at: string;
}

interface BrainMemoryEntryRow {
  id: string;
  workspace_id: string;
  entity_key: string;
  revision: number;
  is_current: boolean;
}

interface BrainProjectStateRow {
  workspace_id: string;
  project_id: string;
  user_id: string;
  geo_profile_id: string | null;
  industry_profile_id: string | null;
  active_goal_entry_ids: string[] | null;
  active_priority_entry_ids: string[] | null;
  active_challenge_entry_ids: string[] | null;
  active_module_entry_ids: string[] | null;
  latest_milestone_entry_ids: string[] | null;
  recent_experiment_entry_ids: string[] | null;
  primary_goal_summary: string | null;
  top_priority_summary: string | null;
  main_challenge_summary: string | null;
}

interface BrainProjectSignalsRow {
  current_signals: unknown;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeAssertionSource(payload: Record<string, unknown>): AssertionSource {
  const raw = payload.assertion_source;
  if (raw === 'user_stated' || raw === 'system_inferred' || raw === 'externally_researched') {
    return raw;
  }
  return 'system_inferred';
}

function normalizeEventType(type: string) {
  return type.trim();
}

function coerceText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function makeSlug(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 60);
}

async function hasMemoryEntryForEvent(eventId: string) {
  const { data, error } = await supabaseAdmin
    .from('brain_memory_entries')
    .select('id')
    .eq('source_event_id', eventId)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (error) {
    throw new Error(`[RIDVAN-E909] Failed to check memory ingestion state: ${error.message}`);
  }

  return Boolean(data);
}

async function hasGeoProfileForEvent(eventId: string) {
  const { data, error } = await supabaseAdmin
    .from('brain_geo_profiles')
    .select('id')
    .eq('source_event_id', eventId)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (error) {
    throw new Error(`[RIDVAN-E910] Failed to check geo ingestion state: ${error.message}`);
  }

  return Boolean(data);
}

async function hasIndustryProfileForEvent(eventId: string) {
  const { data, error } = await supabaseAdmin
    .from('brain_industry_profiles')
    .select('id')
    .eq('source_event_id', eventId)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (error) {
    throw new Error(`[RIDVAN-E911] Failed to check industry ingestion state: ${error.message}`);
  }

  return Boolean(data);
}

async function loadCurrentEntity(args: { workspaceId: string; entityKey: string }) {
  const { data, error } = await supabaseAdmin
    .from('brain_memory_entries')
    .select('id, workspace_id, entity_key, revision, is_current')
    .eq('workspace_id', args.workspaceId)
    .eq('entity_key', args.entityKey)
    .eq('is_current', true)
    .maybeSingle<BrainMemoryEntryRow>();

  if (error) {
    throw new Error(`[RIDVAN-E901] Failed to load current entity: ${error.message}`);
  }

  return data ?? null;
}

async function insertMemoryRevision(args: {
  event: BrainEventRow;
  category: 'project' | 'business' | 'world' | 'experiment';
  kind: string;
  entityKey: string;
  title?: string | null;
  summary?: string | null;
  data: Record<string, unknown>;
  assertionSource: AssertionSource;
}) {
  const current = await loadCurrentEntity({ workspaceId: args.event.workspace_id, entityKey: args.entityKey });

  const insertRow = {
    workspace_id: args.event.workspace_id,
    category: args.category,
    kind: args.kind,
    entity_key: args.entityKey,
    revision: current ? current.revision + 1 : 1,
    supersedes_entry_id: current ? current.id : null,
    title: args.title ?? null,
    summary: args.summary ?? null,
    data: args.data,
    confidence: 0.7,
    source: args.event.source,
    source_event_id: args.event.id,
    source_ref: { event_id: args.event.id, occurred_at: args.event.occurred_at },
    assertion_source: args.assertionSource,
    confirmed_by_user: false,
    last_confirmed_at: null,
  };

  const { data, error } = await supabaseAdmin
    .from('brain_memory_entries')
    .insert(insertRow)
    .select('id')
    .single<{ id: string }>();

  if (error || !data) {
    throw new Error(`[RIDVAN-E902] Failed to insert memory entry: ${error?.message ?? 'unknown error'}`);
  }

  return { id: data.id, supersededId: current?.id ?? null };
}

async function loadProjectStateForWorkspace(workspaceId: string) {
  const { data, error } = await supabaseAdmin
    .from('brain_project_state')
    .select(
      'workspace_id, project_id, user_id, geo_profile_id, industry_profile_id, active_goal_entry_ids, active_priority_entry_ids, active_challenge_entry_ids, active_module_entry_ids, latest_milestone_entry_ids, recent_experiment_entry_ids, primary_goal_summary, top_priority_summary, main_challenge_summary',
    )
    .eq('workspace_id', workspaceId)
    .maybeSingle<BrainProjectStateRow>();

  if (error) {
    throw new Error(`[RIDVAN-E903] Failed to load brain_project_state: ${error.message}`);
  }

  if (!data) {
    throw new Error('[RIDVAN-E904] brain_project_state missing for workspace');
  }

  return data;
}

function replaceInList(list: string[], addId: string, removeId: string | null) {
  const filtered = removeId ? list.filter((id) => id !== removeId) : [...list];
  if (!filtered.includes(addId)) {
    filtered.unshift(addId);
  }
  return filtered;
}

async function loadCurrentSignals(workspaceId: string) {
  const { data, error } = await supabaseAdmin
    .from('brain_project_state')
    .select('current_signals')
    .eq('workspace_id', workspaceId)
    .maybeSingle<BrainProjectSignalsRow>();

  if (error) {
    throw new Error(`[RIDVAN-E915] Failed to load current_signals: ${error.message}`);
  }

  const obj = asObject(data?.current_signals);
  return obj;
}

function normalizeSignalPatchesPayload(payload: Record<string, unknown>) {
  const patches = payload.patches;
  if (!Array.isArray(patches)) {
    return [] as Array<{ key: string; payload: Record<string, unknown> }>;
  }

  return patches
    .map((p) => {
      if (!p || typeof p !== 'object') {
        return null;
      }

      const patchObj = p as Record<string, unknown>;
      const key = typeof patchObj.key === 'string' ? patchObj.key : null;
      const inner = patchObj.payload && typeof patchObj.payload === 'object' ? (patchObj.payload as Record<string, unknown>) : null;

      if (!key || !inner) {
        return null;
      }

      return { key, payload: inner };
    })
    .filter((x): x is { key: string; payload: Record<string, unknown> } => Boolean(x));
}

async function ingestSignalsUpdated(event: BrainEventRow) {
  const payload = asObject(event.payload);
  const patches = normalizeSignalPatchesPayload(payload);

  if (patches.length === 0) {
    return;
  }

  const current = await loadCurrentSignals(event.workspace_id);
  const next = { ...current } as Record<string, unknown>;

  for (const patch of patches) {
    next[patch.key] = patch.payload;
  }

  const { error } = await supabaseAdmin
    .from('brain_project_state')
    .update({ current_signals: next, current_signals_updated_at: new Date().toISOString() })
    .eq('workspace_id', event.workspace_id);

  if (error) {
    throw new Error(`[RIDVAN-E916] Failed to update current_signals: ${error.message}`);
  }
}

async function updateProjectState(args: {
  workspaceId: string;
  patch: Partial<{
    active_goal_entry_ids: string[];
    active_priority_entry_ids: string[];
    active_challenge_entry_ids: string[];
    active_module_entry_ids: string[];
    latest_milestone_entry_ids: string[];
    recent_experiment_entry_ids: string[];
    primary_goal_summary: string | null;
    top_priority_summary: string | null;
    main_challenge_summary: string | null;
    geo_profile_id: string | null;
    industry_profile_id: string | null;
  }>;
}) {
  const { error } = await supabaseAdmin.from('brain_project_state').update(args.patch).eq('workspace_id', args.workspaceId);

  if (error) {
    throw new Error(`[RIDVAN-E905] Failed to update brain_project_state: ${error.message}`);
  }
}

async function ingestBusinessGoalSet(event: BrainEventRow) {
  const payload = asObject(event.payload);
  const assertionSource = normalizeAssertionSource(payload);

  const entityKeyRaw = coerceText(payload.entity_key) ?? coerceText(payload.entityKey);
  const goalText =
    coerceText(payload.goal) ??
    coerceText(payload['mål']) ??
    coerceText(payload.target_outcome) ??
    coerceText(payload.targetOutcome) ??
    coerceText(payload.title) ??
    coerceText(payload.summary);
  const entityKey = entityKeyRaw ?? (goalText ? `goal:${makeSlug(goalText)}` : null);

  if (!entityKey) {
    return;
  }

  const title = coerceText(payload.title) ?? goalText;
  const summary = coerceText(payload.summary);

  const { id: entryId, supersededId } = await insertMemoryRevision({
    event,
    category: 'business',
    kind: 'goal',
    entityKey,
    title,
    summary,
    data: payload,
    assertionSource,
  });

  const state = await loadProjectStateForWorkspace(event.workspace_id);
  const nextGoals = replaceInList(state.active_goal_entry_ids ?? [], entryId, supersededId);

  await updateProjectState({
    workspaceId: event.workspace_id,
    patch: {
      active_goal_entry_ids: nextGoals,
      primary_goal_summary: title ?? summary ?? state.primary_goal_summary,
    },
  });
}

async function ingestBusinessPriorityUpdated(event: BrainEventRow) {
  const payload = asObject(event.payload);
  const assertionSource = normalizeAssertionSource(payload);

  const entityKeyRaw = coerceText(payload.entity_key) ?? coerceText(payload.entityKey);
  const text = coerceText(payload.priority) ?? coerceText(payload.title) ?? coerceText(payload.summary);
  const entityKey = entityKeyRaw ?? (text ? `priority:${makeSlug(text)}` : null);

  if (!entityKey) {
    return;
  }

  const title = coerceText(payload.title) ?? text;
  const summary = coerceText(payload.summary);

  const { id: entryId, supersededId } = await insertMemoryRevision({
    event,
    category: 'business',
    kind: 'priority',
    entityKey,
    title,
    summary,
    data: payload,
    assertionSource,
  });

  const state = await loadProjectStateForWorkspace(event.workspace_id);
  const next = replaceInList(state.active_priority_entry_ids ?? [], entryId, supersededId);

  await updateProjectState({
    workspaceId: event.workspace_id,
    patch: {
      active_priority_entry_ids: next,
      top_priority_summary: title ?? summary ?? state.top_priority_summary,
    },
  });
}

async function ingestBusinessChallengeLogged(event: BrainEventRow) {
  const payload = asObject(event.payload);
  const assertionSource = normalizeAssertionSource(payload);

  const entityKeyRaw = coerceText(payload.entity_key) ?? coerceText(payload.entityKey);
  const text = coerceText(payload.challenge) ?? coerceText(payload.title) ?? coerceText(payload.summary);
  const entityKey = entityKeyRaw ?? (text ? `challenge:${makeSlug(text)}` : null);

  if (!entityKey) {
    return;
  }

  const title = coerceText(payload.title) ?? text;
  const summary = coerceText(payload.summary);

  const { id: entryId, supersededId } = await insertMemoryRevision({
    event,
    category: 'business',
    kind: 'challenge',
    entityKey,
    title,
    summary,
    data: payload,
    assertionSource,
  });

  const state = await loadProjectStateForWorkspace(event.workspace_id);
  const next = replaceInList(state.active_challenge_entry_ids ?? [], entryId, supersededId);

  await updateProjectState({
    workspaceId: event.workspace_id,
    patch: {
      active_challenge_entry_ids: next,
      main_challenge_summary: title ?? summary ?? state.main_challenge_summary,
    },
  });
}

async function ingestWorldGeoSet(event: BrainEventRow) {
  const payload = asObject(event.payload);

  const countryCodeRaw = coerceText(payload.country_code);

  if (!countryCodeRaw) {
    return;
  }

  const countryCode = countryCodeRaw.toUpperCase();

  const countryName = coerceText(payload.country_name);
  const city = coerceText(payload.city);
  const languageCodes = Array.isArray(payload.language_codes) ? (payload.language_codes.filter((x) => typeof x === 'string') as string[]) : [];
  const currencyCode = coerceText(payload.currency_code);
  const taxModel = coerceText(payload.tax_model) ?? 'unknown';
  const paymentPreferences = asObject(payload.payment_preferences);
  const legalFlags = Array.isArray(payload.legal_flags) ? (payload.legal_flags.filter((x) => typeof x === 'string') as string[]) : [];
  const communicationNorms = asObject(payload.communication_norms);
  const confidence = typeof payload.confidence === 'number' ? payload.confidence : 0.7;

  const { error: clearError } = await supabaseAdmin
    .from('brain_geo_profiles')
    .update({ is_current: false })
    .eq('workspace_id', event.workspace_id)
    .eq('is_current', true);

  if (clearError) {
    throw new Error(`[RIDVAN-E914] Failed to clear previous geo profile: ${clearError.message}`);
  }

  const { data, error } = await supabaseAdmin
    .from('brain_geo_profiles')
    .insert({
      workspace_id: event.workspace_id,
      country_code: countryCode,
      country_name: countryName,
      city,
      language_codes: languageCodes,
      currency_code: currencyCode,
      tax_model: taxModel,
      payment_preferences: paymentPreferences,
      legal_flags: legalFlags,
      communication_norms: communicationNorms,
      confidence,
      source: event.source,
      source_event_id: event.id,
      is_current: true,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) {
    throw new Error(`[RIDVAN-E906] Failed to insert geo profile: ${error?.message ?? 'unknown error'}`);
  }

  await updateProjectState({
    workspaceId: event.workspace_id,
    patch: { geo_profile_id: data.id },
  });
}

async function ingestWorldIndustrySet(event: BrainEventRow) {
  const payload = asObject(event.payload);

  const rawInput = coerceText(payload.raw_input) ?? coerceText(payload.rawInput);
  const normalized = coerceText(payload.normalized_industry) ?? coerceText(payload.normalizedIndustry);

  if (!rawInput || !normalized) {
    return;
  }

  const sub = coerceText(payload.sub_industry) ?? coerceText(payload.subIndustry);
  const confidence = typeof payload.confidence === 'number' ? payload.confidence : 0.7;

  await supabaseAdmin
    .from('brain_industry_profiles')
    .update({ is_current: false })
    .eq('workspace_id', event.workspace_id)
    .eq('is_current', true);

  const { data, error } = await supabaseAdmin
    .from('brain_industry_profiles')
    .insert({
      workspace_id: event.workspace_id,
      raw_input: rawInput,
      normalized_industry: normalized,
      sub_industry: sub,
      confidence,
      source: event.source,
      source_event_id: event.id,
      is_current: true,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) {
    throw new Error(`[RIDVAN-E907] Failed to insert industry profile: ${error?.message ?? 'unknown error'}`);
  }

  await updateProjectState({
    workspaceId: event.workspace_id,
    patch: { industry_profile_id: data.id },
  });
}

async function ingestMentorDeepMemoryEvent(event: BrainEventRow) {
  const type = normalizeEventType(event.type);
  const p = asObject(event.payload);
  const t = event.occurred_at;

  if (type === 'mentor.memory.decision') {
    const decision = coerceText(p.decision);
    const reason = coerceText(p.reason);
    if (!decision || !reason) {
      return;
    }
    await appendDeepMemoryInWorkspace(event.workspace_id, t, {
      kind: 'decision',
      decision,
      reason,
      outcome: coerceText(p.outcome) ?? undefined,
    });
    return;
  }

  if (type === 'mentor.memory.pivot') {
    const from = coerceText(p.from);
    const to = coerceText(p.to);
    const reason = coerceText(p.reason);
    if (!from || !to || !reason) {
      return;
    }
    await appendDeepMemoryInWorkspace(event.workspace_id, t, {
      kind: 'pivot',
      from,
      to,
      reason,
    });
    return;
  }

  if (type === 'mentor.memory.goal') {
    const goal = coerceText(p.goal);
    const status = coerceText(p.status);
    if (!goal || !status) {
      return;
    }
    await appendDeepMemoryInWorkspace(event.workspace_id, t, {
      kind: 'goal',
      goal,
      status,
      progress: coerceText(p.progress) ?? undefined,
    });
    return;
  }

  if (type === 'mentor.memory.learning') {
    const learning = coerceText(p.learning);
    const source = coerceText(p.source);
    if (!learning || !source) {
      return;
    }
    await appendDeepMemoryInWorkspace(event.workspace_id, t, {
      kind: 'learning',
      learning,
      source,
    });
  }
}

async function ingestMentorMilestoneLogged(event: BrainEventRow) {
  const payload = asObject(event.payload);
  const assertionSource = normalizeAssertionSource(payload);

  const entityKey = coerceText(payload.entity_key) ?? coerceText(payload.entityKey) ?? (coerceText(payload.milestone_key) ? `milestone:${makeSlug(String(payload.milestone_key))}` : null);
  if (!entityKey) {
    return;
  }

  const title = coerceText(payload.title) ?? coerceText(payload.milestone_title) ?? 'Milstolpe';
  const summary = coerceText(payload.message) ?? coerceText(payload.summary);

  const { id: entryId, supersededId } = await insertMemoryRevision({
    event,
    category: 'business',
    kind: 'milestone',
    entityKey,
    title,
    summary,
    data: payload,
    assertionSource,
  });

  const state = await loadProjectStateForWorkspace(event.workspace_id);
  const next = replaceInList(state.latest_milestone_entry_ids ?? [], entryId, supersededId);

  await updateProjectState({
    workspaceId: event.workspace_id,
    patch: {
      latest_milestone_entry_ids: next,
    },
  });
}

export async function ingestBrainEvent(event: BrainEventRow) {
  const type = normalizeEventType(event.type);

  if (type === 'signals.updated') {
    return ingestSignalsUpdated(event);
  }

  if (type === 'business.goal_set' || type === 'business.goalSet' || type.startsWith('business.goal_')) {
      if (await hasMemoryEntryForEvent(event.id)) {
        return;
      }
      return ingestBusinessGoalSet(event);
  }

  if (type === 'business.priority_updated' || type === 'business.priorityUpdated' || type.startsWith('business.priority_')) {
      if (await hasMemoryEntryForEvent(event.id)) {
        return;
      }
      return ingestBusinessPriorityUpdated(event);
  }

  if (type === 'business.challenge_logged' || type === 'business.challengeLogged' || type.startsWith('business.challenge_')) {
      if (await hasMemoryEntryForEvent(event.id)) {
        return;
      }
      return ingestBusinessChallengeLogged(event);
  }

  if (type === 'world.geo_set' || type === 'world.geoSet' || type.startsWith('world.geo_')) {
      if (await hasGeoProfileForEvent(event.id)) {
        return;
      }
      return ingestWorldGeoSet(event);
  }

  if (type === 'world.industry_set' || type === 'world.industrySet' || type.startsWith('world.industry_')) {
      if (await hasIndustryProfileForEvent(event.id)) {
        return;
      }
      return ingestWorldIndustrySet(event);
  }

  if (type === 'mentor.milestone_logged' || type.startsWith('mentor.milestone_')) {
      if (await hasMemoryEntryForEvent(event.id)) {
        return;
      }
      return ingestMentorMilestoneLogged(event);
  }

  if (
    type === 'mentor.memory.decision' ||
    type === 'mentor.memory.pivot' ||
    type === 'mentor.memory.goal' ||
    type === 'mentor.memory.learning'
  ) {
    return ingestMentorDeepMemoryEvent(event);
  }

  return;
}

export async function ingestBrainEventsById(eventIds: string[]) {
  if (eventIds.length === 0) {
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('brain_events')
    .select('id, workspace_id, project_id, user_id, source, type, payload, occurred_at')
    .in('id', eventIds)
    .returns<BrainEventRow[]>();

  if (error) {
    throw new Error(`[RIDVAN-E908] Failed to load brain events: ${error.message}`);
  }

  const events = (data ?? []).slice().sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : 1));

  for (const event of events) {
    try {
      await ingestBrainEvent(event);
    } catch (error) {
      console.error('[RIDVAN-E912] Failed to ingest event', { eventId: event.id, type: event.type, error });
    }
  }
}

export async function ingestLatestBrainEventsForProject(args: { projectId: string; userId: string; limit?: number }) {
  const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(100, args.limit) : 25;

  const { data, error } = await supabaseAdmin
    .from('brain_events')
    .select('id, workspace_id, project_id, user_id, source, type, payload, occurred_at')
    .eq('project_id', args.projectId)
    .eq('user_id', args.userId)
    .order('occurred_at', { ascending: false })
    .limit(limit)
    .returns<BrainEventRow[]>();

  if (error) {
    throw new Error(`[RIDVAN-E913] Failed to load latest brain events: ${error.message}`);
  }

  const ids = (data ?? []).map((e) => e.id);
  await ingestBrainEventsById(ids);
  return ids.length;
}
