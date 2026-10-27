/**
 * I-069: which pages a screen audit (화면 심사) measures. Pure helpers, no I/O.
 * Pages are sampled by type so one kind (e.g. 13 product details) cannot use up the whole budget:
 * main 1, product detail ≤ 3, info ≤ 2, other fills the rest, total ≤ AUDIT_LIMITS.maxPages.
 * Sensitive paths (/mypage) are never candidates; the audit hook still BLOCKs them if discovery reaches one.
 */
import { isSensitivePath } from '../readonly-account/sensitive-paths';
import { AUDIT_LIMITS } from './viewports';

export type AuditPageType = 'MAIN' | 'PRODUCT' | 'INFO' | 'OTHER';

const MAIN = /^\/(main|home|index(\.\w+)?)?\/?$/i;
const PRODUCT = /^\/(product|products|goods|item|items|detail|prd|shop\/product|p)\/[^/]+/i;
const PRODUCT_QUERYLESS = /\/(product|goods|item)[-_]?(detail|view)\b/i;
const INFO = /^\/(common|cst|cs|customer|help|support|notice|notices|faq|about|info|guide|policy|policies|terms|company|event|events|board)(\/|$)/i;

export function classifyPageType(path: string): AuditPageType {
  if (MAIN.test(path)) return 'MAIN';
  if (PRODUCT.test(path) || PRODUCT_QUERYLESS.test(path)) return 'PRODUCT';
  if (INFO.test(path)) return 'INFO';
  return 'OTHER';
}

export type SampleLimits = { total: number; MAIN: number; PRODUCT: number; INFO: number; OTHER: number };
export const DEFAULT_SAMPLE_LIMITS: SampleLimits = {
  total: AUDIT_LIMITS.maxPages,
  MAIN: AUDIT_LIMITS.sample.main,
  PRODUCT: AUDIT_LIMITS.sample.product,
  INFO: AUDIT_LIMITS.sample.info,
  OTHER: AUDIT_LIMITS.maxPages,
};

/** Stateful sampler used by the audit hook: check() → OK (then take()) or the NOT_TESTED reason. */
export function createPageSampler(limits: SampleLimits = DEFAULT_SAMPLE_LIMITS) {
  const used: Record<AuditPageType, number> = { MAIN: 0, PRODUCT: 0, INFO: 0, OTHER: 0 };
  let total = 0;
  return {
    check(path: string): 'OK' | 'SAMPLE_LIMIT' | 'MAX_PAGES' {
      if (total >= limits.total) return 'MAX_PAGES';
      const t = classifyPageType(path);
      if (used[t] >= limits[t]) return 'SAMPLE_LIMIT';
      return 'OK';
    },
    take(path: string) {
      used[classifyPageType(path)] += 1;
      total += 1;
    },
  };
}

/**
 * Candidate paths from earlier observations, in the order the audit should visit them: one main, then up to the
 * per-type caps (product, info, other), total ≤ limits.total. Sensitive, duplicate and malformed paths are dropped.
 */
export function selectAuditCandidates(
  paths: readonly string[],
  opts: { sensitivePrefixes?: readonly string[]; limits?: SampleLimits } = {},
): string[] {
  const limits = opts.limits ?? DEFAULT_SAMPLE_LIMITS;
  const seen = new Set<string>();
  const byType: Record<AuditPageType, string[]> = { MAIN: [], PRODUCT: [], INFO: [], OTHER: [] };
  for (const raw of paths) {
    if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.length > 512) continue;
    const p = raw.length > 1 ? raw.replace(/\/+$/, '') || '/' : raw;
    if (seen.has(p) || isSensitivePath(p, opts.sensitivePrefixes)) continue;
    seen.add(p);
    byType[classifyPageType(p)].push(p);
  }
  const out: string[] = [];
  for (const t of ['MAIN', 'PRODUCT', 'INFO', 'OTHER'] as const) {
    for (const p of byType[t].slice(0, limits[t])) if (out.length < limits.total) out.push(p);
  }
  return out;
}
