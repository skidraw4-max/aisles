/** RM-21 (I-026): claim input on the evidence card. DB-free; validation runs before any store access. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JURY_CLAIM_MAX_LENGTH, normalizeReviewClaim, type JuryMembership } from './records';
import { runTenantReview, tenantReviewRequestKey, toTenantReviewRequest } from './tenant-review';

const TENANT = 'rm21-tenant';
const NOW = '2026-10-23T00:00:00.000Z';

function membership(id: string, userId: string, role: JuryMembership['role']): JuryMembership {
  return { id, tenantId: TENANT, userId, role, status: 'ACTIVE', createdAt: NOW } as JuryMembership;
}
const owner = membership('rm21-owner-m', 'rm21-owner', 'OWNER');
const viewer = membership('rm21-viewer-m', 'rm21-viewer', 'VIEWER');

function command(userId: string, memberships: JuryMembership[], reviewType: string, claim: string | null) {
  return { userId, memberships, clientTenantId: null, evidenceId: '', reviewType, claim, now: NOW };
}

test('CLAIM_VALIDATION rejects a missing, empty or whitespace-only claim (server)', async () => {
  for (const claim of [null, '', '   \n\t ']) {
    const outcome = await runTenantReview(command(owner.userId, [owner], 'CLAIM_VALIDATION', claim));
    assert.deepEqual(outcome, { ok: false, reason: 'CLAIM_REQUIRED' });
  }
});

test('claim is trimmed and length-limited', async () => {
  assert.deepEqual(normalizeReviewClaim('  누적 가입자가 400명을 넘었다 \n'), { ok: true, claim: '누적 가입자가 400명을 넘었다' });
  assert.deepEqual(normalizeReviewClaim('   '), { ok: true, claim: undefined });
  assert.deepEqual(normalizeReviewClaim(null), { ok: true, claim: undefined });
  const max = 'a'.repeat(JURY_CLAIM_MAX_LENGTH);
  assert.deepEqual(normalizeReviewClaim(`  ${max}  `), { ok: true, claim: max });
  assert.deepEqual(normalizeReviewClaim(`${max}b`), { ok: false, reason: 'CLAIM_TOO_LONG' });
  const outcome = await runTenantReview(command(owner.userId, [owner], 'CLAIM_VALIDATION', `${max}b`));
  assert.deepEqual(outcome, { ok: false, reason: 'CLAIM_TOO_LONG' });
});

test('a valid claim is stored as entered (trimmed) and reads back equal', () => {
  const normalized = normalizeReviewClaim('  가입자가 두 배로 늘었다  ');
  assert.equal(normalized.ok, true);
  const claim = normalized.ok ? normalized.claim : undefined;
  const row = {
    id: tenantReviewRequestKey(TENANT, 'ev-1', 'CLAIM_VALIDATION', claim),
    tenantId: TENANT,
    connectionId: 'conn-1',
    evidenceId: 'ev-1',
    reviewType: 'CLAIM_VALIDATION',
    claim: claim ?? '',
    mode: 'EXTERNAL_SERVICE',
    status: 'COMPLETED',
    coreRootDir: 'data/jury-product',
    requestedByUserId: owner.userId,
  };
  const reread = toTenantReviewRequest(row);
  assert.equal(reread.reviewType, 'CLAIM_VALIDATION');
  assert.equal('claim' in reread ? reread.claim : undefined, '가입자가 두 배로 늘었다');
});

test('FULL_REVIEW request key is unchanged (claim hashed as empty string)', () => {
  const legacy = createHash('sha256').update([TENANT, 'ev-1', 'FULL_REVIEW', ''].join('\n')).digest('hex');
  assert.equal(tenantReviewRequestKey(TENANT, 'ev-1', 'FULL_REVIEW', undefined), legacy);
  const blank = normalizeReviewClaim('   ');
  assert.equal(tenantReviewRequestKey(TENANT, 'ev-1', 'FULL_REVIEW', blank.ok ? blank.claim : undefined), legacy);
  // A claim makes it a distinct request (dedupe per claim, unchanged formula).
  assert.notEqual(tenantReviewRequestKey(TENANT, 'ev-1', 'CLAIM_VALIDATION', 'x'), legacy);
});

test('unauthorized actors are rejected before claim handling', async () => {
  assert.deepEqual(
    await runTenantReview(command(viewer.userId, [viewer], 'CLAIM_VALIDATION', '주장')),
    { ok: false, reason: 'FORBIDDEN' },
  );
  assert.deepEqual(
    await runTenantReview(command('rm21-nobody', [], 'CLAIM_VALIDATION', '주장')),
    { ok: false, reason: 'NO_MEMBERSHIP' },
  );
});

test('server action reads the claim field and keeps the review.execute guard', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/app/(jury)/jury/actions.ts'), 'utf8');
  const body = source.slice(source.indexOf('export async function submitTenantReview'), source.indexOf('export async function acknowledgeHumanReview'));
  assert.match(body, /guardEvidenceFeature\(actor, .*'review\.execute'\)/);
  assert.match(body, /formData\.get\('claim'\)/);
  assert.doesNotMatch(body, /claim: null,/);
});
