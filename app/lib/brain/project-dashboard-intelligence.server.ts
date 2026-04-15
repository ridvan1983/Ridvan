import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getAPIKey } from '~/lib/.server/llm/api-key';
import type { BrainProjectState } from '~/lib/brain/types';
import { readBrainContext } from '~/lib/brain/read.server';
import { supabaseAdmin } from '~/lib/supabase/server';
import { getVerticalContext } from '~/lib/vertical/context.server';
import type {
  DashboardCacheBlob,
  HealthTrend,
  ProjectIntelligenceDashboardPayload,
  RiskSeverity,
} from '~/lib/project-intelligence/dashboard-types';
import { RIDVAN_DASHBOARD_INTELLIGENCE_KEY } from '~/lib/project-intelligence/dashboard-types';

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function fingerprintBrainContext(state: BrainProjectState): string {
  return [
    state.primaryGoalSummary ?? '',
    state.topPrioritySummary ?? '',
    state.mainChallengeSummary ?? '',
    state.publishedStatus,
    String(state.latestSnapshotVersion ?? ''),
    state.latestMilestoneEntryIds.join(','),
    state.currentBusinessModel ?? '',
    state.currentStage ?? '',
    state.industryProfileId ?? '',
    state.geoProfileId ?? '',
  ].join('|');
}

function extractJsonObject(raw: string) {
  const trimmed = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('[RIDVAN-E2101] Dashboard JSON parse failed');
  }
  return trimmed.slice(start, end + 1);
}

function normalizeSeverity(value: unknown): RiskSeverity {
  const s = String(value ?? '').toLowerCase();
  if (s === 'high' || s === 'hög' || s === 'hog') {
    return 'high';
  }
  if (s === 'low' || s === 'låg' || s === 'lag') {
    return 'low';
  }
  return 'medium';
}

function normalizeIndicator(value: unknown): ProjectIntelligenceDashboardPayload['marketPosition']['indicator'] {
  const s = String(value ?? '').toLowerCase();
  if (s === 'strong' || s === 'stark') {
    return 'strong';
  }
  if (s === 'weak' || s === 'svag') {
    return 'weak';
  }
  return 'balanced';
}

function normalizeDashboard(raw: unknown, previousHealth: number | null): ProjectIntelligenceDashboardPayload {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const score = clamp(Math.round(Number(o.healthScore) || 55), 0, 100);
  let trend: HealthTrend = 'flat';
  if (previousHealth != null) {
    if (score > previousHealth + 2) {
      trend = 'up';
    } else if (score < previousHealth - 2) {
      trend = 'down';
    }
  }

  const driversRaw = Array.isArray(o.revenueDrivers) ? o.revenueDrivers : [];
  const revenueDrivers = driversRaw
    .slice(0, 5)
    .map((item) => {
      const row = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
      const title = String(row.title ?? row.driver ?? '').trim() || 'Intäktsfaktor';
      const detail = String(row.detail ?? row.description ?? row.why ?? '').trim() || '';
      const mentorPrompt =
        String(row.mentorPrompt ?? '').trim() ||
        `Jag vill diskutera intäktsdrivaren "${title}" för mitt projekt. ${detail}`.slice(0, 800);
      return { title, detail, mentorPrompt };
    })
    .slice(0, 3);

  const risksRaw = Array.isArray(o.risks) ? o.risks : [];
  const risks = risksRaw
    .slice(0, 5)
    .map((item) => {
      const row = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
      const title = String(row.title ?? row.pattern ?? '').trim() || 'Risk';
      const severity = normalizeSeverity(row.severity ?? row.level);
      const action = String(row.action ?? row.fast_fix ?? row.fastFix ?? '').trim() || 'Prioritera och agera tidigt.';
      return { title, severity, action };
    })
    .slice(0, 3);

  const nba = o.nextBestAction && typeof o.nextBestAction === 'object' && !Array.isArray(o.nextBestAction)
    ? (o.nextBestAction as Record<string, unknown>)
    : {};
  const nextBestAction = {
    title: String(nba.title ?? 'Nästa steg').trim(),
    detail: String(nba.detail ?? nba.description ?? '').trim(),
    mentorPrompt:
      String(nba.mentorPrompt ?? '').trim() ||
      `${String(nba.title ?? 'Nästa steg')}. ${String(nba.detail ?? '')}`.slice(0, 800),
  };

  const mp = o.marketPosition && typeof o.marketPosition === 'object' && !Array.isArray(o.marketPosition)
    ? (o.marketPosition as Record<string, unknown>)
    : {};
  const marketPosition = {
    summary: String(mp.summary ?? mp.text ?? '').trim() || 'Positionering byggs när mer affärsdata finns.',
    indicator: normalizeIndicator(mp.indicator ?? mp.strength),
  };

  const ms = o.milestones && typeof o.milestones === 'object' && !Array.isArray(o.milestones)
    ? (o.milestones as Record<string, unknown>)
    : {};
  const milestones = {
    achievedLabel: String(ms.achievedLabel ?? ms.achieved ?? 'Grundläggande projektstart').trim(),
    nextLabel: String(ms.nextLabel ?? ms.next ?? 'Publicera och validera mot kunder').trim(),
    progressPct: clamp(Math.round(Number(ms.progressPct ?? ms.progress) || 35), 0, 100),
  };

  return {
    healthScore: score,
    healthTrend: trend,
    revenueDrivers: revenueDrivers.length > 0 ? revenueDrivers : fallbackDrivers(),
    risks: risks.length > 0 ? risks : fallbackRisks(),
    nextBestAction:
      nextBestAction.title && nextBestAction.detail
        ? nextBestAction
        : {
            title: 'Fokusera på första värdeskapande steget',
            detail: 'Säkerställ att erbjudandet och målgruppen är tydlig innan ni skalar.',
            mentorPrompt:
              'Hjälp mig prioritera nästa affärssteg: tydliggör erbjudande och målgrupp innan vi skalar upp.',
          },
    marketPosition,
    milestones,
    generatedAt: new Date().toISOString(),
  };
}

function fallbackDrivers(): ProjectIntelligenceDashboardPayload['revenueDrivers'] {
  return [
    {
      title: 'Tydligt värdeerbjudande',
      detail: 'Se till att besökare förstår vad ni löser och för vem.',
      mentorPrompt: 'Hur kan jag skärpa vårt värdeerbjudande och budskap på landningssidan?',
    },
    {
      title: 'Konverteringsflöde',
      detail: 'Mät bokning/köp/signup från första sidan.',
      mentorPrompt: 'Vilket är det viktigaste steget för att öka konvertering i vårt flöde just nu?',
    },
    {
      title: 'Återkommande intäkt',
      detail: 'Utforska prenumeration, tilläggstjänster eller upsell.',
      mentorPrompt: 'Hur kan vi bygga mer återkommande intäkter utifrån vår nuvarande produkt?',
    },
  ];
}

function fallbackRisks(): ProjectIntelligenceDashboardPayload['risks'] {
  return [
    {
      title: 'Otydlig prioritering',
      severity: 'medium',
      action: 'Välj ett huvudfokus för sprinten och säg nej till resten.',
    },
    {
      title: 'Ingen validerad efterfrågan',
      severity: 'high',
      action: 'Boka 5 kundsamtal eller tester innan ni bygger mer.',
    },
    {
      title: 'Teknisk skuld',
      severity: 'low',
      action: 'Sätt av en halv dag för refaktorering av kritiska delar.',
    },
  ];
}

function buildHeuristicDashboard(
  state: BrainProjectState,
  verticalSnippet: { drivers: string[]; risks: string[] },
  previousHealth: number | null,
): ProjectIntelligenceDashboardPayload {
  let score = 48;
  if (state.publishedStatus === 'published') {
    score += 18;
  }
  if (state.primaryGoalSummary?.trim()) {
    score += 8;
  }
  if (state.topPrioritySummary?.trim()) {
    score += 6;
  }
  if (state.mainChallengeSummary?.trim()) {
    score += 4;
  }
  if (state.latestSnapshotVersion != null && state.latestSnapshotVersion > 0) {
    score += 8;
  }
  if (state.latestMilestoneEntryIds.length > 0) {
    score += 6;
  }
  score = clamp(score, 22, 94);

  const drivers = (verticalSnippet.drivers.length > 0 ? verticalSnippet.drivers : fallbackDrivers().map((d) => d.title)).slice(
    0,
    3,
  );
  const revenueDrivers = drivers.map((title, i) => ({
    title,
    detail: verticalSnippet.drivers[i] ?? `Prioriterad intäktsfaktor för er vertikal.`,
    mentorPrompt: `Jag vill gå djupare på intäktsdrivaren "${title}" i mitt projekt. Vad bör jag göra först?`,
  }));

  const riskTitles = (verticalSnippet.risks.length > 0 ? verticalSnippet.risks : ['Konkurrens', 'Kassaflöde', 'Scope creep']).slice(
    0,
    3,
  );
  const severities: RiskSeverity[] = ['high', 'medium', 'low'];
  const risks = riskTitles.map((title, i) => ({
    title,
    severity: severities[i] ?? 'medium',
    action:
      i === 0
        ? 'Gör en snabb konkurrentjämförelse på pris och erbjudande.'
        : i === 1
          ? 'Säkerställ 8–12 veckors runway eller intäktsplan.'
          : 'Frys nya features tills kärnflödet är stabilt.',
  }));

  const milestoneCount = state.latestMilestoneEntryIds.length;
  const progressPct = clamp(25 + milestoneCount * 12 + (state.publishedStatus === 'published' ? 25 : 0), 5, 95);

  const raw = {
    healthScore: score,
    revenueDrivers,
    risks,
    nextBestAction: {
      title: state.topPrioritySummary?.trim() ? 'Prioritera er toppåtgärd' : 'Definiera nästa viktigaste steg',
      detail:
        state.topPrioritySummary?.trim() ||
        state.mainChallengeSummary?.trim() ||
        'Sätt ett tydligt mål för veckan och mät ett nyckeltal.',
      mentorPrompt: state.mainChallengeSummary?.trim()
        ? `Min största utmaning just nu: ${state.mainChallengeSummary.trim()}. Hur ska jag tackla den?`
        : 'Hjälp mig välja ett enda fokus för denna vecka som maximerar framsteg.',
    },
    marketPosition: {
      summary:
        state.publishedStatus === 'published'
          ? 'Ni är live — positionering handlar nu om att förstärja budskap gentemot tydlig målgrupp.'
          : 'Förhandsläge: positionera er mot en tydlig nisch innan bred lansering.',
      indicator: state.publishedStatus === 'published' ? 'balanced' : 'weak',
    },
    milestones: {
      achievedLabel: milestoneCount > 0 ? `${milestoneCount} milstolpe(r) registrerad(e) i Brain` : 'Grund och repo på plats',
      nextLabel: state.publishedStatus === 'published' ? 'Optimera konvertering och retention' : 'Publicera första versionen',
      progressPct,
    },
  };

  return normalizeDashboard(raw, previousHealth);
}

async function generateDashboardWithLlm(args: {
  env: Env;
  state: BrainProjectState;
  verticalText: string;
  previousHealth: number | null;
}): Promise<ProjectIntelligenceDashboardPayload | null> {
  const apiKey = getAPIKey(args.env) ?? '';
  if (!apiKey) {
    return null;
  }

  const anthropic = createAnthropic({ apiKey });
  const prompt = `Du är affärsstrateg. Svara med ENDAST giltig JSON (inga markdown fences) på svenska.
Projekt brain-sammanfattning:
- stage: ${args.state.currentStage ?? 'okänd'}
- affärsmodell: ${args.state.currentBusinessModel ?? 'okänd'}
- mål: ${args.state.primaryGoalSummary ?? 'saknas'}
- prioritet: ${args.state.topPrioritySummary ?? 'saknas'}
- utmaning: ${args.state.mainChallengeSummary ?? 'saknas'}
- publicerad: ${args.state.publishedStatus}
- snapshot version: ${args.state.latestSnapshotVersion ?? 0}
- antal milstolpar (ids): ${args.state.latestMilestoneEntryIds.length}

Vertikal/kontext:
${args.verticalText}

JSON-form:
{
  "healthScore": number 0-100,
  "revenueDrivers": [{ "title": string, "detail": string, "mentorPrompt": string }],
  "risks": [{ "title": string, "severity": "high"|"medium"|"low", "action": string }],
  "nextBestAction": { "title": string, "detail": string, "mentorPrompt": string },
  "marketPosition": { "summary": string, "indicator": "strong"|"balanced"|"weak" },
  "milestones": { "achievedLabel": string, "nextLabel": string, "progressPct": number 0-100 }
}
Exakt 3 revenueDrivers och 3 risks. mentorPrompt ska vara en kort användarfråga till en AI-mentor.`;

  try {
    const result = await generateText({
      model: anthropic('claude-sonnet-4-5-20250929'),
      temperature: 0.2,
      maxTokens: 1800,
      prompt,
    });
    const parsed = JSON.parse(extractJsonObject(result.text)) as unknown;
    return normalizeDashboard(parsed, args.previousHealth);
  } catch {
    return null;
  }
}

function isDashboardShape(value: unknown): value is ProjectIntelligenceDashboardPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const o = value as Record<string, unknown>;
  const nba = o.nextBestAction;
  const mp = o.marketPosition;
  const ms = o.milestones;
  return (
    typeof o.healthScore === 'number' &&
    typeof o.generatedAt === 'string' &&
    Array.isArray(o.revenueDrivers) &&
    Array.isArray(o.risks) &&
    typeof nba === 'object' &&
    nba !== null &&
    !Array.isArray(nba) &&
    typeof mp === 'object' &&
    mp !== null &&
    !Array.isArray(mp) &&
    typeof ms === 'object' &&
    ms !== null &&
    !Array.isArray(ms)
  );
}

export function readDashboardCache(signals: Record<string, unknown>): DashboardCacheBlob | null {
  const raw = signals[RIDVAN_DASHBOARD_INTELLIGENCE_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const blob = raw as Record<string, unknown>;
  const fingerprint = typeof blob.fingerprint === 'string' ? blob.fingerprint : '';
  const generatedAt = typeof blob.generatedAt === 'string' ? blob.generatedAt : '';
  const dashboard = blob.dashboard;
  if (!fingerprint || !generatedAt || !isDashboardShape(dashboard)) {
    return null;
  }
  return {
    fingerprint,
    generatedAt,
    dashboard,
  };
}

async function persistDashboardCache(args: {
  workspaceId: string;
  currentSignals: Record<string, unknown>;
  fingerprint: string;
  dashboard: ProjectIntelligenceDashboardPayload;
}) {
  const nextSignals = {
    ...args.currentSignals,
    [RIDVAN_DASHBOARD_INTELLIGENCE_KEY]: {
      fingerprint: args.fingerprint,
      generatedAt: args.dashboard.generatedAt,
      dashboard: args.dashboard,
    },
  } as Record<string, unknown>;

  const { error } = await supabaseAdmin
    .from('brain_project_state')
    .update({
      current_signals: nextSignals,
      current_signals_updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', args.workspaceId);

  if (error) {
    console.error('[RIDVAN-E2102] Failed to persist dashboard cache', error.message);
  }
}

export async function getOrBuildProjectDashboard(args: {
  projectId: string;
  userId: string;
  env: Env;
  forceRefresh?: boolean;
}): Promise<{
  dashboard: ProjectIntelligenceDashboardPayload;
  cached: boolean;
  brainMissing: boolean;
}> {
  const brain = await readBrainContext({ projectId: args.projectId, userId: args.userId });

  if (!brain) {
    const dashboard = buildHeuristicDashboard(
      {
        workspaceId: '',
        projectId: args.projectId,
        userId: args.userId,
        industryProfileId: null,
        geoProfileId: null,
        activeGoalEntryIds: [],
        activePriorityEntryIds: [],
        activeChallengeEntryIds: [],
        activeModuleEntryIds: [],
        latestMilestoneEntryIds: [],
        recentExperimentEntryIds: [],
        currentSignals: {},
        currentSignalsUpdatedAt: null,
        publishedStatus: 'unknown',
        latestPublishAt: null,
        latestSnapshotVersion: null,
        latestSnapshotAt: null,
        currentStage: null,
        currentBusinessModel: null,
        primaryGoalSummary: null,
        topPrioritySummary: null,
        mainChallengeSummary: null,
        stateVersion: 0,
        updatedAt: new Date().toISOString(),
      },
      { drivers: [], risks: [] },
      null,
    );
    return { dashboard: { ...dashboard, healthScore: clamp(dashboard.healthScore - 8, 15, 60) }, cached: false, brainMissing: true };
  }

  const fp = fingerprintBrainContext(brain.state);
  const cached = readDashboardCache(brain.state.currentSignals);
  const previousHealth =
    cached?.dashboard?.healthScore != null ? Math.round(Number(cached.dashboard.healthScore)) : null;

  if (!args.forceRefresh && cached && cached.fingerprint === fp) {
    return { dashboard: cached.dashboard, cached: true, brainMissing: false };
  }

  const vertical = await getVerticalContext({
    projectId: args.projectId,
    userId: args.userId,
    env: args.env,
    brain,
    mentorFastPath: true,
  });

  const driverTitles = (vertical.revenueDrivers ?? []).slice(0, 6).map((d) => d.driver);
  const riskSnippets = (vertical.failurePatterns ?? []).slice(0, 6).map((p) => p.pattern);
  const verticalText = [
    `Bransch/affär: ${vertical.expectedBusinessModel}`,
    `Drivers: ${driverTitles.join('; ')}`,
    `Riskmönster: ${riskSnippets.join('; ')}`,
  ].join('\n');

  const dashboard =
    (await generateDashboardWithLlm({
      env: args.env,
      state: brain.state,
      verticalText,
      previousHealth,
    })) ?? buildHeuristicDashboard(brain.state, { drivers: driverTitles, risks: riskSnippets }, previousHealth);

  await persistDashboardCache({
    workspaceId: brain.state.workspaceId,
    currentSignals: brain.state.currentSignals,
    fingerprint: fp,
    dashboard,
  });

  return { dashboard, cached: false, brainMissing: false };
}

export function healthScoreToDotClass(score: number): 'green' | 'yellow' | 'red' {
  if (score >= 80) {
    return 'green';
  }
  if (score >= 50) {
    return 'yellow';
  }
  return 'red';
}
