import { supabaseAdmin } from '~/lib/supabase/server';
import type { BrainGeoProfile, BrainIndustryProfile, BrainMemoryEntry, BrainProjectState } from './types';

interface BrainProjectStateRow {
  workspace_id: string;
  project_id: string;
  user_id: string;
  industry_profile_id: string | null;
  geo_profile_id: string | null;
  active_goal_entry_ids: string[] | null;
  active_priority_entry_ids: string[] | null;
  active_challenge_entry_ids: string[] | null;
  active_module_entry_ids: string[] | null;
  latest_milestone_entry_ids: string[] | null;
  recent_experiment_entry_ids: string[] | null;
  current_signals: unknown;
  current_signals_updated_at: string | null;
  published_status: 'not_published' | 'published' | 'unknown';
  latest_publish_at: string | null;
  latest_snapshot_version: number | null;
  latest_snapshot_at: string | null;
  current_stage: string | null;
  current_business_model: string | null;
  primary_goal_summary: string | null;
  top_priority_summary: string | null;
  main_challenge_summary: string | null;
  state_version: number;
  updated_at: string;
}

interface BrainIndustryProfileRow {
  id: string;
  raw_input: string;
  normalized_industry: string;
  sub_industry: string | null;
  confidence: number;
}

interface BrainGeoProfileRow {
  id: string;
  country_code: string;
  country_name: string | null;
  city: string | null;
  language_codes: string[] | null;
  currency_code: string | null;
  tax_model: string;
  payment_preferences: unknown;
  legal_flags: string[] | null;
  communication_norms: unknown;
  confidence: number;
}

interface BrainMemoryEntryRow {
  id: string;
  category: 'project' | 'business' | 'world' | 'experiment';
  kind: string;
  entity_key: string;
  revision: number;
  root_entry_id: string | null;
  supersedes_entry_id: string | null;
  is_current: boolean;
  status: 'active' | 'archived' | 'superseded' | 'invalidated';
  title: string | null;
  summary: string | null;
  data: unknown;
  confidence: number;
  assertion_source: 'user_stated' | 'system_inferred' | 'externally_researched';
  confirmed_by_user: boolean;
  last_confirmed_at: string | null;
  asserted_at: string;
  created_at: string;
  updated_at: string;
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export async function readBrainContext(args: { projectId: string; userId: string }) {
  const { data: stateRow, error: stateError } = await supabaseAdmin
    .from('brain_project_state')
    .select(
      [
        'workspace_id',
        'project_id',
        'user_id',
        'industry_profile_id',
        'geo_profile_id',
        'active_goal_entry_ids',
        'active_priority_entry_ids',
        'active_challenge_entry_ids',
        'active_module_entry_ids',
        'latest_milestone_entry_ids',
        'recent_experiment_entry_ids',
        'current_signals',
        'current_signals_updated_at',
        'published_status',
        'latest_publish_at',
        'latest_snapshot_version',
        'latest_snapshot_at',
        'current_stage',
        'current_business_model',
        'primary_goal_summary',
        'top_priority_summary',
        'main_challenge_summary',
        'state_version',
        'updated_at',
      ].join(', '),
    )
    .eq('project_id', args.projectId)
    .eq('user_id', args.userId)
    .maybeSingle<BrainProjectStateRow>();

  if (stateError) {
    throw new Error(`[RIDVAN-E821] Failed to load brain_project_state: ${stateError.message}`);
  }

  if (!stateRow) {
    return null;
  }

  const state: BrainProjectState = {
    workspaceId: stateRow.workspace_id,
    projectId: stateRow.project_id,
    userId: stateRow.user_id,
    industryProfileId: stateRow.industry_profile_id,
    geoProfileId: stateRow.geo_profile_id,
    activeGoalEntryIds: stateRow.active_goal_entry_ids ?? [],
    activePriorityEntryIds: stateRow.active_priority_entry_ids ?? [],
    activeChallengeEntryIds: stateRow.active_challenge_entry_ids ?? [],
    activeModuleEntryIds: stateRow.active_module_entry_ids ?? [],
    latestMilestoneEntryIds: stateRow.latest_milestone_entry_ids ?? [],
    recentExperimentEntryIds: stateRow.recent_experiment_entry_ids ?? [],
    currentSignals: normalizeJsonObject(stateRow.current_signals),
    currentSignalsUpdatedAt: stateRow.current_signals_updated_at,
    publishedStatus: stateRow.published_status,
    latestPublishAt: stateRow.latest_publish_at,
    latestSnapshotVersion: stateRow.latest_snapshot_version,
    latestSnapshotAt: stateRow.latest_snapshot_at,
    currentStage: stateRow.current_stage,
    currentBusinessModel: stateRow.current_business_model,
    primaryGoalSummary: stateRow.primary_goal_summary,
    topPrioritySummary: stateRow.top_priority_summary,
    mainChallengeSummary: stateRow.main_challenge_summary,
    stateVersion: stateRow.state_version,
    updatedAt: stateRow.updated_at,
  };

  const [industryProfile, geoProfile] = await Promise.all([
    state.industryProfileId
      ? supabaseAdmin
          .from('brain_industry_profiles')
          .select('id, raw_input, normalized_industry, sub_industry, confidence')
          .eq('id', state.industryProfileId)
          .maybeSingle<BrainIndustryProfileRow>()
          .then(({ data, error }) => {
            if (error) {
              throw new Error(`[RIDVAN-E822] Failed to load industry profile: ${error.message}`);
            }
            if (!data) {
              return null;
            }
            const profile: BrainIndustryProfile = {
              id: data.id,
              rawInput: data.raw_input,
              normalizedIndustry: data.normalized_industry,
              subIndustry: data.sub_industry,
              confidence: data.confidence,
            };
            return profile;
          })
      : Promise.resolve(null),
    state.geoProfileId
      ? supabaseAdmin
          .from('brain_geo_profiles')
          .select(
            'id, country_code, country_name, city, language_codes, currency_code, tax_model, payment_preferences, legal_flags, communication_norms, confidence',
          )
          .eq('id', state.geoProfileId)
          .maybeSingle<BrainGeoProfileRow>()
          .then(({ data, error }) => {
            if (error) {
              throw new Error(`[RIDVAN-E823] Failed to load geo profile: ${error.message}`);
            }
            if (!data) {
              return null;
            }
            const profile: BrainGeoProfile = {
              id: data.id,
              countryCode: data.country_code,
              countryName: data.country_name,
              city: data.city,
              languageCodes: data.language_codes ?? [],
              currencyCode: data.currency_code,
              taxModel: data.tax_model,
              paymentPreferences: normalizeJsonObject(data.payment_preferences),
              legalFlags: data.legal_flags ?? [],
              communicationNorms: normalizeJsonObject(data.communication_norms),
              confidence: data.confidence,
            };
            return profile;
          })
      : Promise.resolve(null),
  ]);

  const activeEntryIds = Array.from(
    new Set([
      ...state.activeGoalEntryIds,
      ...state.activePriorityEntryIds,
      ...state.activeChallengeEntryIds,
      ...state.activeModuleEntryIds,
    ]),
  );

  let activeEntries: BrainMemoryEntry[] = [];

  if (activeEntryIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('brain_memory_entries')
      .select(
        'id, category, kind, entity_key, revision, root_entry_id, supersedes_entry_id, is_current, status, title, summary, data, confidence, assertion_source, confirmed_by_user, last_confirmed_at, asserted_at, created_at, updated_at',
      )
      .in('id', activeEntryIds)
      .returns<BrainMemoryEntryRow[]>();

    if (error) {
      throw new Error(`[RIDVAN-E824] Failed to load active memory entries: ${error.message}`);
    }

    activeEntries = (data ?? []).map((row) => ({
      id: row.id,
      category: row.category,
      kind: row.kind,
      entityKey: row.entity_key,
      revision: row.revision,
      rootEntryId: row.root_entry_id,
      supersedesEntryId: row.supersedes_entry_id,
      isCurrent: row.is_current,
      status: row.status,
      title: row.title,
      summary: row.summary,
      data: normalizeJsonObject(row.data),
      confidence: row.confidence,
      assertionSource: row.assertion_source,
      confirmedByUser: row.confirmed_by_user,
      lastConfirmedAt: row.last_confirmed_at,
      assertedAt: row.asserted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  return {
    state,
    industryProfile,
    geoProfile,
    activeEntries,
  };
}
