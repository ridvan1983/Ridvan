const REQUIRED_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
] as const;

const OPTIONAL_ENV_VARS = ['ADMIN_SECRET'] as const;

export function validateEnv(env: Record<string, string | undefined>) {
  const missing: string[] = [];

  for (const key of REQUIRED_ENV_VARS) {
    if (!env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables:\n${missing.map((key) => `  - ${key}`).join('\n')}`);
  }
}

export { REQUIRED_ENV_VARS };
export { OPTIONAL_ENV_VARS };
