import assert from 'node:assert/strict';
import test from 'node:test';
import { recordReviewAudit } from './review-audit';

const base = {
  tenantId: 't', actorUserId: 'u', evidenceId: 'e', reviewId: 'r',
  path: 'TENANT_EVIDENCE' as const, reviewType: 'FULL_REVIEW',
};

test('audit write failure is swallowed and reported as false (review outcome unaffected)', async () => {
  const prisma = { juryAuditEvent: { create: async () => { throw Object.assign(new Error('db down postgres://x'), { code: 'P1001' }); } } };
  const warn = console.warn;
  const logged: unknown[] = [];
  console.warn = (...args: unknown[]) => { logged.push(args); };
  try {
    assert.equal(await recordReviewAudit(prisma, { ...base, action: 'REVIEW_STARTED' }), false);
  } finally {
    console.warn = warn;
  }
  assert.equal(JSON.stringify(logged).includes('postgres://'), false, 'no secrets in the warning');
});

test('audit event carries path, review type and failure reason, never raw error text', async () => {
  const rows: { data: Record<string, unknown> }[] = [];
  const prisma = { juryAuditEvent: { create: async (args: unknown) => { rows.push(args as { data: Record<string, unknown> }); } } };
  assert.equal(await recordReviewAudit(prisma, { ...base, action: 'REVIEW_FAILED', failureReason: 'REVIEW_NOT_EXECUTED' }), true);
  const data = rows[0]!.data;
  assert.equal(data.action, 'REVIEW_FAILED');
  assert.deepEqual(data.provenance, { path: 'TENANT_EVIDENCE', reviewType: 'FULL_REVIEW', failureReason: 'REVIEW_NOT_EXECUTED', readOnly: true, piiExcluded: true });
});

test('ai-review-board is not instrumented (RM-08 stays outside it)', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = 'src/lib/ai-review-board';
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.ts')) assert.equal(readFileSync(`${dir}/${f}`, 'utf8').includes('review-audit'), false, f);
  }
});
