/**
 * Decision-cycle lineage lookup. It only reads explicit links.
 * Run: node --import tsx --test src/lib/jury-product/decision-cycle-lineage.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolveDecisionCycleLineage, type LineageCycleRef, type LineageIo, type LineageStep } from './decision-cycle-lineage';

function cycle(partial: Partial<LineageCycleRef> & Pick<LineageCycleRef, 'id' | 'rootReviewResultId' | 'currentReviewResultId'>): LineageCycleRef {
  return { tenantId: 'tenant-a', ...partial };
}

function graph(steps: Record<string, LineageStep>, cycles: Record<string, LineageCycleRef[]>): LineageIo & { loaded: string[] } {
  const loaded: string[] = [];
  return {
    loaded,
    async load(id) {
      loaded.push(id);
      return steps[id] ?? null;
    },
    async cyclesFor(id) {
      return cycles[id] ?? [];
    },
  };
}

describe('decision cycle lineage', () => {
  it('returns a direct cycle without walking parents and prefers it over a parent cycle', async () => {
    const direct = cycle({ id: 'cycle-direct', rootReviewResultId: 'review-1', currentReviewResultId: 'review-1' });
    const parentCycle = cycle({ id: 'cycle-parent', rootReviewResultId: 'review-0', currentReviewResultId: 'review-0' });
    const io = graph(
      {
        'review-1': { id: 'review-1', tenantId: 'tenant-a', ancestorIds: ['review-0'] },
        'review-0': { id: 'review-0', tenantId: 'tenant-a', ancestorIds: [] },
      },
      { 'review-1': [direct], 'review-0': [parentCycle] },
    );
    const found = await resolveDecisionCycleLineage({ reviewResultId: 'review-1', tenantId: 'tenant-a' }, io);
    assert.equal(found.ok, true);
    if (!found.ok) return;
    assert.equal(found.via, 'DIRECT');
    assert.equal(found.cycle.id, 'cycle-direct');
    assert.equal(found.cycle.rootReviewResultId, 'review-1');
    assert.equal(found.cycle.currentReviewResultId, 'review-1');
    assert.deepEqual(io.loaded, ['review-1']);
  });

  it('walks one or more explicit parents and stops when no cycle exists', async () => {
    const rootCycle = cycle({ id: 'cycle-root', rootReviewResultId: 'review-1', currentReviewResultId: 'review-2' });
    const parent = graph(
      {
        'review-2': { id: 'review-2', tenantId: 'tenant-a', ancestorIds: ['review-1'] },
        'review-1': { id: 'review-1', tenantId: 'tenant-a', ancestorIds: [] },
      },
      { 'review-1': [rootCycle] },
    );
    const one = await resolveDecisionCycleLineage({ reviewResultId: 'review-2', tenantId: 'tenant-a' }, parent);
    assert.equal(one.ok, true);
    if (!one.ok) return;
    assert.equal(one.via, 'LINEAGE');
    assert.equal(one.cycle.id, 'cycle-root');
    assert.equal(one.cycle.currentReviewResultId, 'review-2');

    const deep = graph(
      {
        'review-3': { id: 'review-3', tenantId: 'tenant-a', ancestorIds: ['review-2'] },
        'review-2': { id: 'review-2', tenantId: 'tenant-a', ancestorIds: ['review-1'] },
        'review-1': { id: 'review-1', tenantId: 'tenant-a', ancestorIds: [] },
      },
      { 'review-1': [rootCycle] },
    );
    const three = await resolveDecisionCycleLineage({ reviewResultId: 'review-3', tenantId: 'tenant-a' }, deep);
    assert.equal(three.ok, true);
    if (!three.ok) return;
    assert.equal(three.cycle.rootReviewResultId, 'review-1');

    const missing = graph(
      {
        'child': { id: 'child', tenantId: 'tenant-a', ancestorIds: ['root'] },
        root: { id: 'root', tenantId: 'tenant-a', ancestorIds: [] },
      },
      {},
    );
    const none = await resolveDecisionCycleLineage({ reviewResultId: 'child', tenantId: 'tenant-a' }, missing);
    assert.equal(none.ok, false);
    if (none.ok) return;
    assert.equal(none.reason, 'DECISION_CYCLE_NOT_FOUND');
  });

  it('rejects another tenant, a loop, and two ancestors without changing the cycle', async () => {
    const foreign = graph(
      {
        child: { id: 'child', tenantId: 'tenant-a', ancestorIds: ['root'] },
        root: { id: 'root', tenantId: 'tenant-b', ancestorIds: [] },
      },
      { root: [cycle({ id: 'cycle-b', tenantId: 'tenant-b', rootReviewResultId: 'root', currentReviewResultId: 'root' })] },
    );
    const mismatch = await resolveDecisionCycleLineage({ reviewResultId: 'child', tenantId: 'tenant-a' }, foreign);
    assert.equal(mismatch.ok, false);
    if (mismatch.ok) return;
    assert.equal(mismatch.reason, 'TENANT_MISMATCH');
    const foreignCycle = graph(
      { review: { id: 'review', tenantId: 'tenant-a', ancestorIds: [] } },
      { review: [cycle({ id: 'cycle-b', tenantId: 'tenant-b', rootReviewResultId: 'review', currentReviewResultId: 'review' })] },
    );
    const foreignDirect = await resolveDecisionCycleLineage({ reviewResultId: 'review', tenantId: 'tenant-a' }, foreignCycle);
    assert.equal(foreignDirect.ok, false);
    if (foreignDirect.ok) return;
    assert.equal(foreignDirect.reason, 'TENANT_MISMATCH');

    const loop = graph(
      {
        a: { id: 'a', tenantId: 'tenant-a', ancestorIds: ['b'] },
        b: { id: 'b', tenantId: 'tenant-a', ancestorIds: ['a'] },
      },
      {},
    );
    const cycled = await resolveDecisionCycleLineage({ reviewResultId: 'a', tenantId: 'tenant-a' }, loop);
    assert.equal(cycled.ok, false);
    if (cycled.ok) return;
    assert.equal(cycled.reason, 'REVIEW_LINEAGE_CYCLE');

    const ambiguous = graph(
      { child: { id: 'child', tenantId: 'tenant-a', ancestorIds: ['left', 'right'] } },
      {},
    );
    const both = await resolveDecisionCycleLineage({ reviewResultId: 'child', tenantId: 'tenant-a' }, ambiguous);
    assert.equal(both.ok, false);
    if (both.ok) return;
    assert.equal(both.reason, 'DECISION_CYCLE_LINEAGE_AMBIGUOUS');

    const source = readFileSync(new URL('./decision-cycle-lineage.ts', import.meta.url), 'utf8');
    assert.equal(source.includes('insertCycle'), false);
    assert.equal(source.includes('rootReviewResultId ='), false);
    assert.equal(source.includes('runReviewBoardPipeline'), false);
  });
});
