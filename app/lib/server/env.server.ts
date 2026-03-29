const REQUIRED_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
] as const;

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
