/**
 * P4 (JD t568): compare this result's proposals with the same service's previous result.
 * Pure. The link + comparison are stored inside finalSurface (no migration; parentReviewResultId
 * is reserved for decision-cycle lineage and is not touched).
 * "해결됨" means "not raised again this time" — it is not proof that the change was made.
 */
import { parseJuryProposals } from '../ai-review-board/jury-mode';

export type ComparisonStatus = '해결됨' | '남음' | '새로 생김';
export type ComparisonItem = { label: string; status: ComparisonStatus };
export type PreviousComparison = {
  previousResultId: string;
  previousCompletedAt: string;
  items: ComparisonItem[];
};

export const COMPARISON_LIMIT = 12;
export const COMPARISON_LABELS: Record<ComparisonStatus, string> = { 해결됨: '해결됨', 남음: '남음', '새로 생김': '새로 생김' };
export const COMPARISON_NOTE = '해결됨은 이번 심사에서 다시 지적되지 않았다는 뜻이에요. 실제 수정 여부는 확인 체크리스트로 확인하세요.';

function keyOf(p: { goal?: string; problem: string }): string {
  return (p.goal || p.problem).toLowerCase().replace(/[\s\p{P}]+/gu, '');
}

function proposalsOf(surface: unknown) {
  const s = surface && typeof surface === 'object' && !Array.isArray(surface) ? (surface as Record<string, unknown>) : {};
  if (!Object.hasOwn(s, 'improvementProposals') || s.improvementProposalsOmitted === 'SECRET') return null;
  return parseJuryProposals(s.improvementProposals);
}

/** null when either side has no proposal format (older results) — nothing is compared. */
export function compareWithPrevious(
  previous: { id: string; completedAt: Date | string; finalSurface: unknown } | null,
  currentSurface: unknown,
): PreviousComparison | null {
  if (!previous) return null;
  const before = proposalsOf(previous.finalSurface);
  const now = proposalsOf(currentSurface);
  if (!before || !now) return null;
  const beforeKeys = new Map(before.map((p) => [keyOf(p), p]));
  const nowKeys = new Set(now.map(keyOf));
  const items: ComparisonItem[] = [
    ...now.map((p) => ({ label: p.goal || p.problem, status: (beforeKeys.has(keyOf(p)) ? '남음' : '새로 생김') as ComparisonStatus })),
    ...before.filter((p) => !nowKeys.has(keyOf(p))).map((p) => ({ label: p.goal || p.problem, status: '해결됨' as const })),
  ].slice(0, COMPARISON_LIMIT);
  const at = previous.completedAt instanceof Date ? previous.completedAt.toISOString() : String(previous.completedAt);
  return { previousResultId: previous.id, previousCompletedAt: at, items };
}

/** Display read: tolerant; absent/malformed => null (older results render unchanged). */
export function readPreviousComparison(finalSurface: unknown): PreviousComparison | null {
  const s = finalSurface && typeof finalSurface === 'object' && !Array.isArray(finalSurface) ? (finalSurface as Record<string, unknown>) : {};
  const c = s.previousComparison as Record<string, unknown> | undefined;
  if (!c || typeof c !== 'object' || typeof c.previousResultId !== 'string' || !Array.isArray(c.items)) return null;
  const items = c.items.flatMap((i): ComparisonItem[] => {
    const o = i as Record<string, unknown>;
    return o && typeof o.label === 'string' && (o.status === '해결됨' || o.status === '남음' || o.status === '새로 생김') ? [{ label: o.label, status: o.status }] : [];
  });
  return { previousResultId: c.previousResultId, previousCompletedAt: typeof c.previousCompletedAt === 'string' ? c.previousCompletedAt : '', items: items.slice(0, COMPARISON_LIMIT) };
}
