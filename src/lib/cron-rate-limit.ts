/**
 * /api/cron/* IP 기반 간단 rate limit (인메모리, 서버리스 인스턴스별).
 * 남용·오설정 스케줄러 폭주 완화용 — 정상 GitHub Actions 주기는 한도 내.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

type Entry = { count: number; windowStart: number };

const buckets = new Map<string, Entry>();

function clientIp(req: Request): string {
  const xf = req.headers.get('x-forwarded-for');
  if (xf) return xf.split(',')[0]?.trim() || 'unknown';
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

export function isCronRateLimited(req: Request): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  let entry = buckets.get(ip);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    buckets.set(ip, entry);
  }
  entry.count += 1;
  if (entry.count > MAX_PER_WINDOW) return true;
  return false;
}
