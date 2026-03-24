import { readBrainContext } from '~/lib/brain/read.server';
import { getVerticalContext } from '~/lib/vertical/context.server';
import { computeOpportunities } from './engine.server';
import type { OpportunityContextResponse } from './types.server';

function readPublishedStatus(state: any) {
  const s = state?.currentSignals?.published_status;
  const v = s && typeof s === 'object' ? (s as any).value : null;
  return typeof v === 'string' ? v : 'unknown';
}

function readPaymentEnabled(state: any): boolean | null {
  const s = state?.currentSignals?.payment_enabled;
  const v = s && typeof s === 'object' ? (s as any).value : null;
  return typeof v === 'boolean' ? v : null;
}

export async function buildOpportunityContext(args: { projectId: string; userId: string }): Promise<OpportunityContextResponse | null> {
  const brain = await readBrainContext({ projectId: args.projectId, userId: args.userId });
  if (!brain) {
    return null;
  }

  const vertical = await getVerticalContext({ projectId: args.projectId, userId: args.userId });
  if (!vertical) {
    return null;
  }

  const industry = (vertical as any)?.industryProfile?.normalizedIndustry ?? brain.industryProfile?.normalizedIndustry ?? null;
  const geoCountryCode = (vertical as any)?.geoProfile?.countryCode ?? brain.geoProfile?.countryCode ?? null;
  const verticalModules = Array.isArray((vertical as any)?.modules) ? ((vertical as any).modules as any[]) : [];

  const opportunities = computeOpportunities({
    state: brain.state,
    industry,
    geoCountryCode,
    verticalModules,
  });

  return {
    projectId: args.projectId,
    brainSummary: {
      primaryGoalSummary: brain.state.primaryGoalSummary,
      topPrioritySummary: brain.state.topPrioritySummary,
      mainChallengeSummary: brain.state.mainChallengeSummary,
      publishedStatus: readPublishedStatus(brain.state),
      paymentEnabled: readPaymentEnabled(brain.state),
    },
    vertical,
    opportunities,
  };
}
