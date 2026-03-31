import { createAnthropic } from '@ai-sdk/anthropic';
import { getOptionalServerEnv } from '~/lib/env.server';

const FALLBACK_MODEL = 'claude-sonnet-4-6';

export function getAnthropicModel(apiKey: string) {
  const anthropic = createAnthropic({
    apiKey,
  });

  const modelId = getOptionalServerEnv('ANTHROPIC_MODEL') || FALLBACK_MODEL;

  return anthropic(modelId);
}
