/**
 * Console projection of an improvement trace.
 * It renders fixture text and does not open a live review.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import type { JuryActor } from './access';
import { planImprovementTraceRead } from './improvement-trace';
import { improvementTraceQuery, projectImprovementTrace, traceReadHttpStatus, type ImprovementTraceScreen } from './improvement-trace-console';
import { assembleImprovementTrace, type TraceBundle } from './improvement-trace';
import { REWORD_CONSTRAINTS, REWORD_FIXTURE_OBJECTIVE } from './improvement-bridge';
import type { JuryMembership } from './records';

const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const COPY = 'workspace/mock-aisle/user-facing-copy.ts';
const COPY_TEXT = 'export const userFacingCopy = "측정된 Evidence가 직접 지지하는 범위의 문구만 사용합니다.";';

test('roles can open a trace and a forged tenant is ignored', () => {
  for (const role of ['OWNER', 'DEVELOPER', 'VIEWER'] as const) {
    const membership: JuryMembership = {
      id: 'mem-1',
      tenantId: 'tenant-a',
      userId: 'user-1',
      role,
      createdAt: '2026-10-02T00:00:00.000Z',
    };
    const planned = planImprovementTraceRead({ userId: 'user-1', memberships: [membership], clientTenantId: 'forged-tenant' });
    assert.equal(planned.ok, true, role);
    const actor: JuryActor = { ok: true, userId: 'user-1', tenantId: 'tenant-a', role, membershipId: 'mem-1' };
    const query = improvementTraceQuery(actor, 'task-1', 'forged-tenant');
    assert.equal(query.ok, true, role);
    if (query.ok) {
      assert.equal(query.input.clientTenantId, null);
      assert.equal(query.input.memberships[0]?.tenantId, 'tenant-a');
    }
  }
  const denied = improvementTraceQuery({ ok: false, reason: 'NO_MEMBERSHIP' }, 'task-1', 'forged-tenant');
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(traceReadHttpStatus(denied.reason), 403);
  assert.equal(traceReadHttpStatus('TENANT_MISMATCH'), 404);
  assert.equal(traceReadHttpStatus('NOT_FOUND'), 404);
});

test('the console shows each recorded trace state and keeps decision apart from effect', () => {
  const completed = screen(success());
  assert.equal(line(completed, 'Verification Re-review', 'Decision'), 'ACCEPT');
  assert.equal(line(completed, 'Effect Validation', 'Effect'), 'EFFECTIVE');
  assert.equal(line(completed, 'Verification', 'status'), 'RESOLVED');
  assert.equal(line(completed, 'Outcome', 'outcome'), 'COMPLETED');
  assert.equal(completed.timeline.some((item) => item.title === 'Scope Check' && item.status === 'SAFE'), true);
  assert.equal(completed.timeline.some((item) => item.title === 'Intent Check' && item.status === 'SAFE'), true);
  assert.equal(completed.timeline.some((item) => item.title === 'Change Gate' && item.status === 'APPROVED'), true);
  assert.equal(completed.timeline.some((item) => item.title === 'Re-review' && item.lines.some((entry) => entry.value === 'CHANGE_GATE')), true);
  assert.equal(completed.timeline.some((item) => item.title === 'Verification Re-review' && item.lines.some((entry) => entry.value === 'VERIFICATION')), true);

  const scope = screen(withChange(['prisma/schema.prisma'], COPY_TEXT, { gates: [], changeGateReviews: [] }));
  assert.equal(scope.timeline.some((item) => item.title === 'Scope Check' && item.status === 'BLOCKED'), true);
  assert.equal(scope.timeline.some((item) => item.title === 'Change Gate'), false);
  assert.equal(line(scope, 'Outcome', 'outcome'), 'STOPPED_SCOPE');

  const intent = screen(withChange([COPY], 'export function loadMetrics() {\n  db.newUsersLast7d = 4;\n}\n', { gates: [], changeGateReviews: [] }));
  assert.equal(intent.timeline.some((item) => item.title === 'Intent Check' && item.status === 'BLOCKED'), true);
  assert.equal(intent.timeline.some((item) => item.title === 'Change Gate'), false);
  assert.equal(line(intent, 'Outcome', 'outcome'), 'STOPPED_INTENT');

  const gated = screen(withChange([COPY], COPY_TEXT, { gates: [gate('GATED')], changeGateReviews: [] }));
  assert.equal(gated.timeline.some((item) => item.title === 'Change Gate' && item.status === 'GATED'), true);
  assert.equal(gated.timeline.some((item) => item.title === 'Re-review'), false);
  assert.equal(line(gated, 'Outcome', 'outcome'), 'STOPPED_GATE');

  const verification = screen(verificationStop());
  assert.equal(line(verification, 'Verification', 'status'), 'INCONCLUSIVE');
  assert.equal(verification.timeline.some((item) => item.title === 'Verification Re-review'), false);
  assert.equal(line(verification, 'Effect Validation', 'Effect'), 'INCONCLUSIVE');
  assert.equal(line(verification, 'Outcome', 'outcome'), 'STOPPED_VERIFICATION');

  const stalled = screen(notEffective());
  assert.equal(line(stalled, 'Effect Validation', 'Effect'), 'NOT_EFFECTIVE');
  assert.equal(line(stalled, 'Decision Cycle', 'status'), 'ACTIVE');
  assert.equal(line(stalled, 'Outcome', 'outcome'), 'STOPPED_EFFECT');
});

test('the console text drops secret values and the read route does not write', () => {
  const traced = assembleImprovementTrace(success());
  assert.equal(traced.ok, true);
  if (!traced.ok || !traced.trace.improvementTask) return;
  traced.trace.improvementTask.objective = 'postgres://hidden';
  traced.trace.improvementTask.constraints = ['sk-live-secret', 'AKIAIOSFODNN7EXAMPLE', 'mysql://hidden', 'api_key=hidden', 'password=hidden'];
  const body = JSON.stringify(projectImprovementTrace(traced.trace));
  for (const secret of ['postgres://hidden', 'mysql://hidden', 'sk-live-secret', 'AKIAIOSFODNN7EXAMPLE', 'api_key=hidden', 'password=hidden']) {
    assert.equal(body.includes(secret), false, secret);
  }
  for (const file of [
    'src/app/(root)/jury/improvements/[taskId]/page.tsx',
    'src/app/api/jury/improvements/[taskId]/route.ts',
    'src/lib/jury-product/improvement-trace-console.ts',
  ]) {
    const source = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    assert.equal(source.includes('export async function POST'), false, file);
    assert.equal(source.includes('.create('), false, file);
    assert.equal(source.includes('.update('), false, file);
    assert.equal(source.includes('executeAgent'), false, file);
    assert.equal(source.includes('requestChangeGateReReview'), false, file);
    assert.equal(source.includes('runReviewBoardPipeline'), false, file);
    assert.equal(source.includes('searchParams.get'), false, file);
  }
});

test('the live review and cycle are only read', async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const review = await prisma.juryReviewResult.findUnique({ where: { id: LIVE_REVIEW }, select: { expectedDecision: true, tenantId: true } });
  const cycle = await prisma.juryDecisionCycle.findUnique({
    where: { id: LIVE_CYCLE },
    select: { status: true, iteration: true, verificationAttempts: true, sameDecisionCount: true, sameConflictCount: true },
  });
  assert.equal(review?.expectedDecision, 'VERIFY');
  assert.equal(cycle?.status, 'ACTIVE');
  assert.equal(cycle?.iteration, 2);
  assert.equal(cycle?.verificationAttempts, 1);
  assert.equal(cycle?.sameDecisionCount, 2);
  assert.equal(cycle?.sameConflictCount, 2);
  assert.equal(await prisma.juryAutoLoopActivation.count({ where: { tenantId: review?.tenantId ?? 'missing' } }), 0);
});

function screen(bundle: TraceBundle): ImprovementTraceScreen {
  const traced = assembleImprovementTrace(bundle);
  if (!traced.ok) throw new Error(traced.reason);
  return projectImprovementTrace(traced.trace);
}

function line(screenValue: ImprovementTraceScreen, title: string, label: string): string | undefined {
  return screenValue.timeline.find((item) => item.title === title)?.lines.find((entry) => entry.label === label)?.value;
}

function success(): TraceBundle {
  return withChange(['phase34-note.md'], COPY_TEXT, {
    executions: [{ ...execution(), workspaceRef: { type: 'PROJECT', ref: 're-review-fixture' } }],
    gates: [gate('APPROVED')],
    changeGateReviews: [gateReview('verify-1')],
    verificationTask: decision('verification-task', 'VERIFICATION', 'VERIFY', 'verify-1'),
    verificationResult: {
      id: 'verification-1',
      tenantId: 'tenant-a',
      decisionTaskId: 'verification-task',
      reviewResultId: 'verify-1',
      status: 'RESOLVED',
      finding: 'metrics agree',
    },
    verificationReview: {
      id: 'verification-review-1',
      tenantId: 'tenant-a',
      verificationResultId: 'verification-1',
      status: 'EXECUTED',
      parentReviewResultId: 'verify-1',
      createdAt: '2026-10-02T00:04:00.000Z',
      updatedAt: '2026-10-02T00:05:00.000Z',
    },
    verificationChildren: [{ id: 'accept-1', tenantId: 'tenant-a', reReviewRequestId: 'verification-review-1' }],
    reviews: [
      review('root-1', 'REWORD', null, true),
      review('verify-1', 'VERIFY', 'root-1', false),
      review('accept-1', 'ACCEPT', 'verify-1', false, 'verification-1'),
    ],
    lineage: { ok: true, cycle: cycle('COMPLETED', 3, 'accept-1') },
  });
}

function notEffective(): TraceBundle {
  return withChange([COPY], COPY_TEXT, {
    gates: [gate('APPROVED')],
    changeGateReviews: [gateReview('reword-2')],
    reviews: [review('root-1', 'REWORD', null, true), review('reword-2', 'REWORD', 'root-1', true)],
    lineage: { ok: true, cycle: cycle('ACTIVE', 2, 'reword-2') },
  });
}

function verificationStop(): TraceBundle {
  return {
    actorTenantId: 'tenant-a',
    improvementTask: null,
    decisionTask: null,
    reviews: [review('verify-1', 'VERIFY', 'root-1', false)],
    executions: [],
    artifacts: [],
    gates: [],
    changeGateReviews: [],
    verificationTask: decision('verification-task', 'VERIFICATION', 'VERIFY', 'verify-1'),
    verificationResult: {
      id: 'verification-1',
      tenantId: 'tenant-a',
      decisionTaskId: 'verification-task',
      reviewResultId: 'verify-1',
      status: 'INCONCLUSIVE',
      finding: 'sources differ',
    },
    verificationReview: null,
    verificationChildren: [],
    lineage: { ok: true, cycle: cycle('ACTIVE', 1, 'verify-1') },
  };
}

function withChange(files: string[], text: string, patch: Partial<TraceBundle> = {}): TraceBundle {
  return {
    actorTenantId: 'tenant-a',
    improvementTask: {
      id: 'task-1',
      tenantId: 'tenant-a',
      reviewResultId: 'root-1',
      decisionTaskId: 'decision-1',
      evidenceId: 'evidence-1',
      taskType: 'REWORD',
      objective: REWORD_FIXTURE_OBJECTIVE,
      constraints: [...REWORD_CONSTRAINTS],
      provenance: { sourceDecision: 'REWORD', workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' } },
      status: 'OPEN',
      createdAt: '2026-10-02T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    },
    decisionTask: decision('decision-1', 'REWORD', 'REWORD', 'root-1'),
    reviews: [review('root-1', 'REWORD', null, true)],
    executions: [execution()],
    artifacts: [{ executionId: 'exec-1', changedFiles: files, changes: [{ path: files[0] ?? COPY, kind: 'modified', text }], summary: null }],
    gates: [],
    changeGateReviews: [],
    verificationTask: null,
    verificationResult: null,
    verificationReview: null,
    verificationChildren: [],
    lineage: { ok: false, reason: 'DECISION_CYCLE_NOT_FOUND' },
    ...patch,
  };
}

function execution() {
  return {
    id: 'exec-1',
    tenantId: 'tenant-a',
    taskId: 'task-1',
    agent: 'CURSOR',
    status: 'COMPLETED',
    requestedAt: '2026-10-02T00:01:00.000Z',
    startedAt: '2026-10-02T00:01:00.000Z',
    finishedAt: '2026-10-02T00:01:30.000Z',
    workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' },
    allowedPaths: [] as string[],
    errorCode: null,
  };
}

function gate(status: string) {
  return {
    id: 'gate-1',
    tenantId: 'tenant-a',
    executionId: 'exec-1',
    improvementTaskId: 'task-1',
    status,
    risk: 'LOW',
    changedFiles: [COPY],
    agentReportedFiles: [COPY],
    discrepancy: false,
    reason: null,
    diffStat: { added: 1 },
    credentialDetected: false,
    testsPassed: true,
    createdAt: '2026-10-02T00:01:40.000Z',
  };
}

function gateReview(reviewResultId: string) {
  return {
    id: 'gate-review-1',
    tenantId: 'tenant-a',
    changeGateResultId: 'gate-1',
    improvementTaskId: 'task-1',
    status: 'EXECUTED',
    source: 'CHANGE_GATE',
    reviewRequestId: 'request-1',
    reviewResultId,
    createdAt: '2026-10-02T00:02:00.000Z',
    updatedAt: '2026-10-02T00:03:00.000Z',
  };
}

function decision(id: string, taskType: string, decisionName: string, reviewResultId: string) {
  return { id, tenantId: 'tenant-a', taskType, decision: decisionName, status: 'OPEN', reviewResultId };
}

function review(id: string, decisionName: string, parentReviewResultId: string | null, overclaimDetected: boolean, verificationResultId: string | null = null) {
  return { id, tenantId: 'tenant-a', decision: decisionName, parentReviewResultId, overclaimDetected, verificationResultId };
}

function cycle(status: string, iteration: number, currentReviewResultId: string) {
  return {
    id: 'cycle-1',
    tenantId: 'tenant-a',
    rootReviewResultId: 'root-1',
    currentReviewResultId,
    status,
    iteration,
    verificationAttempts: status === 'COMPLETED' ? 1 : 0,
    sameDecisionCount: 1,
    sameConflictCount: 0,
    blockedReason: null,
  };
}

function loadEnv(): void {
  for (const [file, override] of [
    ['.env', false],
    ['.env.local', true],
  ] as const) {
    let text = '';
    try {
      text = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    } catch {
      continue;
    }
    for (const lineText of text.split(/\r?\n/)) {
      const match = lineText.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      const [, key, raw] = match;
      if (!key || (process.env[key] && !override)) continue;
      process.env[key] = raw.replace(/^"|"$/g, '');
    }
  }
}
