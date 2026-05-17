export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimit {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;

  constructor(private readonly options: RateLimitOptions) {
    this.now = options.now ?? Date.now;
  }

  consume(key: string): RateLimitResult {
    const now = this.now();
    const existing = this.buckets.get(key);
    const bucket = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + this.options.windowMs };

    if (bucket.count >= this.options.limit) {
      this.buckets.set(key, bucket);
      return { allowed: false, retryAfterMs: Math.max(0, bucket.resetAt - now) };
    }

    bucket.count += 1;
    this.buckets.set(key, bucket);
    return { allowed: true, retryAfterMs: 0 };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}
