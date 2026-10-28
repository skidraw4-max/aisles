/**
 * I-089~I-093: Jury improvement proposals — surface, display fixtures (old + new), screen-audit reuse.
 * Run: npx tsx --test src/lib/jury-product/i089-improvement-proposals.test.ts
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import type { FinalReport, JuryImprovementProposal } from '../ai-review-board/types';
import { surfaceFromFinal } from './review-core';
import { buildProposalView, PROPOSAL_NOTICES } from './proposal-view-model';
import { loadScreenAuditEvidence, toScreenAuditEvidence } from './services/screen-audit/review-evidence';

const proposal = (extra: Partial<JuryImprovementProposal> = {}): JuryImprovementProposal => ({
  problem: '모바일에서 저장 버튼이 작음', evidence: '화면 심사 TOUCH_TARGET (MOBILE /write)', evidenceBasis: 'observed',
  steps: ['버튼 min-height를 44px로 올린다'], priority: '높음', expectedEffect: '오터치 감소', verification: ['모바일 화면 심사 재실행'],
  unverified: false, dissent: '', ...extra,
});

function final(extra: Partial<FinalReport> = {}): FinalReport {
  return {
    statusSummary: 's', overallTrendScore: null, dimensionScores: [], topProblems: ['top'], improvements: [], expectedUserEffect: '',
    expectedDifficulty: '', risk: '', improvementEvidence: [], opinionDifferences: [], confidence: 0.5, needsFurtherVerification: [],
    ...extra,
  } as FinalReport;
}

// Backward-compat fixtures: a finalSurface stored before I-091 and one stored after.
const LEGACY_SURFACE = { statusSummary: 's', topProblems: ['기존 문제'], expectedUserEffect: '', risk: '', dimensionEvidence: [], supportedClaims: [], partiallySupportedClaims: [], hypotheses: [] };
const NEW_SURFACE = { ...LEGACY_SURFACE, improvementProposals: [proposal(), proposal({ problem: '빈 상태 안내 부족', evidence: '', evidenceBasis: 'general', unverified: true })], improvementProposalsOmitted: null };

test('surfaceFromFinal: board-style final (no proposals) keeps the old surface shape', () => {
  const s = surfaceFromFinal(final());
  assert.equal('improvementProposals' in s, false);
});

test('surfaceFromFinal: jury proposals are normalized and secrets withheld', () => {
  const s = surfaceFromFinal(final({ improvementProposals: [proposal(), { problem: 'bad' } as unknown as JuryImprovementProposal] }));
  assert.equal(s.improvementProposals?.length, 1);
  assert.equal(s.improvementProposalsOmitted, null);
  const secret = surfaceFromFinal(final({ improvementProposals: [proposal({ evidence: 'password=x' })] }));
  assert.deepEqual(secret.improvementProposals, []);
  assert.equal(secret.improvementProposalsOmitted, 'SECRET');
});

test('display: legacy result renders problems as 미검증 with a notice', () => {
  const v = buildProposalView(LEGACY_SURFACE);
  assert.equal(v.state, 'LEGACY');
  assert.equal(v.notice, PROPOSAL_NOTICES.LEGACY);
  assert.deepEqual(v.findings, [{ problem: '기존 문제', evidence: '', status: '미검증' }]);
  assert.deepEqual(v.proposals, []);
});

test('display: new result renders findings, proposals, checklist; general advice is 미검증', () => {
  const v = buildProposalView(NEW_SURFACE);
  assert.equal(v.state, 'READY');
  assert.equal(v.findings[0].status, '관찰됨');
  assert.equal(v.findings[1].status, '미검증');
  assert.equal(v.proposals[1].basisLabel, '일반 권고');
  assert.equal(v.proposals[1].statusLabel, '미검증');
  assert.deepEqual(v.checklist[0], { item: '모바일 화면 심사 재실행', problem: '모바일에서 저장 버튼이 작음' });
});

test('display: empty / omitted / garbage surfaces never throw', () => {
  assert.equal(buildProposalView({ ...LEGACY_SURFACE, improvementProposals: [] }).state, 'EMPTY');
  assert.equal(buildProposalView({ ...LEGACY_SURFACE, improvementProposals: [], improvementProposalsOmitted: 'SECRET' }).state, 'OMITTED');
  assert.equal(buildProposalView(null).state, 'LEGACY');
  assert.equal(buildProposalView({ improvementProposals: 'x' }).state, 'EMPTY');
});

test('I-093: screen-audit evidence reuses stored findings, tenant-scoped, sorted and capped', async () => {
  const calls: unknown[] = [];
  const db = {
    juryVisualAudit: { findFirst: async (a: unknown) => { calls.push(a); return { id: 'au1', finishedAt: new Date('2026-10-01T00:00:00Z') }; } },
    juryAuditFinding: { findMany: async (a: unknown) => { calls.push(a); return Array.from({ length: 30 }, (_, i) => ({ rule: `R${i}`, area: 'A', severity: i === 29 ? 'HIGH' : 'LOW', status: 'WARN', viewport: 'MOBILE', message: 'm'.repeat(500), page: { path: '/' } })); } },
  };
  const ev = await loadScreenAuditEvidence(db, 't1', 'c1');
  assert.equal(ev?.findings.length, 20);
  assert.equal(ev?.findings[0].rule, 'R29');
  assert.equal(ev?.findings[0].message.length, 200);
  assert.deepEqual((calls[0] as { where: unknown }).where, { tenantId: 't1', connectionId: 'c1', state: 'DONE' });
  assert.deepEqual((calls[1] as { where: unknown }).where, { tenantId: 't1', auditId: 'au1' });
  assert.equal(await loadScreenAuditEvidence({}, 't1', 'c1'), null);
  assert.equal(await loadScreenAuditEvidence({ juryVisualAudit: { findFirst: async () => { throw new Error('db'); } }, juryAuditFinding: { findMany: async () => [] } }, 't', 'c'), null);
  assert.equal(toScreenAuditEvidence({ id: 'x', finishedAt: null }, [{ rule: 'r', area: 'a', severity: 'LOW', status: 'WARN', viewport: 'D', message: 'password=1' }]), null);
});

test('I-093 + I-089 wiring: Jury sets reviewMode only in review-core; screen findings join only the Jury review input', () => {
  const core = readFileSync(new URL('./review-core.ts', import.meta.url), 'utf8');
  assert.ok(core.includes("reviewMode: 'jury'"));
  const csr = readFileSync(new URL('./connected-service-review.ts', import.meta.url), 'utf8');
  assert.ok(csr.includes('loadScreenAuditEvidence(prisma, actor.tenantId, connection.id, boundScreenAuditId(evidenceRow.apiEvidence))'));
  const dir = new URL('../../app/(root)/admin/ai-review-board/', import.meta.url);
  const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f));
  assert.ok(files.length > 0);
  for (const f of files) assert.equal(readFileSync(new URL(f, dir), 'utf8').includes('reviewMode'), false, f);
});
