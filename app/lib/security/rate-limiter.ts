interface RateLimitEntry {
  count: number;
  windowStart: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
}

export class RateLimiter {
  #entries = new Map<string, RateLimitEntry>();
  #maxRequests: number;
  #windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.#maxRequests = maxRequests;
    this.#windowMs = windowMs;
  }

  check(userId: string): RateLimitResult {
    const now = Date.now();
    const existing = this.#entries.get(userId);

    if (!existing || now - existing.windowStart > this.#windowMs) {
      this.#entries.set(userId, { count: 1, windowStart: now });
      return {
        allowed: true,
        remaining: this.#maxRequests - 1,
        resetInMs: this.#windowMs,
      };
    }

    if (existing.count >= this.#maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetInMs: Math.max(this.#windowMs - (now - existing.windowStart), 0),
      };
    }

    existing.count += 1;
    this.#entries.set(userId, existing);

    return {
      allowed: true,
      remaining: this.#maxRequests - existing.count,
      resetInMs: Math.max(this.#windowMs - (now - existing.windowStart), 0),
    };
  }

  removeStaleEntries() {
    const now = Date.now();

    for (const [userId, entry] of this.#entries.entries()) {
      if (now - entry.windowStart > this.#windowMs) {
        this.#entries.delete(userId);
      }
    }
  }
}

export const chatRateLimiter = new RateLimiter(20, 60 * 60 * 1000);

const cleanupInterval = setInterval(() => {
  chatRateLimiter.removeStaleEntries();
}, 5 * 60 * 1000);

if (typeof (cleanupInterval as any).unref === 'function') {
  (cleanupInterval as any).unref();
}
