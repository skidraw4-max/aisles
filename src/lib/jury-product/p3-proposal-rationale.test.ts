/**
 * P3 (JD t568): proposal goal/rationale + 수정 불필요 items. Older results render unchanged.
 * Run: npx tsx --test src/lib/jury-product/p3-proposal-rationale.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JURY_NO_CHANGE_LIMIT, juryUserAddon, parseJuryNoChangeItems, parseJuryProposals } from '../ai-review-board/jury-mode';
import { buildStubEvidencePack } from '../ai-review-board/evidence-pack';
import type { FinalReport, JuryImprovementProposal } from '../ai-review-board/types';
import { surfaceFromFinal } from './review-core';
import { buildProposalView } from './proposal-view-model';
import { JURY_CONTRACT_VERSION, JURY_CORE_CONTRACT_VERSION } from './records';

const base = { problem: '검색창이 작음', evidence: '화면 심사', evidenceBasis: 'observed', steps: ['높이 44px'], priority: '높음', expectedEffect: '', verification: [], unverified: false, dissent: '' };
const final = (extra: Partial<FinalReport>) => ({ statusSummary: 's', topProblems: [], improvements: [], needsFurtherVerification: [], ...extra }) as unknown as FinalReport;

test('rationale fields parse; absent stays absent (old shape)', () => {
  const [old] = parseJuryProposals([base]);
  assert.equal('goal' in old, false);
  assert.equal('rationaleType' in old, false);
  const [p] = parseJuryProposals([{ ...base, goal: '제품 찾기 쉽게', rationaleType: 'siteTrait', rationale: '핵심 작업이 제품 찾기' }], { siteContext: true });
  assert.equal(p.goal, '제품 찾기 쉽게');
  assert.equal(p.rationaleType, 'siteTrait');
  const [bad] = parseJuryProposals([{ ...base, rationaleType: 'brand', rationale: 'x' }]);
  assert.equal(bad.rationaleType, 'general');
});

test('siteTrait is downgraded to general without site context', () => {
  const [p] = parseJuryProposals([{ ...base, rationaleType: 'siteTrait', rationale: 'r' }], { siteContext: false });
  assert.equal(p.rationaleType, 'general');
});

test('noChangeItems: needs area+reason, capped', () => {
  const items = parseJuryNoChangeItems([{ area: '' , reason: 'x' }, ...Array.from({ length: 9 }, (_, i) => ({ area: `영역${i}`, reason: '근거 없음', evidence: '' }))]);
  assert.equal(items.length, JURY_NO_CHANGE_LIMIT);
  assert.deepEqual(parseJuryNoChangeItems('x'), []);
});

test('surface + view: noChange shown; secret withholds both', () => {
  const s = surfaceFromFinal(final({ improvementProposals: [base as JuryImprovementProposal], noChangeItems: [{ area: '메인 배너 색', reason: '브랜드 톤 유지', evidence: '' }] }));
  assert.equal(s.noChangeItems?.length, 1);
  const v = buildProposalView(s);
  assert.equal(v.noChange[0].area, '메인 배너 색');
  assert.equal(v.proposals[0].rationaleLabel, null);
  const empty = buildProposalView({ ...s, improvementProposals: [] });
  assert.equal(empty.state, 'EMPTY');
  assert.equal(empty.noChange.length, 1);
  const sec = surfaceFromFinal(final({ improvementProposals: [base as JuryImprovementProposal], noChangeItems: [{ area: 'a', reason: 'password=x', evidence: '' }] }));
  assert.equal(sec.improvementProposalsOmitted, 'SECRET');
  assert.deepEqual(sec.noChangeItems, []);
});

test('older stored results render as before; board final has no noChangeItems', () => {
  const legacy = buildProposalView({ statusSummary: 's', topProblems: ['기존 문제'] });
  assert.equal(legacy.state, 'LEGACY');
  assert.deepEqual(legacy.noChange, []);
  const pre = buildProposalView({ improvementProposals: [base], improvementProposalsOmitted: null });
  assert.equal(pre.state, 'READY');
  assert.deepEqual(pre.noChange, []);
  assert.equal('noChangeItems' in surfaceFromFinal(final({})), false);
});

test('contract versions unchanged; chairman addon asks for noChangeItems only in Jury', () => {
  assert.equal(JURY_CONTRACT_VERSION, 'jury-product-v1');
  assert.equal(JURY_CORE_CONTRACT_VERSION, 'v9.x-ev020');
  assert.ok(juryUserAddon({ ...buildStubEvidencePack(), reviewMode: 'jury' }, 'chairman').includes('noChangeItems'));
  assert.equal(juryUserAddon(buildStubEvidencePack(), 'chairman'), '');
});
