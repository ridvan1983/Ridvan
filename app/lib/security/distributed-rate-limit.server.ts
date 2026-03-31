import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { pickServerEnv } from '~/lib/env.server';

type DistributedRateLimitConfig = {
  limit: number;
  window: `${number} ${'s' | 'm' | 'h' | 'd'}`;
  prefix: string;
};

const ratelimitCache = new Map<string, Ratelimit>();

function getRedisEnv(env?: unknown) {
  const values = pickServerEnv(['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'] as const, env);

  return {
    url: values.UPSTASH_REDIS_REST_URL,
    token: values.UPSTASH_REDIS_REST_TOKEN,
  };
}

function getRatelimit(config: DistributedRateLimitConfig, env?: unknown) {
  const redisEnv = getRedisEnv(env);

  if (!redisEnv.url || !redisEnv.token) {
    throw new Error('[RIDVAN-E890] Missing Upstash Redis configuration');
  }

  const cacheKey = `${config.prefix}:${redisEnv.url}:${redisEnv.token}`;
  const existing = ratelimitCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const ratelimit = new Ratelimit({
    redis: new Redis({
      url: redisEnv.url,
      token: redisEnv.token,
    }),
    limiter: Ratelimit.slidingWindow(config.limit, config.window),
    prefix: config.prefix,
  });

  ratelimitCache.set(cacheKey, ratelimit);
  return ratelimit;
}

export const chatRateLimit: DistributedRateLimitConfig = {
  limit: 10,
  window: '1 m',
  prefix: 'ridvan:chat',
};

export const mentorRateLimit: DistributedRateLimitConfig = {
  limit: 20,
  window: '1 m',
  prefix: 'ridvan:mentor',
};

export const authRateLimit: DistributedRateLimitConfig = {
  limit: 5,
  window: '1 m',
  prefix: 'ridvan:auth',
};

export const deployRateLimit: DistributedRateLimitConfig = {
  limit: 5,
  window: '1 m',
  prefix: 'ridvan:deploy',
};

export async function checkRateLimit(
  limiter: DistributedRateLimitConfig,
  identifier: string,
  env?: unknown,
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  const result = await getRatelimit(limiter, env).limit(identifier);
  return result;
}
