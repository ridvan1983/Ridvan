export type BrainAssertionSource = 'user_stated' | 'system_inferred' | 'externally_researched';
export type BrainEventSource = 'builder' | 'mentor' | 'vertical' | 'system';

export interface BrainEventInput {
  type: string;
  source?: BrainEventSource;
  idempotencyKey?: string | null;
  payload: Record<string, unknown>;
}

export interface BrainProjectState {
  workspaceId: string;
  projectId: string;
  userId: string;

  industryProfileId: string | null;
  geoProfileId: string | null;

  activeGoalEntryIds: string[];
  activePriorityEntryIds: string[];
  activeChallengeEntryIds: string[];
  activeModuleEntryIds: string[];

  latestMilestoneEntryIds: string[];
  recentExperimentEntryIds: string[];

  currentSignals: Record<string, unknown>;
  currentSignalsUpdatedAt: string | null;

  publishedStatus: 'not_published' | 'published' | 'unknown';
  latestPublishAt: string | null;
  latestSnapshotVersion: number | null;
  latestSnapshotAt: string | null;

  currentStage: string | null;
  currentBusinessModel: string | null;
  primaryGoalSummary: string | null;
  topPrioritySummary: string | null;
  mainChallengeSummary: string | null;

  stateVersion: number;
  updatedAt: string;
}

export interface BrainIndustryProfile {
  id: string;
  rawInput: string;
  normalizedIndustry: string;
  subIndustry: string | null;
  confidence: number;
}

export interface BrainGeoProfile {
  id: string;
  countryCode: string;
  countryName: string | null;
  city: string | null;
  languageCodes: string[];
  currencyCode: string | null;
  taxModel: string;
  paymentPreferences: Record<string, unknown>;
  legalFlags: string[];
  communicationNorms: Record<string, unknown>;
  confidence: number;
}

export interface BrainMemoryEntry {
  id: string;
  category: 'project' | 'business' | 'world' | 'experiment';
  kind: string;
  entityKey: string;
  revision: number;
  rootEntryId: string | null;
  supersedesEntryId: string | null;
  isCurrent: boolean;
  status: 'active' | 'archived' | 'superseded' | 'invalidated';
  title: string | null;
  summary: string | null;
  data: Record<string, unknown>;
  confidence: number;
  assertionSource: BrainAssertionSource;
  confirmedByUser: boolean;
  lastConfirmedAt: string | null;
  assertedAt: string;
  createdAt: string;
  updatedAt: string;
}
