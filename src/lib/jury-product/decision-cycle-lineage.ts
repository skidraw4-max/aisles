/**
 * Finds an existing decision cycle by walking explicit review lineage.
 * It does not create a cycle or change root or current.
 */
export type LineageCycleRef = {
  id: string;
  tenantId: string;
  rootReviewResultId: string;
  currentReviewResultId: string;
};

export type LineageStep = {
  id: string;
  tenantId: string;
  ancestorIds: readonly string[];
};

export type LineageFailure =
  | 'REVIEW_NOT_FOUND'
  | 'DECISION_CYCLE_NOT_FOUND'
  | 'DECISION_CYCLE_LINEAGE_AMBIGUOUS'
  | 'REVIEW_LINEAGE_CYCLE'
  | 'TENANT_MISMATCH';

export type LineageIo = {
  load(reviewResultId: string): Promise<LineageStep | null>;
  cyclesFor(reviewResultId: string): Promise<readonly LineageCycleRef[]>;
};

const MAX_STEPS = 20;

export async function resolveDecisionCycleLineage(
  input: { reviewResultId: string; tenantId: string },
  io: LineageIo,
): Promise<{ ok: true; cycle: LineageCycleRef; via: 'DIRECT' | 'LINEAGE' } | { ok: false; reason: LineageFailure }> {
  const seen = new Set<string>();
  let current = input.reviewResultId;
  let via: 'DIRECT' | 'LINEAGE' = 'DIRECT';
  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (seen.has(current)) return { ok: false, reason: 'REVIEW_LINEAGE_CYCLE' };
    seen.add(current);
    const review = await io.load(current);
    if (!review) return { ok: false, reason: 'REVIEW_NOT_FOUND' };
    if (review.tenantId !== input.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
    const cycles = distinct(await io.cyclesFor(current));
    if (cycles.length > 1) return { ok: false, reason: 'DECISION_CYCLE_LINEAGE_AMBIGUOUS' };
    if (cycles.length === 1) {
      const cycle = cycles[0]!;
      if (cycle.tenantId !== input.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
      return { ok: true, cycle, via };
    }
    const ancestors = [...new Set(review.ancestorIds.filter((id) => id && id !== review.id))];
    if (ancestors.length > 1) return { ok: false, reason: 'DECISION_CYCLE_LINEAGE_AMBIGUOUS' };
    if (ancestors.length === 0) return { ok: false, reason: 'DECISION_CYCLE_NOT_FOUND' };
    via = 'LINEAGE';
    current = ancestors[0]!;
  }
  return { ok: false, reason: 'REVIEW_LINEAGE_CYCLE' };
}

function distinct(cycles: readonly LineageCycleRef[]): LineageCycleRef[] {
  const found = new Map<string, LineageCycleRef>();
  for (const cycle of cycles) found.set(cycle.id, cycle);
  return [...found.values()];
}
