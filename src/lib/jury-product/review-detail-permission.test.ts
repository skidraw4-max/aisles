/**
 * Track B F2: review detail splits review, improvement, and agent / Change Gate data.
 * DB-free. Access booleans come from guardReviewFeature on the review's own service.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import {
  projectReviewConsole,
  restrictReviewConsoleScreen,
  reviewConsoleSections,
  type ReviewConsoleScreen,
} from './review-console';
import { authorizeJuryServiceFeature } from './service-feature-authorization';
import type { ServiceGrantRow } from './service-member-management';
import type { JuryFinalSurface } from './records';

const TENANT = 'trackb-review';
const CONN = 'trackb-review-conn';
const OTHER_CONN = 'trackb-review-other';
const NOW = '2026-10-19T06:00:00.000Z';
const owner: JuryActor = { ok: true, userId: 'trackb-owner', tenantId: TENANT, role: 'OWNER', membershipId: 'trackb-owner-m' };

const REVIEW_KEYS = [
  'reviewId', 'tenantId', 'status', 'completedAt', 'decision', 'decisionMeaning', 'summary', 'topProblems',
  'expectedUserEffect', 'risk', 'evidenceId', 'measured', 'dimensionEvidence', 'supportedClaims',
  'partiallySupportedClaims', 'hypotheses', 'humanDecision', 'humanChoices',
  // phase 3: display-only committee view belongs to the review block
  'memberOpinions', 'memberOpinionsOmitted', 'opinionDifferences', 'disputedPoints', 'confidence',
  // RM-02 AGG-01: display aggregation belongs to the review block
  'display',
] as const;
const IMPROVEMENT_KEYS = [
  'improvementTask', 'canCreateImprovement', 'canHandoff', 'nextImprovement', 'canCreateReReviewImprovement',
  'nextApproval', 'canApproveReReviewAgent', 'canHandoffReReviewAgent', 'nextSecondImprovement',
  'canCreateSecondImprovement', 'nextSecondApproval', 'canApproveSecondImprovement', 'canHandoffSecondImprovement',
  'nextLaterImprovement', 'canCreateLaterImprovement', 'nextLaterApproval', 'canApproveLaterImprovement',
  'canHandoffLaterImprovement',
] as const;
const AGENT_KEYS = [
  'agentExecution', 'canRun', 'changeGate', 'canRunChangeGate', 'reReview', 'canRunReReview', 'nextAgentExecution',
  'canRunReReviewAgent', 'nextChangeGate', 'canRunReReviewChangeGate', 'nextSecondReReview', 'canRunSecondReReview',
  'secondReReviewResultId', 'secondReReviewDecision', 'nextSecondAgentExecution', 'nextSecondChangeGate',
  'canRunSecondChangeGate', 'nextLaterReReview', 'canRunLaterReReview', 'nextLaterAgentExecution', 'canRunLaterAgent',
  'nextLaterChangeGate', 'canRunLaterChangeGate', 'nextFollowingReReview', 'canRunFollowingReReview',
] as const;
/** Create buttons post a re-review result id that lives in the Change Gate block. */
const NEEDS_BOTH = ['canCreateReReviewImprovement', 'canCreateSecondImprovement', 'canCreateLaterImprovement'] as const;
/** The general handoff opens an agent execution, so like the re-review handoffs it needs agent.execute too. */
const NEEDS_IMPROVEMENT_AND_AGENT = [...NEEDS_BOTH, 'canHandoff', 'canHandoffReReviewAgent', 'canHandoffSecondImprovement', 'canHandoffLaterImprovement'] as const;

const SECRET_IDS = [
  'trackb-task', 'trackb-exec', 'trackb-gate', 'trackb-rereview', 'trackb-rr-result', 'trackb-next-task',
  'trackb-next-exec', 'trackb-next-gate', 'trackb-second-rr', 'trackb-second-result', 'trackb-second-task',
  'trackb-second-exec', 'trackb-second-gate', 'trackb-later-rr', 'trackb-later-result', 'trackb-later-task',
  'trackb-later-exec', 'trackb-later-gate', 'trackb-following-rr', 'trackb-following-result',
  'agent changed file', 'agent summary', 'unit-test-name', 'GATE_REASON', 'FOLLOWING_SUMMARY',
];

function surface(summary = 'steady'): JuryFinalSurface {
  return {
    statusSummary: summary,
    topProblems: ['gap'],
    expectedUserEffect: 'effect',
    risk: 'risk',
    dimensionEvidence: ['measured sentence'],
    supportedClaims: ['supported'],
    partiallySupportedClaims: ['partial'],
    hypotheses: ['hypothesis'],
  };
}

type ProjectionInput = Parameters<typeof projectReviewConsole>[0];

function fullInput(actor: JuryActor = owner): ProjectionInput {
  return {
    actor,
    result: { id: 'trackb-review-1', tenantId: TENANT, expectedDecision: 'VERIFY', finalSurface: surface(), completedAt: NOW },
    status: 'COMPLETED',
    evidenceId: 'trackb-evidence',
    metrics: [{ id: 'm1', metric: 'newUsersLast7d', value: 3, availability: 'AVAILABLE' }],
    humanDecision: 'VERIFY',
    improvementTask: { id: 'trackb-task', taskType: 'VERIFICATION' },
    agentExecution: {
      id: 'trackb-exec', status: 'COMPLETED', agent: 'CURSOR', startedAt: NOW, finishedAt: NOW,
      summary: 'agent summary', changedFiles: ['agent changed file'], testsRun: ['unit-test-name'], testsPassed: true,
    },
    changeGate: { id: 'trackb-gate', status: 'APPROVED', errorCode: null, discrepancy: true, reasons: ['GATE_REASON'] },
    reReview: { id: 'trackb-rereview', status: 'EXECUTED', reviewRequestId: 'trackb-rr-request', reviewResultId: 'trackb-rr-result', decision: 'VERIFY', completedAt: NOW },
    nextImprovement: { id: 'trackb-next-task', taskType: 'VERIFICATION', status: 'OPEN' },
    nextApproval: 'VERIFY',
    nextAgentExecution: { id: 'trackb-next-exec', status: 'COMPLETED', agent: 'CURSOR' },
    nextChangeGate: { id: 'trackb-next-gate', status: 'APPROVED', errorCode: null },
    nextSecondReReview: { id: 'trackb-second-rr', status: 'EXECUTED' },
    secondReReviewResultId: 'trackb-second-result',
    secondReReviewDecision: 'VERIFY',
    nextSecondImprovement: { id: 'trackb-second-task', taskType: 'VERIFICATION', status: 'OPEN' },
    nextSecondApproval: 'VERIFY',
    nextSecondAgentExecution: { id: 'trackb-second-exec', status: 'COMPLETED', agent: 'CURSOR' },
    nextSecondChangeGate: { id: 'trackb-second-gate', status: 'APPROVED', errorCode: null },
    nextLaterReReview: { id: 'trackb-later-rr', status: 'EXECUTED', reviewResultId: 'trackb-later-result', decision: 'VERIFY' },
    nextLaterImprovement: { id: 'trackb-later-task', taskType: 'VERIFICATION', status: 'OPEN' },
    nextLaterApproval: 'VERIFY',
    nextLaterAgentExecution: { id: 'trackb-later-exec', status: 'COMPLETED', agent: 'CURSOR' },
    nextLaterChangeGate: { id: 'trackb-later-gate', status: 'APPROVED', errorCode: null },
    nextFollowingReReview: { id: 'trackb-following-rr', status: 'EXECUTED', reviewResultId: 'trackb-following-result', decision: 'ACCEPT', surface: surface('FOLLOWING_SUMMARY') },
  };
}

function fullScreen(): ReviewConsoleScreen {
  const projected = projectReviewConsole(fullInput());
  assert.equal(projected.ok, true);
  if (!projected.ok) throw new Error('projection failed');
  const flags = Object.fromEntries(
    Object.entries(projected.screen).filter(([, value]) => typeof value === 'boolean').map(([key]) => [key, true]),
  );
  return { ...projected.screen, ...flags } as ReviewConsoleScreen;
}

function emptyValue(value: unknown): boolean {
  return value === null || value === false;
}

test('every screen field belongs to exactly one block', () => {
  const keys = Object.keys(fullScreen()).sort();
  const classified = [...REVIEW_KEYS, ...IMPROVEMENT_KEYS, ...AGENT_KEYS];
  assert.equal(new Set(classified).size, classified.length);
  assert.deepEqual([...classified].sort(), keys);
});

test('review.read only keeps the review block and empties improvement and agent blocks', () => {
  const full = fullScreen();
  const shown = restrictReviewConsoleScreen(full, { improvement: false, agent: false });
  for (const key of REVIEW_KEYS) assert.deepEqual(shown[key], full[key], key);
  for (const key of [...IMPROVEMENT_KEYS, ...AGENT_KEYS]) assert.equal(emptyValue(shown[key]), true, key);
  const json = JSON.stringify(shown);
  for (const token of SECRET_IDS) assert.equal(json.includes(token), false, token);
  const sections = reviewConsoleSections(shown, { improvement: false, agent: false });
  assert.deepEqual(Object.values(sections).filter(Boolean), []);
});

test('review.read + improvement.read shows improvement and hides agent and Change Gate', () => {
  const full = fullScreen();
  const shown = restrictReviewConsoleScreen(full, { improvement: true, agent: false });
  for (const key of REVIEW_KEYS) assert.deepEqual(shown[key], full[key], key);
  for (const key of IMPROVEMENT_KEYS) {
    if ((NEEDS_IMPROVEMENT_AND_AGENT as readonly string[]).includes(key)) assert.equal(shown[key], false, key);
    else assert.deepEqual(shown[key], full[key], key);
  }
  for (const key of AGENT_KEYS) assert.equal(emptyValue(shown[key]), true, key);
  const json = JSON.stringify(shown);
  for (const token of ['trackb-exec', 'trackb-gate', 'trackb-rereview', 'trackb-rr-result', 'trackb-second-result', 'trackb-later-result', 'agent summary', 'agent changed file', 'unit-test-name', 'GATE_REASON', 'FOLLOWING_SUMMARY']) {
    assert.equal(json.includes(token), false, token);
  }
  assert.equal(json.includes('trackb-next-task'), true);
  const sections = reviewConsoleSections(shown, { improvement: true, agent: false });
  for (const name of ['ReReviewAgentHandoff', 'SecondImprovement', 'SecondImprovementApproval', 'SecondImprovementHandoff', 'LaterImprovement', 'LaterImprovementApproval', 'LaterImprovementHandoff', 'ReReviewNextImprovement'] as const) {
    assert.equal(sections[name], true, name);
  }
  for (const name of ['HumanChangeGate', 'HumanReReview', 'ReReviewAgentRun', 'ReReviewChangeGate', 'SecondReReview', 'SecondChangeGate', 'LaterReReview', 'LaterAgentRun', 'LaterChangeGate', 'FollowingReReview'] as const) {
    assert.equal(sections[name], false, name);
  }
  const noNext = restrictReviewConsoleScreen({ ...full, nextImprovement: null }, { improvement: true, agent: false });
  const noNextSections = reviewConsoleSections(noNext, { improvement: true, agent: false });
  assert.equal(noNextSections.ReReviewNextImprovement, false);
  assert.equal(noNextSections.HumanReReview, false);
});

test('review.read + agent.execute shows agent and Change Gate and hides improvement', () => {
  const full = fullScreen();
  const shown = restrictReviewConsoleScreen(full, { improvement: false, agent: true });
  for (const key of REVIEW_KEYS) assert.deepEqual(shown[key], full[key], key);
  for (const key of AGENT_KEYS) assert.deepEqual(shown[key], full[key], key);
  for (const key of IMPROVEMENT_KEYS) assert.equal(emptyValue(shown[key]), true, key);
  const json = JSON.stringify(shown);
  for (const token of ['trackb-task"', 'trackb-next-task', 'trackb-second-task', 'trackb-later-task']) {
    assert.equal(json.includes(token), false, token);
  }
  const sections = reviewConsoleSections(shown, { improvement: false, agent: true });
  assert.equal(sections.HumanChangeGate, true);
  assert.equal(sections.HumanReReview, true);
  assert.equal(sections.ReReviewNextImprovement, false);
  assert.equal(sections.SecondImprovement, false);
  assert.equal(sections.LaterImprovementHandoff, false);
  assert.equal(sections.FollowingReReview, true);
});

test('all three permissions keep the existing screen and every existing section', () => {
  const full = fullScreen();
  assert.deepEqual(restrictReviewConsoleScreen(full, { improvement: true, agent: true }), full);
  const sections = reviewConsoleSections(full, { improvement: true, agent: true });
  const { ReReviewNextImprovement, ...existing } = sections;
  assert.equal(ReReviewNextImprovement, false);
  assert.equal(Object.values(existing).every(Boolean), true);
  assert.equal(Object.keys(existing).length, 17);
  assert.equal(Object.keys(sections).length, 18);
});

test('re-review results follow the Change Gate block they are stored on', () => {
  const full = fullScreen();
  for (const access of [{ improvement: true, agent: false }, { improvement: false, agent: false }]) {
    const shown = restrictReviewConsoleScreen(full, access);
    assert.equal(shown.reReview, null);
    assert.equal(shown.nextSecondReReview, null);
    assert.equal(shown.secondReReviewResultId, null);
    assert.equal(shown.secondReReviewDecision, null);
    assert.equal(shown.nextLaterReReview, null);
    assert.equal(shown.nextFollowingReReview, null);
    assert.equal(shown.canRunReReview || shown.canRunSecondReReview || shown.canRunLaterReReview || shown.canRunFollowingReReview, false);
  }
  const agent = restrictReviewConsoleScreen(full, { improvement: false, agent: true });
  assert.deepEqual(agent.reReview, full.reReview);
  assert.deepEqual(agent.nextFollowingReReview, full.nextFollowingReReview);
  assert.equal(agent.secondReReviewDecision, 'VERIFY');
});

test('the access booleans map to the existing service feature policy', () => {
  const membership = (userId: string) => ({ tenantId: TENANT, userId });
  const connection = { id: CONN, tenantId: TENANT };
  const grant = (userId: string, permission: ServiceGrantRow['permission'], connectionId = CONN): ServiceGrantRow => ({ id: `${userId}-${connectionId}`, tenantId: TENANT, connectionId, userId, permission });
  const decide = (role: 'OWNER' | 'ADMIN' | 'REVIEWER' | 'DEVELOPER' | 'VIEWER', grants: ServiceGrantRow[]) => {
    const userId = `trackb-${role.toLowerCase()}`;
    const actor: JuryActor = { ok: true, userId, tenantId: TENANT, role, membershipId: `${userId}-m` };
    const ok = (feature: 'review.read' | 'improvement.read' | 'agent.execute') =>
      authorizeJuryServiceFeature({ actor, membership: membership(userId), connection, grants, feature }).ok;
    return { review: ok('review.read'), improvement: ok('improvement.read'), agent: ok('agent.execute') };
  };
  assert.deepEqual(decide('VIEWER', [grant('trackb-viewer', 'AGENT')]), { review: false, improvement: false, agent: false });
  assert.deepEqual(decide('REVIEWER', [grant('trackb-reviewer', 'AGENT')]), { review: true, improvement: false, agent: false });
  assert.deepEqual(decide('DEVELOPER', [grant('trackb-developer', 'REVIEW')]), { review: true, improvement: false, agent: false });
  assert.deepEqual(decide('DEVELOPER', [grant('trackb-developer', 'IMPROVE')]), { review: true, improvement: true, agent: false });
  assert.deepEqual(decide('DEVELOPER', [grant('trackb-developer', 'AGENT')]), { review: true, improvement: true, agent: true });
  assert.deepEqual(decide('OWNER', [grant('trackb-owner', 'IMPROVE')]), { review: true, improvement: true, agent: false });
  assert.deepEqual(decide('ADMIN', [grant('trackb-admin', 'AGENT')]), { review: true, improvement: true, agent: true });
  assert.deepEqual(decide('OWNER', [grant('trackb-owner', 'AGENT', OTHER_CONN)]), { review: false, improvement: false, agent: false });
});

test('the detail page keeps review.read, then gates improvement and agent on the same review', () => {
  const page = readFileSync(path.resolve(process.cwd(), 'src/app/(jury)/jury/reviews/[reviewId]/page.tsx'), 'utf8');
  assert.equal(page.includes("guardReviewFeature(actor, reviewId, 'review.read')"), true);
  assert.equal(page.includes('access.ok ? await loadReviewConsole(actor, reviewId)'), true);
  assert.equal(page.includes("guardReviewFeature(actor, reviewId, 'improvement.read')"), true);
  assert.equal(page.includes("guardReviewFeature(actor, reviewId, 'agent.execute')"), true);
  assert.equal(page.includes('restrictReviewConsoleScreen(loaded.screen, blocks)'), true);
  assert.equal(page.includes('screen={loaded.screen}'), false);
  assert.equal(page.includes("'Not authorized'"), true);
  for (const name of ['HumanChangeGate', 'HumanReReview', 'ReReviewNextImprovement', 'ReReviewAgentHandoff', 'ReReviewAgentRun', 'ReReviewChangeGate', 'SecondReReview', 'SecondImprovement', 'SecondImprovementApproval', 'SecondImprovementHandoff', 'SecondChangeGate', 'LaterReReview', 'LaterImprovement', 'LaterImprovementApproval', 'LaterImprovementHandoff', 'LaterAgentRun', 'LaterChangeGate', 'FollowingReReview']) {
    assert.equal(page.includes(`{show.${name} ? <${name}Body screen={screen} /> : null}`), true, name);
  }
  assert.equal(page.includes('<ReviewDetailBody screen={screen} noted={noted} />'), true);
});

const ACCESS = [
  { improvement: false, agent: false },
  { improvement: true, agent: false },
  { improvement: false, agent: true },
  { improvement: true, agent: true },
] as const;

function readSource(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8').replace(/\r\n/g, '\n');
}

function between(source: string, start: string, end: string | null): string {
  const from = source.indexOf(start);
  const to = end === null ? source.length : source.indexOf(end);
  assert.equal(from >= 0 && to > from, true, `${start} -> ${end}`);
  return source.slice(from, to);
}

function projectAs(actor: JuryActor): ReviewConsoleScreen {
  const projected = projectReviewConsole({ ...fullInput(actor), nextApproval: undefined, nextSecondApproval: undefined, nextLaterApproval: undefined });
  assert.equal(projected.ok, true);
  if (!projected.ok) throw new Error('projection failed');
  return projected.screen;
}

const UI = 'src/app/(jury)/jury/ui.tsx';
const PAGE = 'src/app/(jury)/jury/reviews/[reviewId]/page.tsx';

test('t336 1: the Re-review section and its title render only with agent.execute', () => {
  const full = fullScreen();
  for (const access of ACCESS) {
    for (const base of [full, { ...full, nextImprovement: null }]) {
      const sections = reviewConsoleSections(restrictReviewConsoleScreen(base, access), access);
      assert.equal(sections.HumanReReview, access.agent, JSON.stringify(access));
    }
  }
  const body = between(readSource(UI), 'export function HumanReReviewBody', 'export function ReReviewNextImprovementBody');
  assert.equal(body.includes('<h2>재심사</h2>'), true);
  assert.equal(readSource(PAGE).includes('{show.HumanReReview ? <HumanReReviewBody screen={screen} /> : null}'), true);
});

test('t336 2: the next improvement block needs improvement.read, no agent.execute, and a task', () => {
  const full = fullScreen();
  for (const access of ACCESS) {
    const shown = reviewConsoleSections(restrictReviewConsoleScreen(full, access), access);
    assert.equal(shown.ReReviewNextImprovement, access.improvement && !access.agent, JSON.stringify(access));
    const none = reviewConsoleSections(restrictReviewConsoleScreen({ ...full, nextImprovement: null }, access), access);
    assert.equal(none.ReReviewNextImprovement, false, JSON.stringify(access));
  }
});

test('t336 3: the next improvement block renders only the task id, type, and status', () => {
  const ui = readSource(UI);
  const body = between(ui, 'export function ReReviewNextImprovementBody', 'export function HumanChangeGateBody');
  assert.equal(ui.indexOf('export function HumanReReviewBody') < ui.indexOf('export function ReReviewNextImprovementBody'), true);
  for (const field of ['<h2>다음 개선 작업</h2>', '{task.id}', '{task.taskType}', '{task.status}']) {
    assert.equal(body.includes(field), true, field);
  }
  for (const token of ['reReview', 'decision', 'Decision', 'reviewResultId', 'completedAt', 'agentExecution', 'AgentExecution', 'changeGate', 'Re-review', '<form', 'name=', 'Approve', 'Send to Agent', 'Run ', 'Create ', '결론', '재심사', '승인', '에이전트에 전달', '실행', '만들기']) {
    assert.equal(body.includes(token), false, token);
  }
  assert.deepEqual(body.match(/screen\.\w+/g), ['screen.nextImprovement']);
  const shown = restrictReviewConsoleScreen(fullScreen(), { improvement: true, agent: false });
  assert.deepEqual(shown.nextImprovement, { id: 'trackb-next-task', taskType: 'VERIFICATION', status: 'OPEN' });
  assert.equal(shown.reReview, null);
  assert.equal(shown.nextAgentExecution, null);
});

test('t336 4: with improvement.read and agent.execute the layout stays as before', () => {
  const sections = reviewConsoleSections(fullScreen(), { improvement: true, agent: true });
  assert.equal(sections.HumanReReview, true);
  assert.equal(sections.ReReviewNextImprovement, false);
  const reviewBody = between(readSource(UI), 'export function HumanReReviewBody', 'export function ReReviewNextImprovementBody');
  for (const label of ['다음 개선 작업', '{screen.nextImprovement.id}', '{screen.nextImprovement.taskType}', '{screen.nextImprovement.status}']) {
    assert.equal(reviewBody.includes(label), true, label);
  }
  assert.equal(readSource(PAGE).includes([
    '{show.HumanReReview ? <HumanReReviewBody screen={screen} /> : null}',
    '{show.ReReviewNextImprovement ? <ReReviewNextImprovementBody screen={screen} /> : null}',
    '{show.ReReviewAgentHandoff ? <ReReviewAgentHandoffBody screen={screen} /> : null}',
  ].join('\n            ')), true);
});

test('t336 5: approve buttons keep review.start plus improvement.read', () => {
  const flags = ['canApproveReReviewAgent', 'canApproveSecondImprovement', 'canApproveLaterImprovement'] as const;
  const reviewer: JuryActor = { ok: true, userId: 'trackb-reviewer', tenantId: TENANT, role: 'REVIEWER', membershipId: 'trackb-reviewer-m' };
  const viewer: JuryActor = { ok: true, userId: 'trackb-viewer', tenantId: TENANT, role: 'VIEWER', membershipId: 'trackb-viewer-m' };
  const asReviewer = projectAs(reviewer);
  const asViewer = projectAs(viewer);
  for (const flag of flags) {
    assert.equal(asReviewer[flag], true, flag);
    assert.equal(asViewer[flag], false, flag);
  }
  for (const access of ACCESS) {
    const shown = restrictReviewConsoleScreen(asReviewer, access);
    for (const flag of flags) assert.equal(shown[flag], access.improvement, `${flag} ${JSON.stringify(access)}`);
  }
  const ui = readSource(UI);
  assert.equal(between(ui, 'export function ReReviewAgentHandoffBody', 'export function HumanReReviewBody').includes('name="improvementTaskId" value={screen.nextImprovement.id}'), true);
  assert.equal(between(ui, 'export function SecondImprovementApprovalBody', 'export function SecondImprovementHandoffBody').includes('name="improvementTaskId" value={task.id}'), true);
  assert.equal(between(ui, 'export function LaterImprovementApprovalBody', 'export function LaterImprovementHandoffBody').includes('name="improvementTaskId" value={task.id}'), true);
});

test('t336 6: Run Re-review buttons stay agent.execute only', () => {
  const full = fullScreen();
  const flags = ['canRunReReview', 'canRunSecondReReview', 'canRunLaterReReview', 'canRunFollowingReReview'] as const;
  for (const access of ACCESS) {
    const shown = restrictReviewConsoleScreen(full, access);
    for (const flag of flags) assert.equal(shown[flag], access.agent, `${flag} ${JSON.stringify(access)}`);
    const sections = reviewConsoleSections(shown, access);
    for (const name of ['HumanReReview', 'SecondReReview', 'LaterReReview', 'FollowingReReview'] as const) {
      assert.equal(sections[name], access.agent, `${name} ${JSON.stringify(access)}`);
    }
  }
  const ui = readSource(UI);
  for (const [start, end] of [
    ['export function HumanReReviewBody', 'export function ReReviewNextImprovementBody'],
    ['export function SecondReReviewBody', 'export function SecondImprovementBody'],
    ['export function LaterReReviewBody', 'export function LaterImprovementBody'],
    ['export function FollowingReReviewBody', null],
  ] as const) {
    assert.equal(between(ui, start, end).includes('name="agentExecutionId"'), true, start);
  }
});

test('t336 7: re-review based create buttons keep improvement.read plus agent.execute', () => {
  const full = fullScreen();
  for (const access of ACCESS) {
    const shown = restrictReviewConsoleScreen(full, access);
    for (const flag of NEEDS_BOTH) assert.equal(shown[flag], access.improvement && access.agent, `${flag} ${JSON.stringify(access)}`);
  }
  const ui = readSource(UI);
  assert.equal(between(ui, 'export function HumanReReviewBody', 'export function ReReviewNextImprovementBody').includes('name="reReviewResultId" value={screen.reReview.reviewResultId}'), true);
  assert.equal(between(ui, 'export function SecondImprovementBody', 'export function SecondImprovementApprovalBody').includes('name="reReviewResultId" value={screen.secondReReviewResultId}'), true);
  assert.equal(between(ui, 'export function LaterImprovementBody', 'export function LaterImprovementApprovalBody').includes('name="reReviewResultId" value={review.reviewResultId}'), true);
});

test('t336 8: the general and re-review handoffs need improvement.read and agent.execute', () => {
  const full = fullScreen();
  const flags = ['canHandoffReReviewAgent', 'canHandoffSecondImprovement', 'canHandoffLaterImprovement'] as const;
  for (const access of ACCESS) {
    const shown = restrictReviewConsoleScreen(full, access);
    assert.equal(shown.canHandoff, access.improvement && access.agent, `canHandoff ${JSON.stringify(access)}`);
    for (const flag of flags) assert.equal(shown[flag], access.improvement && access.agent, `${flag} ${JSON.stringify(access)}`);
  }
  assert.equal(restrictReviewConsoleScreen(full, { improvement: true, agent: false }).canHandoff, false);
  assert.equal(restrictReviewConsoleScreen(full, { improvement: true, agent: true }).canHandoff, true);
  const ui = readSource(UI);
  assert.equal(between(ui, 'export function ReviewDetailBody', 'const INTAKE_AVAILABILITY').includes('name="improvementTaskId" value={screen.improvementTask.id}'), true);
  assert.equal(between(ui, 'export function ReReviewAgentHandoffBody', 'export function HumanReReviewBody').includes('에이전트에 전달'), true);
  assert.equal(between(ui, 'export function SecondImprovementHandoffBody', 'export function SecondChangeGateBody').includes('name="improvementTaskId" value={task.id}'), true);
  assert.equal(between(ui, 'export function LaterImprovementHandoffBody', 'export function LaterAgentRunBody').includes('name="improvementTaskId" value={task.id}'), true);
});

test('t336 existing ui source checks around the Re-review body still hold', () => {
  const ui = readSource(UI);
  // human-re-review.test.ts
  const gateBody = between(ui, 'export function HumanChangeGateBody', 'export function EvidenceBody');
  assert.equal(gateBody.includes('재심사'), false);
  const reviewBody = between(ui, 'export function HumanReReviewBody', 'export function HumanChangeGateBody');
  assert.equal(reviewBody.includes('재심사 실행'), true);
  assert.equal(reviewBody.includes('원래 심사'), true);
  assert.equal(reviewBody.includes('재심사:'), true);
  // rereview-improvement-bridge.test.ts
  assert.equal(reviewBody.includes('개선 작업 만들기'), true);
  assert.equal(reviewBody.includes('개선이 필요하지 않습니다'), true);
  assert.equal(reviewBody.includes('다음 개선 작업'), true);
  for (const label of ['에이전트에 전달', '변경 검사 실행', '자동 수정', '루프 실행']) {
    assert.equal(reviewBody.includes(label), false, label);
  }
  // rereview-agent-handoff.test.ts
  const handoff = between(ui, 'export function ReReviewAgentHandoffBody', 'export function HumanReReviewBody');
  assert.equal(handoff.includes('에이전트 작업 승인'), true);
  assert.equal(handoff.includes('에이전트에 전달'), true);
  assert.equal(handoff.includes('에이전트 대기 중'), true);
  for (const label of ['에이전트 실행', '에이전트 실행 요청', '변경 검사 실행', '재심사 실행', '자동 수정', '루프 실행']) {
    assert.equal(handoff.includes(label), false, label);
  }
  // rereview-agent-execution.test.ts
  const run = between(ui, 'export function ReReviewAgentRunBody', 'export function ReReviewChangeGateBody');
  assert.equal(run.includes('에이전트 실행'), true);
  assert.equal(run.includes('에이전트 진행 중'), true);
  assert.equal(run.includes('에이전트 완료'), true);
  for (const label of ['변경 검사 실행', '재심사', '자동 수정', '루프 실행', '다시 실행', '에이전트 실행 요청']) {
    assert.equal(run.includes(label), false, label);
  }
});

test('phase 3: review tabs keep the permission blocks verbatim inside the 이력 tab', () => {
  const page = readFileSync(path.resolve(process.cwd(), 'src/app/(jury)/jury/reviews/[reviewId]/page.tsx'), 'utf8').replace(/\r\n/g, '\n');
  const tabs = readFileSync(path.resolve(process.cwd(), 'src/app/(jury)/jury/review-tabs-ui.tsx'), 'utf8');
  assert.equal(page.includes('reviewTabFrom(query.tab)'), true);
  assert.equal(page.indexOf("{tab === 'history' ? (") < page.indexOf('{show.HumanChangeGate ? <HumanChangeGateBody screen={screen} /> : null}'), true);
  assert.equal(page.includes("{tab === 'summary' ? <ReviewDetailBody screen={screen} noted={noted} /> : null}"), true);
  for (const label of ['요약', '위원 의견', '검증 근거', '이력']) assert.equal(tabs.includes(`'${label}'`), true, label);
  for (const token of ['prisma', 'runReviewBoardPipeline', 'formData', "'use server'", 'action={']) {
    assert.equal(tabs.includes(token), false, token);
  }
});
