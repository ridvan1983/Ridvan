import { createAnthropic } from '@ai-sdk/anthropic';
import { getOptionalServerEnv } from '~/lib/env.server';

/** Default builder model. Override with ANTHROPIC_MODEL (e.g. opus) only if you accept higher latency/cost. */
const FALLBACK_MODEL = 'claude-sonnet-4-6';

export function getAnthropicModel(apiKey: string) {
  const anthropic = createAnthropic({
    apiKey,
  });

  const modelId = getOptionalServerEnv('ANTHROPIC_MODEL') || FALLBACK_MODEL;

  return anthropic(modelId);
}
