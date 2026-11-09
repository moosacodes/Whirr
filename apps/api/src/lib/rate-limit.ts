interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  check(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    if (now - this.lastSweep > 60_000) {
      for (const [k, bucket] of this.buckets) {
        if (bucket.resetAt <= now) this.buckets.delete(k);
      }
      this.lastSweep = now;
    }
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (existing.count >= limit) {
      return { allowed: false, retryAfterMs: Math.max(0, existing.resetAt - now) };
    }
    existing.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  reset(): void {
    this.buckets.clear();
  }
}
