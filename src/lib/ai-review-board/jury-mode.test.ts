/**
 * I-089~I-093: Jury-only guidelines are isolated from /ai-review-board.
 * Run: npx tsx --test src/lib/ai-review-board/jury-mode.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { buildStubEvidencePack } from './evidence-pack';
import { createMockReviewBoardLlm } from './mock-llm';
import { runReviewBoardPipeline } from './orchestrator';
import { EXPECTED_PIPELINE_LLM_CALLS } from './revision-quality';
import { formatEvidencePackForPrompt } from './format-evidence-prompt';
import { PERSONA_SYSTEM } from './personas';
import { JURY_MEMBER_SCOPE, JURY_PROPOSAL_LIMITS, isJuryMode, juryUserAddon, jurySystemAddon, parseJuryProposals } from './jury-mode';
import { COMMITTEE_ANALYSTS } from './types';

async function run(evidence: ReturnType<typeof buildStubEvidencePack>, runId: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jury-mode-'));
  return runReviewBoardPipeline({ rootDir: root, llm: createMockReviewBoardLlm(), evidence, maxCalls: 40, runId });
}

describe('jury mode isolation', () => {
  it('board evidence gets no prompt additions (prompts stay byte-identical)', () => {
    const board = buildStubEvidencePack();
    assert.equal(isJuryMode(board), false);
    for (const stage of ['independent', 'debate', 'revision', 'chairman'] as const) assert.equal(juryUserAddon(board, stage), '');
    for (const id of [...COMMITTEE_ANALYSTS, 'F', 'Chairman'] as const) assert.equal(jurySystemAddon(board, id), '');
    assert.equal(formatEvidencePackForPrompt(board).includes('reviewMode'), false);
  });

  it('jury evidence adds scope + principles but keeps the shared role prompt', () => {
    const jury = { ...buildStubEvidencePack(), reviewMode: 'jury' as const };
    for (const id of [...COMMITTEE_ANALYSTS, 'F', 'Chairman'] as const) {
      assert.ok(PERSONA_SYSTEM[id].length > 0);
      assert.ok(jurySystemAddon(jury, id).includes(JURY_MEMBER_SCOPE[id]));
    }
    assert.ok(JURY_MEMBER_SCOPE.B.includes('기존 트렌드'));
    assert.ok(JURY_MEMBER_SCOPE.E.includes('기존 커뮤니티'));
    assert.ok(juryUserAddon(jury, 'debate').includes('mobileImpact'));
    assert.ok(juryUserAddon(jury, 'chairman').includes('evidenceBasis'));
  });

  it('board pipeline output has no Jury fields and still uses 32 calls', async () => {
    const r = await run(buildStubEvidencePack(), 'board-run');
    assert.equal(r.status, 'completed');
    assert.equal(r.budget.usedCalls, EXPECTED_PIPELINE_LLM_CALLS);
    assert.equal(r.final && 'improvementProposals' in r.final, false);
    assert.equal(r.debate.some((d) => 'proposalReviews' in d), false);
    assert.equal(r.independent.some((i) => 'juryProposals' in i), false);
  });

  it('jury pipeline adds proposals with the same judge count and 32 calls', async () => {
    const evidence = {
      ...buildStubEvidencePack(),
      reviewMode: 'jury' as const,
      screenAuditFindings: { auditId: 'a1', finishedAt: null, findings: [{ rule: 'TOUCH_TARGET', area: 'MOBILE', severity: 'HIGH', status: 'FAIL', viewport: 'MOBILE', path: '/', message: '버튼 높이 32px' }] },
    };
    const r = await run(evidence, 'jury-run');
    assert.equal(r.status, 'completed');
    assert.equal(r.budget.usedCalls, EXPECTED_PIPELINE_LLM_CALLS);
    assert.equal(r.independent.length, 5);
    assert.ok(r.critic);
    const proposals = r.final?.improvementProposals ?? [];
    assert.equal(proposals[0].evidenceBasis, 'observed');
    assert.equal(proposals[0].unverified, false);
    assert.equal(proposals[1].evidenceBasis, 'general');
    assert.equal(proposals[1].unverified, true);
    assert.ok(r.debate.every((d) => Array.isArray(d.proposalReviews)));
  });
});

describe('parseJuryProposals', () => {
  it('drops malformed items, caps count/length, forces general → unverified', () => {
    const long = '가'.repeat(1000);
    const raw = [
      null,
      'text',
      { problem: '', steps: ['x'] },
      { problem: '단계 없음', steps: [] },
      { problem: long, evidence: '', evidenceBasis: 'observed', steps: ['a', 1, 'b'], priority: 'urgent', unverified: false },
      ...Array.from({ length: 10 }, (_, i) => ({ problem: `p${i}`, evidence: 'e', evidenceBasis: 'observed', steps: ['s'], priority: '높음' })),
    ];
    const out = parseJuryProposals(raw);
    assert.equal(out.length, JURY_PROPOSAL_LIMITS.items);
    assert.ok(out[0].problem.length <= JURY_PROPOSAL_LIMITS.text);
    assert.equal(out[0].evidenceBasis, 'general');
    assert.equal(out[0].unverified, true);
    assert.equal(out[0].priority, '중간');
    assert.deepEqual(out[0].steps, ['a', 'b']);
    assert.equal(out[1].priority, '높음');
    assert.deepEqual(parseJuryProposals(undefined), []);
  });
});
