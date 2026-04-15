export type HealthTrend = 'up' | 'down' | 'flat';

export type RiskSeverity = 'high' | 'medium' | 'low';

export type MarketIndicator = 'strong' | 'balanced' | 'weak';

export type ProjectIntelligenceDashboardPayload = {
  healthScore: number;
  healthTrend: HealthTrend;
  revenueDrivers: Array<{ title: string; detail: string; mentorPrompt: string }>;
  risks: Array<{ title: string; severity: RiskSeverity; action: string }>;
  nextBestAction: { title: string; detail: string; mentorPrompt: string };
  marketPosition: { summary: string; indicator: MarketIndicator };
  milestones: {
    achievedLabel: string;
    nextLabel: string;
    progressPct: number;
  };
  generatedAt: string;
};

export const RIDVAN_DASHBOARD_INTELLIGENCE_KEY = 'RIDVAN_DASHBOARD_INTELLIGENCE_V1';

export type DashboardCacheBlob = {
  fingerprint: string;
  generatedAt: string;
  dashboard: ProjectIntelligenceDashboardPayload;
};
