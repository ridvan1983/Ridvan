import { createAnthropic } from '@ai-sdk/anthropic';

const FALLBACK_MODEL = 'claude-sonnet-4-6';

export function getAnthropicModel(apiKey: string) {
  const anthropic = createAnthropic({
    apiKey,
  });

  const modelId = process.env.ANTHROPIC_MODEL || FALLBACK_MODEL;

  return anthropic(modelId);
}
