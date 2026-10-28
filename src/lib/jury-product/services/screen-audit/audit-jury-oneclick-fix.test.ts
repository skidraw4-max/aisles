import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { hasProposalsKey } from '../../connected-service-review';
import { buildProductEvidence } from '../../evidence-builder';
import {
  AUDIT_JURY_REUSED_NOTICE,
  SCREEN_AUDIT_EVIDENCE_PURPOSE,
  auditJuryFailureText,
  auditJuryResultHref,
} from './audit-jury-ui';

const src = (p: string) => readFileSync(path.resolve(process.cwd(), p), 'utf8');

test('fix 1: one-click binds screen audit for any connection type, NO_AUDIT blocks, own purpose label', () => {
  assert.equal(SCREEN_AUDIT_EVIDENCE_PURPOSE, 'screen-audit');
  const review = src('src/lib/jury-product/connected-service-review.ts');
  assert.match(review, /command\.requireScreenAudit === true \|\| connection\.accessMethod === 'READ_ONLY_ACCOUNT'/);
  assert.match(review, /requireScreenAudit === true && !screenAudit\) return \{ ok: false, reason: 'NO_AUDIT' \}/);
  const action = src('src/app/(jury)/jury/actions.ts');
  assert.match(action, /purpose: SCREEN_AUDIT_EVIDENCE_PURPOSE,\s+requireScreenAudit: true,/);
  assert.match(auditJuryFailureText('NO_AUDIT'), /화면 심사가 끝나면/);
  assert.match(auditJuryFailureText('ERROR'), /\(ERROR\)/);
  assert.equal(typeof buildProductEvidence, 'function');
  assert.match(src('src/lib/jury-product/evidence-builder.ts'), /purpose: input\.purpose \?\? 'aisle-self-observation'/);
});

test('fix 2: results without the improvementProposals key are not reused', () => {
  assert.equal(hasProposalsKey({ improvementProposals: [] }), true);
  assert.equal(hasProposalsKey({ statusSummary: 'x' }), false);
  assert.equal(hasProposalsKey(null), false);
  assert.equal(hasProposalsKey('x'), false);
  const review = src('src/lib/jury-product/connected-service-review.ts');
  assert.match(review, /command\.skipLegacyResult === true\s+\? \[sha\(\[actor\.tenantId, evidence\.id, 'FULL_REVIEW', ''\]\), sha\(\[actor\.tenantId, evidence\.id, 'FULL_REVIEW', 'proposals'\]\)\]/);
  assert.match(src('src/app/(jury)/jury/actions.ts'), /core: tenantReviewCore, skipLegacyResult: true \}/);
  assert.match(review, /hasProposalsKey\(result\.finalSurface\)/);
});

test('fix 3: reused one-click result opens with a notice', () => {
  assert.equal(auditJuryResultHref('r1'), '/jury/reviews/r1#improvement-proposals');
  assert.equal(auditJuryResultHref('r1', true), '/jury/reviews/r1?reused=1#improvement-proposals');
  assert.match(AUDIT_JURY_REUSED_NOTICE, /이전에 저장된/);
  const page = src('src/app/(jury)/jury/reviews/[reviewId]/page.tsx');
  assert.match(page, /query\.reused === '1'/);
  assert.match(page, /AUDIT_JURY_REUSED_NOTICE/);
  assert.match(src('src/app/(jury)/jury/AuditJuryReviewButton.tsx'), /finish\(r\.resultId, r\.reused\)/);
});
