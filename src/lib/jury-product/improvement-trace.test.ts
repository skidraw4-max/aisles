/**
 * Improvement trace reads explicit links and does not start work.
 * It does not write, audit, or call a live review.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import { REWORD_CONSTRAINTS, REWORD_FIXTURE_OBJECTIVE } from './improvement-bridge';
import { assembleImprovementTrace, planImprovementTraceRead, type TraceBundle } from './improvement-trace';
import type { JuryMembership } from './records';

const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const COPY = 'workspace/mock-aisle/user-facing-copy.ts';
const COPY_TEXT = 'export const userFacingCopy = "측정된 Evidence가 직접 지지하는 범위의 문구만 사용합니다.";';
const owner: JuryMembership = { id: 'mem-1', tenantId: 'tenant-a', userId: 'user-1', role: 'OWNER', createdAt: '2026-10-02T00:00:00.000Z' };
const auditor: JuryMembership = { ...owner, id: 'mem-2', role: 'AUDITOR' };

test('a completed improvement restores one explicit trace', () => {
  const traced = assembleImprovementTrace(success());
  assert.equal(traced.ok, true);
  if (!traced.ok) return;
  assert.equal(traced.trace.rootReviewResult?.id, 'root-1');
  assert.equal(traced.trace.rootReviewResult?.decision, 'REWORD');
  assert.equal(traced.trace.decisionTask?.id, 'decision-1');
  assert.equal(traced.trace.improvementTask?.id, 'task-1');
  assert.equal(traced.trace.agentExecutions[0]?.status, 'COMPLETED');
  assert.equal(traced.trace.scopeChecks[0]?.result.status, 'SAFE');
  assert.equal(traced.trace.intentChecks[0]?.result.status, 'SAFE');
  assert.equal(traced.trace.changeGates[0]?.status, 'APPROVED');
  assert.equal(traced.trace.rereviews[0]?.source, 'CHANGE_GATE');
  assert.equal(traced.trace.rereviews[0]?.reviewResult?.decision, 'VERIFY');
  assert.equal(traced.trace.verification?.task?.id, 'verification-task');
  assert.equal(traced.trace.verification?.result?.status, 'RESOLVED');
  assert.equal(traced.trace.rereviews[1]?.source, 'VERIFICATION');
  assert.equal(traced.trace.rereviews[1]?.reviewResult?.decision, 'ACCEPT');
  assert.equal(traced.trace.effectValidation && 'code' in traced.trace.effectValidation ? traced.trace.effectValidation.code : '', 'EFFECTIVE');
  assert.equal(traced.trace.decisionCycle?.status, 'COMPLETED');
  assert.equal(traced.trace.outcome, 'COMPLETED');
});

test('scope, intent, gate, and verification stops stay on the recorded evidence', () => {
  const scope = assembleImprovementTrace(withChange(['prisma/schema.prisma'], COPY_TEXT, { gates: [], changeGateReviews: [] }));
  assert.equal(scope.ok, true);
  if (!scope.ok) return;
  assert.equal(scope.trace.scopeChecks[0]?.result.status, 'BLOCKED');
  assert.equal(scope.trace.changeGates.length, 0);
  assert.equal(scope.trace.rereviews.length, 0);
  assert.equal(scope.trace.outcome, 'STOPPED_SCOPE');

  const intent = assembleImprovementTrace(withChange([COPY], 'export function loadMetrics() {\n  db.newUsersLast7d = 4;\n}\n', { gates: [], changeGateReviews: [] }));
  assert.equal(intent.ok, true);
  if (!intent.ok) return;
  assert.equal(intent.trace.scopeChecks[0]?.result.status, 'SAFE');
  assert.equal(intent.trace.intentChecks[0]?.result.status, 'BLOCKED');
  assert.equal(intent.trace.changeGates.length, 0);
  assert.equal(intent.trace.rereviews.length, 0);
  assert.equal(intent.trace.outcome, 'STOPPED_INTENT');

  const gated = assembleImprovementTrace(withChange([COPY], COPY_TEXT, { gates: [gate('GATED')], changeGateReviews: [] }));
  assert.equal(gated.ok, true);
  if (!gated.ok) return;
  assert.equal(gated.trace.changeGates[0]?.status, 'GATED');
  assert.equal(gated.trace.rereviews.length, 0);
  assert.equal(gated.trace.outcome, 'STOPPED_GATE');

  const blocked = assembleImprovementTrace(withChange([COPY], COPY_TEXT, { gates: [gate('BLOCKED')], changeGateReviews: [] }));
  assert.equal(blocked.ok, true);
  if (!blocked.ok) return;
  assert.equal(blocked.trace.changeGates[0]?.status, 'BLOCKED');
  assert.equal(blocked.trace.outcome, 'STOPPED_GATE');

  const verification = assembleImprovementTrace(verificationStop());
  assert.equal(verification.ok, true);
  if (!verification.ok) return;
  assert.equal(verification.trace.verification?.result?.status, 'INCONCLUSIVE');
  assert.equal(verification.trace.rereviews.length, 0);
  assert.equal(verification.trace.effectValidation && 'code' in verification.trace.effectValidation ? verification.trace.effectValidation.code : '', 'INCONCLUSIVE');
  assert.equal(verification.trace.outcome, 'STOPPED_VERIFICATION');
});

test('a repeated overclaim stays not effective without another execution', async () => {
  const traced = assembleImprovementTrace(notEffective());
  assert.equal(traced.ok, true);
  if (!traced.ok) return;
  assert.equal(traced.trace.effectValidation && 'code' in traced.trace.effectValidation ? traced.trace.effectValidation.code : '', 'NOT_EFFECTIVE');
  assert.equal(traced.trace.decisionCycle?.status, 'ACTIVE');
  assert.equal(traced.trace.decisionCycle?.iteration, 2);
  assert.equal(traced.trace.outcome, 'STOPPED_EFFECT');
  assert.equal(traced.trace.agentExecutions.length, 1);
  const again = assembleImprovementTrace(notEffective());
  assert.deepEqual(again, traced);
  const [left, right] = await Promise.all([Promise.resolve(assembleImprovementTrace(notEffective())), Promise.resolve(assembleImprovementTrace(notEffective()))]);
  assert.deepEqual(left, right);
});

test('trace keeps tenant, permission, and credential boundaries', () => {
  const foreign = assembleImprovementTrace(withChange([COPY], COPY_TEXT, { executions: [{ ...execution(), tenantId: 'tenant-b' }] }));
  assert.equal(foreign.ok, false);
  if (foreign.ok) return;
  assert.equal(foreign.reason, 'TENANT_MISMATCH');
  const planned = planImprovementTraceRead({ userId: owner.userId, memberships: [owner], clientTenantId: 'forged-tenant' });
  assert.equal(planned.ok && planned.tenantId, 'tenant-a');
  assert.equal(planImprovementTraceRead({ userId: auditor.userId, memberships: [auditor] }).ok, true);
  assert.equal(planImprovementTraceRead({ userId: null, memberships: [] }).ok, false);
  const secret = assembleImprovementTrace(withChange([COPY], COPY_TEXT, {
    improvementTask: task({ provenance: { sourceDecision: 'REWORD', workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' }, note: 'postgres://hidden' } }),
    executions: [{ ...execution(), errorCode: 'password=hidden' }],
  }));
  assert.equal(secret.ok, true);
  if (!secret.ok) return;
  const body = JSON.stringify(secret.trace);
  assert.equal(body.includes('postgres://'), false);
  assert.equal(body.includes('password'), false);
  assert.equal(body.includes('inputSnapshot'), false);
});

test('trace source does not write or execute', () => {
  for (const file of ['src/lib/jury-product/improvement-trace.ts', 'src/lib/jury-product/improvement-trace-store.ts']) {
    const source = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    assert.equal(source.includes('.create('), false, file);
    assert.equal(source.includes('.update('), false, file);
    assert.equal(source.includes('.delete('), false, file);
    assert.equal(source.includes('juryAuditEvent'), false, file);
    assert.equal(source.includes('executeAgent'), false, file);
    assert.equal(source.includes('requestChangeGateReReview'), false, file);
    assert.equal(source.includes('runReviewBoardPipeline'), false, file);
    assert.equal(source.includes(LIVE_REVIEW.slice(0, 16)), false, file);
    assert.equal(source.includes(LIVE_CYCLE.slice(0, 16)), false, file);
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

function success(): TraceBundle {
  return {
    ...withChange(['phase34-note.md'], COPY_TEXT, {
      executions: [{ ...execution(), workspaceRef: { type: 'PROJECT', ref: 're-review-fixture' } }],
      gates: [gate('APPROVED')],
      changeGateReviews: [{
        id: 'gate-review-1',
        tenantId: 'tenant-a',
        changeGateResultId: 'gate-1',
        improvementTaskId: 'task-1',
        status: 'EXECUTED',
        source: 'CHANGE_GATE',
        reviewRequestId: 'request-verify',
        reviewResultId: 'verify-1',
        createdAt: '2026-10-02T00:02:00.000Z',
        updatedAt: '2026-10-02T00:03:00.000Z',
      }],
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
    }),
  };
}

function notEffective(): TraceBundle {
  return withChange([COPY], COPY_TEXT, {
    gates: [gate('APPROVED')],
    changeGateReviews: [{
      id: 'gate-review-1',
      tenantId: 'tenant-a',
      changeGateResultId: 'gate-1',
      improvementTaskId: 'task-1',
      status: 'EXECUTED',
      source: 'CHANGE_GATE',
      reviewRequestId: 'request-2',
      reviewResultId: 'reword-2',
      createdAt: '2026-10-02T00:02:00.000Z',
      updatedAt: '2026-10-02T00:03:00.000Z',
    }],
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
  const base: TraceBundle = {
    actorTenantId: 'tenant-a',
    improvementTask: task(),
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
  };
  return { ...base, ...patch };
}

function task(patch: Record<string, unknown> = {}) {
  return {
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
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      const [, key, raw] = match;
      if (!key || (process.env[key] && !override)) continue;
      process.env[key] = raw.replace(/^"|"$/g, '');
    }
  }
}
