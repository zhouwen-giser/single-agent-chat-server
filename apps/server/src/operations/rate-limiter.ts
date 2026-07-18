export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<
    string,
    { readonly startedAt: number; count: number }
  >();

  constructor(
    private readonly maximum: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maximumBuckets = 10_000,
  ) {}

  consume(key: string): RateLimitDecision {
    const currentTime = this.now();
    const existing = this.buckets.get(key);
    if (
      existing === undefined ||
      currentTime - existing.startedAt >= this.windowMs
    ) {
      this.sweep(currentTime);
      if (existing === undefined && this.buckets.size >= this.maximumBuckets) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil(this.windowMs / 1000)),
        };
      }
      this.buckets.set(key, { startedAt: currentTime, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (existing.count >= this.maximum) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(
            (this.windowMs - (currentTime - existing.startedAt)) / 1000,
          ),
        ),
      };
    }
    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private sweep(currentTime: number): void {
    if (this.buckets.size < this.maximumBuckets) return;
    for (const [key, bucket] of this.buckets) {
      if (currentTime - bucket.startedAt >= this.windowMs) {
        this.buckets.delete(key);
      }
    }
  }
}
