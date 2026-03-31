export const FEATURE_FLAGS = {
  netlifyDeploy: false,
  customDomains: false,
  mentorHealth: false,
  mentorHealthCheckIn: false,
  mentorMilestones: false,
  mentorDailyPriority: false,
  documentGeneration: false,
  weeklyDigest: false,
} as const;

export type FeatureFlagName = keyof typeof FEATURE_FLAGS;
