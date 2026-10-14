import 'server-only';
import { clientKeyFromRequest, createRateLimiter } from '@/lib/simple-rate-limit';
import { buildPreviewPgConfig, defaultPreviewCaPath } from '@/lib/jury-product/preview-db-tls';
import { planRuntimeDbTarget } from '@/lib/jury-product/preview-db-guard';
import { readPinnedCaPem } from '@/lib/jury-product/db-ca';
import { checkSupabaseTarget } from '@/lib/jury-product/supabase-target-guard.cjs';
import { createPreviewDiagHandler } from '@/lib/jury-product/preview-diagnostics';

// Preview-only, admin-only, network-free diagnostics. See preview-diagnostics.ts.
// None of the static imports above pull Prisma; admin auth is imported lazily below.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

// Diagnostics-only limiter: per-instance memory, not global, not shared across
// Vercel instances, reset on cold start. Independent of cron-rate-limit.
const diagLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

export function GET(req: Request): Promise<Response> {
  return createPreviewDiagHandler({
    env: process.env,
    loadAuth: () => import('@/lib/auth/classify-admin-auth'),
    rateLimit: (r) => diagLimiter.check(clientKeyFromRequest(r)),
    checks: {
      supabaseTarget: (env) => checkSupabaseTarget(env, { requireServiceKey: true }),
      dbTarget: (env) => planRuntimeDbTarget(env),
      caPath: (env) => defaultPreviewCaPath(env),
      caPin: (p) => readPinnedCaPem(p),
      tlsConfig: (url, env) => buildPreviewPgConfig(url, env),
    },
  })(req);
}
