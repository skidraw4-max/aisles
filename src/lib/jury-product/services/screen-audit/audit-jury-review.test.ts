/**
 * I-099: "이 결과로 위원 심사하기". No model calls, no DB.
 * Run: node --import tsx --test src/lib/jury-product/services/screen-audit/audit-jury-review.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { buildStubEvidencePack } from '@/lib/ai-review-board/evidence-pack';
import { buildProductEvidence } from '../../evidence-builder';
import {
  auditJuryEligibility,
  auditJuryResultHref,
  auditJurySteps,
  boundScreenAuditId,
  screenAuditApiEvidence,
  screenAuditIdentity,
} from './audit-jury-review';

const period = { start: '2026-10-20', end: '2026-10-26', timezone: 'Asia/Seoul' as const };
const base = {
  actorTenantId: 'tenant-a',
  connection: { id: 'conn-a', tenantId: 'tenant-a' },
  clientTenantId: null,
  pack: buildStubEvidencePack({ generatedAt: '2026-10-27T00:00:00.000Z', analysisPeriod: period }),
};
const finding = { rule: 'contrast', viewport: 'MOBILE', severity: 'HIGH', message: 'low contrast', page: { path: '/' } };
const read = (p: string) => readFileSync(path.resolve(process.cwd(), p), 'utf8');

describe('audit identity in evidence', () => {
  it('leaves id, hash and apiEvidence unchanged without an audit (old evidence keeps matching)', () => {
    const a = buildProductEvidence(base);
    const b = buildProductEvidence({ ...base, screenAudit: null });
    assert.equal(a.ok && b.ok, true);
    if (!a.ok || !b.ok) return;
    assert.equal(a.evidence.id, b.evidence.id);
    assert.equal(a.evidence.contentHash, b.evidence.contentHash);
    assert.equal(JSON.stringify(a.evidence.apiEvidence).includes('screenAuditIdentity'), false);
  });

  it('a new finished audit gives a new evidence id and hash, bound to that audit', () => {
    const id1 = screenAuditIdentity({ id: 'audit-1', finishedAt: new Date('2026-10-27T01:00:00Z') }, [finding]);
    const id2 = screenAuditIdentity({ id: 'audit-2', finishedAt: new Date('2026-10-28T01:00:00Z') }, [finding]);
    const plain = buildProductEvidence(base);
    const e1 = buildProductEvidence({ ...base, screenAudit: id1 });
    const e1again = buildProductEvidence({ ...base, screenAudit: id1 });
    const e2 = buildProductEvidence({ ...base, screenAudit: id2 });
    assert.equal(plain.ok && e1.ok && e2.ok && e1again.ok, true);
    if (!plain.ok || !e1.ok || !e2.ok || !e1again.ok) return;
    assert.notEqual(e1.evidence.id, plain.evidence.id);
    assert.notEqual(e1.evidence.contentHash, plain.evidence.contentHash);
    assert.notEqual(e1.evidence.id, e2.evidence.id);
    assert.equal(e1.evidence.id, e1again.evidence.id);
    assert.equal(boundScreenAuditId(e1.evidence.apiEvidence), 'audit-1');
    assert.equal(boundScreenAuditId(e2.evidence.apiEvidence), 'audit-2');
  });

  it('identity hash follows findings order-independently and changes with content', () => {
    const other = { ...finding, rule: 'overflow' };
    const a = screenAuditIdentity({ id: 'x', finishedAt: null }, [finding, other]);
    const b = screenAuditIdentity({ id: 'x', finishedAt: null }, [other, finding]);
    const c = screenAuditIdentity({ id: 'x', finishedAt: null }, [finding]);
    assert.equal(a.hash, b.hash);
    assert.notEqual(a.hash, c.hash);
    assert.match(a.hash, /^[a-f0-9]{64}$/);
  });

  it('parses only well-formed refs; legacy evidence has none', () => {
    const ident = screenAuditIdentity({ id: 'audit-9', finishedAt: '2026-10-27T00:00:00.000Z' }, []);
    assert.equal(boundScreenAuditId([screenAuditApiEvidence(ident)]), 'audit-9');
    assert.equal(boundScreenAuditId(null), null);
    assert.equal(boundScreenAuditId([{ endpoint: 'buildEvidencePackFromDb', payloadRef: 'evidence-pack:aggregates', requestedAt: '' }]), null);
    assert.equal(boundScreenAuditId([{ endpoint: 'screenAuditIdentity', payloadRef: 'screen-audit:x:nothex', requestedAt: '' }]), null);
  });
});

describe('button eligibility', () => {
  const done = { state: 'DONE', status: 'FAIL' };
  const ok = { audit: done, pages: [{ path: '/', viewport: 'MOBILE', status: 'FAIL' }], errorScreens: [], reviewRunning: false, permitted: true };
  it('enables after a finished audit with a measured page', () => {
    assert.deepEqual(auditJuryEligibility(ok), { ok: true });
  });
  it('disables with a Korean reason', () => {
    const cases: [Partial<typeof ok> & Record<string, unknown>, string][] = [
      [{ audit: null }, 'NO_AUDIT'],
      [{ audit: { state: 'RUNNING', status: null } as never }, 'AUDIT_RUNNING'],
      [{ permitted: false }, 'NOT_PERMITTED'],
      [{ reviewRunning: true }, 'REVIEW_RUNNING'],
      [{ pages: [{ path: '/', viewport: 'MOBILE', status: 'BLOCKED' }, { path: '/a', viewport: 'MOBILE', status: 'ERROR' }, { path: '/b', viewport: 'MOBILE', status: 'NOT_TESTED' }] }, 'NO_MEASURED_PAGES'],
      [{ errorScreens: [{ path: '/', viewport: 'MOBILE' }] }, 'NO_MEASURED_PAGES'],
      [{ pages: [] }, 'NO_MEASURED_PAGES'],
    ];
    for (const [patch, reason] of cases) {
      const r = auditJuryEligibility({ ...ok, ...patch } as typeof ok);
      assert.equal(r.ok, false, reason);
      if (!r.ok) {
        assert.equal(r.reason, reason);
        assert.match(r.text, /[가-힣]/);
      }
    }
  });
});

describe('progress and navigation', () => {
  it('shows 화면 심사 → 위원 심사 → 개선 제안', () => {
    assert.deepEqual(auditJurySteps('running').map((s) => [s.label, s.state]), [['화면 심사', 'done'], ['위원 심사', 'active'], ['개선 제안', 'todo']]);
    assert.deepEqual(auditJurySteps('done').map((s) => s.state), ['done', 'done', 'done']);
    assert.equal(auditJurySteps('failed')[1].state, 'failed');
    assert.equal(auditJuryResultHref('r1'), '/jury/reviews/r1#improvement-proposals');
    assert.equal(read('src/app/(jury)/jury/review-tabs-ui.tsx').includes('id="improvement-proposals"'), true);
  });
});

describe('wiring (source)', () => {
  it('button sits above the latest audit results and only runs on click', () => {
    const section = read('src/app/(jury)/jury/screen-audit-section.tsx');
    assert.ok(section.indexOf('<AuditJuryReviewButton') > 0);
    assert.ok(section.indexOf('<AuditJuryReviewButton') < section.indexOf('최근 심사\n'));
    const btn = read('src/app/(jury)/jury/AuditJuryReviewButton.tsx');
    assert.equal(btn.includes('이 결과로 위원 심사하기'), true);
    assert.equal(btn.includes('variant="primary"'), true);
    assert.equal(/useEffect\([^)]*props\.start/.test(btn), false);
  });
  it('one click = default-period collection + background review with the guards', () => {
    const actions = read('src/app/(jury)/jury/actions.ts');
    const fn = actions.slice(actions.indexOf('export async function startAuditJuryReviewAction'), actions.indexOf('export async function pollAuditJuryReviewAction'));
    for (const token of ['getJuryActor()', 'isDeletedConnection', 'enforceOwnershipGate', "feature: 'review.execute'", 'defaultEvidencePeriod()', 'startConnectedServiceReview', 'after(work)', 'tenantReviewCore', 'clientTenantId: null']) {
      assert.equal(fn.includes(token), true, token);
    }
    const poll = actions.slice(actions.indexOf('export async function pollAuditJuryReviewAction'));
    assert.equal(poll.includes('tenantId: actor.tenantId'), true);
    assert.equal(poll.includes('isStaleRunningReview'), true);
    const review = read('src/lib/jury-product/connected-service-review.ts');
    assert.equal(review.includes('boundScreenAuditId(evidenceRow.apiEvidence)'), true);
  });
  it('manual 심사 근거 수집 / 심사 실행 stay, inside 고급', () => {
    for (const file of ['src/app/(jury)/jury/service-operations-ui.tsx', 'src/app/(jury)/jury/service-onboarding-ui.tsx']) {
      const src = read(file);
      for (const kind of ['collect-evidence', 'run-review']) {
        const at = src.indexOf(`data-advanced="${kind}"`);
        assert.ok(at > 0, `${file} ${kind}`);
        assert.ok(src.slice(at, at + 200).includes('고급'), `${file} ${kind} summary`);
      }
      assert.equal(src.includes('label="심사 실행"'), true);
    }
    assert.equal(read('src/app/(jury)/jury/service-operations-ui.tsx').includes('심사 근거 수집'), true);
  });
  it('does not touch /ai-review-board', () => {
    assert.equal(read('src/lib/jury-product/evidence-builder.ts').includes("from '@/lib/ai-review-board/types'"), true);
  });
});
