import { getOptionalServerEnv } from '~/lib/env.server';

export function getAPIKey(cloudflareEnv?: unknown) {
  return getOptionalServerEnv('ANTHROPIC_API_KEY', cloudflareEnv);
}
