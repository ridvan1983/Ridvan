type EnvRecord = Record<string, unknown>;

type ServerContextLike = {
  cloudflare?: {
    env?: unknown;
  };
};

function normalizeEnv(source?: unknown): EnvRecord | null {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return null;
  }

  return source as EnvRecord;
}

export function getCloudflareEnv(context?: ServerContextLike | null) {
  return normalizeEnv(context?.cloudflare?.env);
}

export function getRequestCloudflareEnv(request?: unknown) {
  const requestWithCf = (request ?? null) as { cf?: { env?: unknown } } | null;
  return normalizeEnv(requestWithCf?.cf?.env);
}

export function getServerEnv(source?: unknown) {
  return normalizeEnv(source) ?? normalizeEnv((globalThis as { env?: unknown } | undefined)?.env) ?? null;
}

export function getOptionalServerEnv(key: string, source?: unknown) {
  const env = getServerEnv(source);
  const contextualValue = env?.[key];

  if (typeof contextualValue === 'string' && contextualValue.length > 0) {
    return contextualValue;
  }

  const processValue = process.env[key];
  if (typeof processValue === 'string' && processValue.length > 0) {
    return processValue;
  }

  return undefined;
}

export function requireServerEnv(key: string, source?: unknown, errorCode = '[RIDVAN-E899] Missing required environment variable') {
  const value = getOptionalServerEnv(key, source);

  if (!value) {
    throw new Error(`${errorCode} ${key}`);
  }

  return value;
}

export function pickServerEnv<TKeys extends readonly string[]>(keys: TKeys, source?: unknown) {
  return Object.fromEntries(keys.map((key) => [key, getOptionalServerEnv(key, source)])) as Record<TKeys[number], string | undefined>;
}
