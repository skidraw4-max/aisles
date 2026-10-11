/**
 * Minimal fixed-window, in-memory rate limiter (diagnostics use).
 *
 * IMPORTANT: state lives in this process's memory only. On Vercel/serverless each
 * instance keeps its own counters, counters reset on cold start, and nothing is
 * shared across instances or regions. This is NOT a global limit; treat it as a
 * best-effort per-instance brake only.
 *
 * Intentionally dependency-free: no Prisma, Supabase, DB, network, or
 * cron-rate-limit imports. Each createRateLimiter() call owns an independent Map.
 */

export type RateLimiterOptions = {
  /** Max allowed hits per key within one window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Injectable clock (tests). Defaults to Date.now. */
  now?: () => number;
};

export type RateLimiter = {
  /** Records one hit for key. Returns true when the key is over the limit (=> reject). */
  check: (key: string) => boolean;
  /** Clears all counters of this instance only. */
  reset: () => void;
  /** Number of tracked keys in this instance (diagnostics/tests). */
  size: () => number;
};

type Entry = { count: number; windowStart: number };

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const { limit, windowMs } = opts;
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be a positive integer');
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new RangeError('windowMs must be > 0');
  const now = opts.now ?? Date.now;
  const buckets = new Map<string, Entry>();

  return {
    check(key: string): boolean {
      const t = now();
      let entry = buckets.get(key);
      if (!entry || t - entry.windowStart >= windowMs) {
        entry = { count: 0, windowStart: t };
        buckets.set(key, entry);
      }
      entry.count += 1;
      return entry.count > limit;
    },
    reset(): void {
      buckets.clear();
    },
    size(): number {
      return buckets.size;
    },
  };
}

/** First x-forwarded-for hop, then x-real-ip, else 'unknown'. Header-only, no network. */
export function clientKeyFromRequest(req: Request): string {
  const xf = req.headers.get('x-forwarded-for');
  if (xf) return xf.split(',')[0]?.trim() || 'unknown';
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}
