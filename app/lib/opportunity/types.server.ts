export type OpportunityType = 'missing_capability' | 'signal_gap' | 'risk' | 'growth';
export type OpportunityPriority = 'high' | 'medium' | 'low';

export interface Opportunity {
  type: OpportunityType;
  problem_detected: string;
  why_now: string;
  suggested_module: string | null;
  reasoning: string;
  confidence: number;
  priority: OpportunityPriority;
  source: string;
}

export interface OpportunityContextResponse {
  projectId: string;
  brainSummary: {
    primaryGoalSummary: string | null;
    topPrioritySummary: string | null;
    mainChallengeSummary: string | null;
    publishedStatus: string;
    paymentEnabled: boolean | null;
  };
  vertical: unknown;
  opportunities: Opportunity[];
}
