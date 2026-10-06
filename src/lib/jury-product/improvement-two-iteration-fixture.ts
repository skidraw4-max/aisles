/**
 * Connects two existing loop steps, improvement then verification, in one isolated cycle.
 * It does not spawn a process or touch a live review.
 */
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentAdapter } from './agents/agent-adapter';
import { fakeCursorAdapter } from './agents/fake-cursor-adapter';
import type { AgentExecutionDraft, HandoffProvenance, HandoffTask, HandoffWriteTx } from './agent-handoff';
import type { ExecutionArtifact, ExecutionWriteTx } from './agent-execution';
import type { ChangeGateDraft, ChangeGateWriteTx, ChangeInspection } from './change-gate';
import {
  type ChangeGateReviewDraft,
  type ChangeGateReviewExecIo,
  type ChangeGateReviewRequestTx,
  type ChangeGateReviewResult,
} from './change-gate-rereview';
import { resolveReReviewDecision, type ResolutionIo, type ResolutionSnapshot } from './decision-cycle-resolution';
import type { DecisionTaskDraft, DecisionTaskWriteTx } from './decision-task';
import type { LineageCycleRef, LineageIo, LineageStep } from './decision-cycle-lineage';
import { executeImprovementTask } from './improvement-agent-run';
import { runImprovementAutoLoop, type AutoLoopResult } from './improvement-auto-loop';
import { runChangeGateForExecution } from './improvement-change-gate';
import { startNewImprovementCycle, type StartIo, type StartReview } from './improvement-cycle-start';
import { reenterReReviewDecision } from './improvement-decision-reentry';
import { runApprovedGateReReview } from './improvement-gate-rereview';
import { runSingleImprovementIteration, type IterationReview } from './improvement-iteration';
import { REWORD_CONSTRAINTS, type ImprovementTaskDraft } from './improvement-bridge';
import { FIXTURE_ROOT } from './improvement-loop-fixture';
import {
  evaluateLoopGuard,
  foldDecisionCycle,
  PRODUCT_LOOP_GUARD_DEFAULTS,
  type CycleReviewNode,
  type DecisionCycleDraft,
  type ProductLoopGuardPolicy,
} from './loop-guard';
import type { JuryMembership, JuryNormalizedMetric, JuryReviewRequest, JuryScopeStatus } from './records';
import type { FrozenCoreReading } from './review-boundary';
import { executeVerificationReReview, type ReReviewIo, type ReReviewResult } from './verification-rereview';
import {
  requestVerificationReReview,
  resolveVerification,
  type VerificationObservation,
  type VerificationResultDraft,
  type VerificationReviewDraft,
  type VerificationWriteTx,
} from './verification-resolution';

const NOTE = 'phase33-note.md';
const ROOT_ID = 'phase33-root';
const owner: JuryMembership = {
  id: 'mem-phase33',
  tenantId: 'tenant-phase33',
  userId: 'user-phase33',
  role: 'OWNER',
  createdAt: '2026-10-02T00:00:00.000Z',
};

export type TwoIterationMode =
  | 'accept'
  | 'agent-fail'
  | 'gated'
  | 'rereview-refused'
  | 'inconclusive'
  | 'verification-guard'
  | 'max-iterations'
  | 'secret';

export function twoIterationPolicy(mode: TwoIterationMode): ProductLoopGuardPolicy {
  // The existing guard blocks when folded iteration >= maxIterations.
  // REWORD → VERIFY → ACCEPT folds to 3, so 4 is the smallest limit that still completes.
  // maxIterations 2 is covered by the separate block fixture.
  if (mode === 'max-iterations') return { ...PRODUCT_LOOP_GUARD_DEFAULTS, maxIterations: 2 };
  if (mode === 'verification-guard') return { ...PRODUCT_LOOP_GUARD_DEFAULTS, maxIterations: 4, maxVerificationAttempts: 1 };
  return { ...PRODUCT_LOOP_GUARD_DEFAULTS, maxIterations: 4 };
}

export function fixtureCommand(actor: JuryMembership = owner) {
  return {
    userId: actor.userId,
    memberships: [actor],
    clientTenantId: 'forged-tenant',
    now: '2026-10-02T13:05:00.000Z',
    rootReviewResultId: ROOT_ID,
  };
}

export async function openTwoIteration(mode: TwoIterationMode = 'accept') {
  const box = createBox(mode);
  await startNewImprovementCycle({ ...fixtureCommand(), reviewResultId: ROOT_ID }, startIo(box));
  return box;
}

export async function runTwoIteration(box: Box, actor: JuryMembership = owner): Promise<AutoLoopResult> {
  return runImprovementAutoLoop(fixtureCommand(actor), connect(box, actor));
}

export function viewTwoIteration(box: Box, outcome: AutoLoopResult) {
  return {
    outcome,
    tasks: box.tasks,
    improvements: box.improvements,
    executions: box.executions,
    gates: box.gates,
    changeGateReviews: box.changeGateReviews,
    verifyResults: box.verifyResults,
    verificationTasks: box.tasks.filter((row) => row.taskType === 'VERIFICATION'),
    verificationResults: box.verificationResults,
    verificationReviews: box.verificationReviews,
    verificationRequests: box.verificationRequests,
    acceptResults: box.acceptResults,
    childDecision: box.childDecision,
    cycleStatus: box.cycle?.status ?? 'MISSING',
    cycleId: box.cycle?.id ?? null,
    blockedReason: box.cycle?.blockedReason ?? null,
    coreCalls: box.coreCalls,
    agentCalls: box.agentCalls,
    protected: box.protected,
  };
}

export async function removeTwoIterationFile(): Promise<void> {
  await unlink(path.join(process.cwd(), FIXTURE_ROOT, NOTE)).catch(() => undefined);
}

type Box = ReturnType<typeof createBox>;

function createBox(mode: TwoIterationMode) {
  return {
    mode,
    policy: twoIterationPolicy(mode),
    review: seedReview(mode),
    tasks: [] as DecisionTaskDraft[],
    improvements: [] as ImprovementTaskDraft[],
    executions: [] as AgentExecutionDraft[],
    artifacts: new Map<string, ExecutionArtifact>(),
    gates: [] as ChangeGateDraft[],
    changeGateReviews: [] as ChangeGateReviewDraft[],
    verifyResults: [] as ChangeGateReviewResult[],
    verificationResults: [] as VerificationResultDraft[],
    verificationReviews: [] as VerificationReviewDraft[],
    verificationRequests: [] as JuryReviewRequest[],
    acceptResults: [] as ReReviewResult[],
    childDecision: null as string | null,
    gateClaim: 'READY' as ChangeGateReviewDraft['status'],
    verificationClaim: 'READY' as VerificationReviewDraft['status'],
    cycle: null as DecisionCycleDraft | null,
    coreCalls: 0,
    agentCalls: 0,
    protected: {
      id: '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e',
      updatedAt: '2026-10-01T16:33:57.676Z',
      iteration: 2,
      status: 'ACTIVE',
    },
  };
}

function connect(box: Box, actor: JuryMembership) {
  const done = new Set<string>();
  return {
    iteration: (command: ReturnType<typeof fixtureCommand> & { reviewResultId: string }) =>
      runSingleImprovementIteration(command, {
        loadReview: async (id) => loadIterationReview(box, id),
        reenter: (input) =>
          reenterReReviewDecision(input, {
            loadReview: async (id) => {
              const row = loadIterationReview(box, id);
              return row ? { id: row.id, tenantId: row.tenantId, expectedDecision: row.expectedDecision } : null;
            },
            lineage: lineage(box),
            resolve: (value) => resolveReReviewDecision(value, resolutionIo(box, value.reviewResultId)),
            start: (value) => startNewImprovementCycle(value, startIo(box)),
          }),
      }),
    async policy() {
      return box.policy;
    },
    async counters() {
      return {
        iteration: box.cycle?.iteration ?? 1,
        verificationAttempts: box.cycle?.verificationAttempts ?? 0,
        sameDecisionCount: box.cycle?.sameDecisionCount ?? 1,
        sameConflictCount: box.cycle?.sameConflictCount ?? 0,
        runtimeMs: null,
        costUsd: null,
      };
    },
    async alreadyDone(taskId: string) {
      return done.has(taskId);
    },
    async markDone(taskId: string) {
      done.add(taskId);
    },
    async agent(improvementTaskId: string) {
      const task = box.improvements.find((row) => row.id === improvementTaskId);
      const ran = await executeImprovementTask(
        { ...fixtureCommand(actor), improvementTaskId, timeoutMs: 1000, clock: () => fixtureCommand().now },
        { load: async () => (task ? handoffTask(task) : null), handoff: handoffTx(box), execution: executionTx(box) },
        adapterFor(box),
      );
      if (!ran.ok) return { ok: false as const, reason: ran.reason };
      if (ran.execution.status !== 'COMPLETED') return { ok: false as const, reason: 'AGENT_FAILED' };
      return { ok: true as const, executionId: ran.execution.id, status: ran.execution.status };
    },
    async gate(executionId: string) {
      const ran = await runChangeGateForExecution(
        { ...fixtureCommand(actor), executionId },
        { load: async (id) => loadGate(box, id), inspect: (root) => inspectNote(box, root), gate: gateTx(box) },
      );
      if (!ran.ok) return { ok: false as const, reason: ran.reason, status: 'GATED' };
      return { ok: true as const, id: ran.gate.id, status: ran.gate.status };
    },
    async rereview(changeGateResultId: string) {
      const before = box.coreCalls;
      const ran = await runApprovedGateReReview(
        { ...fixtureCommand(actor), siteName: 'phase33-fixture', gate: gateView(box, changeGateResultId), ...gateLinks() },
        { request: gateRequestTx(box), execution: gateReviewIo(box) },
      );
      if (!ran.ok) return { ok: false as const, reason: ran.reason };
      box.childDecision = ran.result.expectedDecision;
      return { ok: true as const, reviewResultId: ran.result.id, coreRuns: box.coreCalls - before };
    },
    async verification(taskId: string) {
      const task = box.tasks.find((row) => row.id === taskId) ?? null;
      const ran = await resolveVerification(
        {
          ...fixtureCommand(actor),
          task,
          reviewResult: { ...verifyBody(), id: box.verifyResults[0]?.id ?? '' },
          evidence: { id: 'ev-phase33', tenantId: owner.tenantId, contentHash: 'hash-phase33' },
          observations: observations(box),
        },
        verificationTx(box),
      );
      if (!ran.ok) return { ok: false as const, reason: ran.reason };
      return { ok: true as const, status: ran.result.status };
    },
    async verificationReview(taskId: string) {
      const task = box.tasks.find((row) => row.id === taskId);
      const result = box.verificationResults.find((row) => row.decisionTaskId === taskId);
      if (!task || !result || !box.verifyResults[0]) return { ok: false as const, reason: 'RESULT_REQUIRED' };
      const guard = evaluateLoopGuard({
        policy: box.policy,
        ...foldDecisionCycle(chain(box, box.verifyResults[0].id, result.id)),
        runtimeMs: null,
        costUsd: null,
      });
      if (!guard.allowed && box.cycle) {
        box.cycle = {
          ...box.cycle,
          iteration: guard.counters.iteration,
          verificationAttempts: guard.counters.verificationAttempts,
          sameDecisionCount: guard.counters.sameDecisionCount,
          sameConflictCount: guard.counters.sameConflictCount,
          status: 'BLOCKED',
          blockedReason: guard.reason === 'ALLOWED' ? null : guard.reason,
          updatedAt: fixtureCommand().now,
        };
        return { ok: false as const, reason: guard.reason };
      }
      const requested = await requestVerificationReReview(
        {
          ...fixtureCommand(actor),
          task,
          result,
          evidence: { id: 'ev-phase33', tenantId: owner.tenantId },
          parentReviewResultId: box.verifyResults[0].id,
        },
        verificationTx(box),
      );
      if (!requested.ok) return { ok: false as const, reason: requested.reason };
      const before = box.coreCalls;
      const executed = await executeVerificationReReview(
        { ...fixtureCommand(actor), requestId: requested.review.id, siteName: 'phase33-fixture' },
        verificationReviewIo(box),
      );
      if (!executed.ok) return { ok: false as const, reason: executed.reason };
      box.childDecision = executed.result.expectedDecision;
      return { ok: true as const, reviewResultId: executed.result.id, coreRuns: box.coreCalls - before };
    },
  };
}

function adapterFor(box: Box): AgentAdapter {
  if (box.mode === 'agent-fail') return counting(box, fakeCursorAdapter('fail'));
  return counting(box, {
    async run() {
      const absolute = path.join(process.cwd(), FIXTURE_ROOT, NOTE);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, '측정된 범위의 문구만 사용합니다.\n', 'utf8');
      return { ok: true as const, changedFiles: [NOTE], summary: 'fixture copy', testsRun: ['fixture'], testsPassed: true };
    },
  });
}

function counting(box: Box, adapter: AgentAdapter): AgentAdapter {
  return {
    async run(input) {
      box.agentCalls += 1;
      return adapter.run(input);
    },
  };
}

async function inspectNote(box: Box, root: string): Promise<ChangeInspection> {
  if (root !== FIXTURE_ROOT || box.mode === 'gated') return { files: [], present: [] };
  const absolute = path.join(process.cwd(), root, NOTE);
  try {
    await access(absolute);
  } catch {
    return { files: [], present: [] };
  }
  return { files: [{ path: NOTE, kind: 'added', additions: 1, deletions: 0 }], present: [NOTE] };
}

function seedReview(mode: TwoIterationMode): StartReview {
  const secret = mode === 'secret';
  return {
    id: ROOT_ID,
    tenantId: owner.tenantId,
    evidenceId: secret ? 'postgres://hidden' : 'ev-phase33',
    expectedDecision: 'REWORD',
    evidenceStrength: 'moderate',
    claimStrength: 'weak',
    conflictDetected: true,
    overclaimDetected: true,
    revisionRequired: true,
    completedAt: '2026-10-02T00:00:00.000Z',
    requestStatus: 'COMPLETED',
    verificationResultId: null,
    evidenceIdentity: 'evidence-hash',
  };
}

function startIo(box: Box): StartIo {
  return {
    async load() {
      return {
        review: box.review,
        evidence: { id: box.review.evidenceId, tenantId: box.review.tenantId },
        cycle: box.cycle,
        decisionTask: box.tasks.find((row) => row.taskType === 'REWORD') ?? null,
        decisionLinked: box.tasks.some((row) => row.taskType === 'REWORD'),
        improvementTask: box.improvements[0] ?? null,
        improvementLinked: box.improvements.length > 0,
      };
    },
    async findPolicy() {
      return { id: 'policy-phase33', policy: box.policy };
    },
    async insertCycle(cycle) {
      if (box.cycle) throw uniqueError();
      if (cycle.id === box.protected.id) throw new Error('LIVE_CYCLE');
      box.cycle = cycle;
    },
    async auditCycle() {},
    decisionTx: decisionTx(box),
    improvementTx: {
      async findByDecisionTask(decisionTaskId) {
        return box.improvements.find((row) => row.decisionTaskId === decisionTaskId) ?? null;
      },
      async insert(task) {
        if (box.improvements.some((row) => row.decisionTaskId === task.decisionTaskId)) throw uniqueError();
        box.improvements.push(task);
      },
      async audit() {},
    },
  };
}

function decisionTx(box: Box): DecisionTaskWriteTx {
  return {
    async findByResultAndType(reviewResultId, taskType) {
      return box.tasks.find((row) => row.reviewResultId === reviewResultId && row.taskType === taskType) ?? null;
    },
    async insert(task) {
      if (box.tasks.some((row) => row.reviewResultId === task.reviewResultId && row.taskType === task.taskType)) throw uniqueError();
      box.tasks.push(task);
    },
  };
}

function handoffTask(task: ImprovementTaskDraft): HandoffTask {
  const provenance: HandoffProvenance & { workspaceRef: { type: 'PROJECT'; ref: string } } = {
    reviewResultId: task.reviewResultId,
    decisionTaskId: task.decisionTaskId,
    evidenceId: task.evidenceId,
    sourceDecision: 'REWORD',
    comparator: {
      evidenceStrength: 'moderate',
      claimStrength: 'weak',
      conflictDetected: true,
      overclaimDetected: true,
      revisionRequired: true,
      expectedDecision: 'REWORD',
    },
    workspaceRef: { type: 'PROJECT', ref: 're-review-fixture' },
  };
  return {
    id: task.id,
    tenantId: task.tenantId,
    reviewResultId: task.reviewResultId,
    decisionTaskId: task.decisionTaskId,
    evidenceId: task.evidenceId,
    taskType: 'REWORD',
    title: task.title,
    description: task.description,
    reason: task.reason,
    objective: task.objective,
    constraints: [...REWORD_CONSTRAINTS],
    status: 'OPEN',
    provenance,
  };
}

function handoffTx(box: Box): HandoffWriteTx {
  return {
    async findByTaskAndAgent(taskId, agent) {
      return box.executions.find((row) => row.taskId === taskId && row.agent === agent) ?? null;
    },
    async insert(execution) {
      if (box.executions.some((row) => row.taskId === execution.taskId && row.agent === execution.agent)) throw uniqueError();
      box.executions.push(execution);
    },
    async audit() {},
  };
}

function executionTx(box: Box): ExecutionWriteTx {
  return {
    async claimRunning(id, at) {
      const row = box.executions.find((item) => item.id === id);
      if (!row || row.status !== 'PENDING') return false;
      row.status = 'RUNNING';
      row.startedAt = at;
      row.updatedAt = at;
      return true;
    },
    async blockPending(id, errorCode, at) {
      const row = box.executions.find((item) => item.id === id);
      if (!row || row.status !== 'PENDING') return false;
      row.status = 'BLOCKED';
      row.errorCode = errorCode;
      row.finishedAt = at;
      row.updatedAt = at;
      return true;
    },
    async completeRunning(id, resultRef, at) {
      const row = box.executions.find((item) => item.id === id);
      if (!row || row.status !== 'RUNNING') return false;
      row.status = 'COMPLETED';
      row.resultRef = resultRef;
      row.finishedAt = at;
      row.updatedAt = at;
      return true;
    },
    async failRunning(id, errorCode, at) {
      const row = box.executions.find((item) => item.id === id);
      if (!row || row.status !== 'RUNNING') return false;
      row.status = 'BLOCKED';
      row.errorCode = errorCode;
      row.finishedAt = at;
      row.updatedAt = at;
      return true;
    },
    async audit() {},
    async saveResult(artifact) {
      box.artifacts.set(artifact.executionId, artifact);
      return `memory:${artifact.executionId}`;
    },
  };
}

function loadGate(box: Box, executionId: string) {
  const execution = box.executions.find((row) => row.id === executionId);
  if (!execution) return null;
  const artifact = box.artifacts.get(execution.id);
  return {
    execution,
    task: { id: execution.taskId, tenantId: execution.tenantId },
    agentReportedFiles: artifact?.changedFiles ?? [],
    testResults: { available: artifact?.testsPassed != null, passed: artifact?.testsPassed ?? null, commands: artifact?.testsRun ?? [] },
  };
}

function gateTx(box: Box): ChangeGateWriteTx {
  return {
    async findByExecution(executionId) {
      return box.gates.find((row) => row.executionId === executionId) ?? null;
    },
    async insert(row) {
      if (box.gates.some((item) => item.executionId === row.executionId)) throw uniqueError();
      box.gates.push(row);
    },
    async audit() {},
  };
}

function gateView(box: Box, id: string) {
  const gate = box.gates.find((row) => row.id === id);
  if (!gate) return null;
  return {
    id: gate.id,
    tenantId: gate.tenantId,
    status: box.mode === 'rereview-refused' ? ('GATED' as const) : gate.status,
    executionId: gate.executionId,
    improvementTaskId: gate.improvementTaskId,
  };
}

function gateLinks() {
  return {
    reason: { code: 'APPROVED_CHANGE', message: 'The approved fixture change is ready for review.' },
    executionTenantId: owner.tenantId,
    taskTenantId: owner.tenantId,
    parent: { id: ROOT_ID, tenantId: owner.tenantId },
    evidence: gateEvidence(),
    sourceEvidenceId: 'ev-source-phase33',
    metrics: [metric('m-phase33', 'newUsersLast7d', 0)],
    scopes: [{ tenantId: owner.tenantId, connectionId: 'conn-phase33', status: 'APPROVED' as const }],
  };
}

function gateEvidence() {
  return {
    id: 'ev-phase33',
    tenantId: owner.tenantId,
    connectionId: 'conn-phase33',
    purpose: 'change-gate-rereview-fixture',
    periodStart: '2026-09-24',
    periodEnd: '2026-09-30',
    timezone: 'Asia/Seoul',
    metricIds: ['m-phase33'],
    adapterKey: 'aisle-self',
    collectedAt: '2026-10-02T00:00:00.000Z',
    contentHash: 'hash-phase33',
    piiExcluded: true,
    readOnly: true,
  };
}

function metric(id: string, name: string, value: number | null): JuryNormalizedMetric {
  return {
    id,
    tenantId: owner.tenantId,
    connectionId: 'conn-phase33',
    evidenceId: 'ev-phase33',
    metric: name,
    value,
    unit: 'COUNT',
    periodStart: '2026-09-24',
    periodEnd: '2026-09-30',
    timezone: 'Asia/Seoul',
    sourceSystem: name.startsWith('ga4.') ? 'GA4' : 'DATABASE',
    sourceRef: name,
    collectedAt: '2026-10-02T00:00:00.000Z',
    availability: 'AVAILABLE',
    rawPayloadRef: `evidence-pack:${name}`,
    adapterKey: 'aisle-self',
    adapterVersion: 'aisle-self-v1',
    ruleId: 'normalize.evidence-pack.aggregate.v1',
  };
}

function reading(decision: 'VERIFY' | 'ACCEPT'): FrozenCoreReading {
  return {
    boardRunId: decision === 'VERIFY' ? 'run-phase33-verify' : 'run-phase33-accept',
    evidenceStrength: 'strong',
    claimStrength: 'weak',
    conflictDetected: false,
    overclaimDetected: false,
    revisionRequired: false,
    expectedDecision: decision,
    finalSurface: {
      statusSummary: 'measured',
      topProblems: [],
      expectedUserEffect: '',
      risk: '',
      dimensionEvidence: [],
      supportedClaims: [],
      partiallySupportedClaims: [],
      hypotheses: [],
    },
    completedAt: '2026-10-02T13:05:00.000Z',
  };
}

function gateRequestTx(box: Box): ChangeGateReviewRequestTx {
  return {
    async findByGate(id) {
      return box.changeGateReviews.find((row) => row.changeGateResultId === id) ?? null;
    },
    async insert(row) {
      if (box.changeGateReviews.some((item) => item.changeGateResultId === row.changeGateResultId)) throw uniqueError();
      box.changeGateReviews.push(row);
    },
    async auditRequested() {},
  };
}

function gateReviewIo(box: Box): ChangeGateReviewExecIo {
  return {
    async load(requestId) {
      const review = box.changeGateReviews.find((row) => row.id === requestId);
      if (!review) return null;
      return {
        ...gateLinks(),
        gate: gateView(box, review.changeGateResultId),
        review: { ...review, status: box.gateClaim === 'READY' ? review.status : box.gateClaim, reviewResultId: box.verifyResults[0]?.id ?? null },
        result: box.verifyResults[0] ?? null,
      };
    },
    async claimReady() {
      if (box.gateClaim === 'READY') {
        box.gateClaim = 'RUNNING';
        return 'CLAIMED';
      }
      if (box.gateClaim === 'EXECUTED') return 'EXECUTED';
      if (box.gateClaim === 'RUNNING') return 'RUNNING';
      return 'NOT_READY';
    },
    async core() {
      box.coreCalls += 1;
      return reading('VERIFY');
    },
    async commit(input) {
      box.gateClaim = 'EXECUTED';
      const index = box.changeGateReviews.findIndex((row) => row.id === input.review.id);
      if (index >= 0) box.changeGateReviews[index] = input.review;
      if (!box.verifyResults.some((row) => row.id === input.result.id)) box.verifyResults.push(input.result);
      box.childDecision = input.result.expectedDecision;
    },
    async fail(requestId, errorCode) {
      box.gateClaim = 'FAILED';
      const index = box.changeGateReviews.findIndex((row) => row.id === requestId);
      if (index >= 0) box.changeGateReviews[index] = { ...box.changeGateReviews[index], status: 'FAILED', errorCode };
    },
    async audit() {},
  };
}

function verificationTx(box: Box): VerificationWriteTx {
  return {
    tasks: box.tasks,
    results: box.verificationResults,
    reviews: box.verificationReviews,
    async findTask(id) {
      return box.tasks.find((row) => row.id === id) ?? null;
    },
    async saveTask(task) {
      const index = box.tasks.findIndex((row) => row.id === task.id);
      if (index >= 0) box.tasks[index] = task;
      else box.tasks.push(task);
    },
    async findResult(decisionTaskId) {
      return box.verificationResults.find((row) => row.decisionTaskId === decisionTaskId) ?? null;
    },
    async insertResult(result) {
      if (box.verificationResults.some((row) => row.decisionTaskId === result.decisionTaskId)) throw uniqueError();
      box.verificationResults.push(result);
    },
    async findReview(verificationResultId) {
      return box.verificationReviews.find((row) => row.verificationResultId === verificationResultId) ?? null;
    },
    async insertReview(review) {
      if (box.verificationReviews.some((row) => row.verificationResultId === review.verificationResultId)) throw uniqueError();
      box.verificationReviews.push(review);
    },
    async audit() {},
  };
}

function verificationReviewIo(box: Box): ReReviewIo {
  return {
    async load(requestId) {
      const review = box.verificationReviews.find((row) => row.id === requestId);
      const result = box.verificationResults.find((row) => row.id === review?.verificationResultId);
      const task = box.tasks.find((row) => row.id === review?.decisionTaskId);
      const parent = box.verifyResults[0];
      if (!review || !result || !task || !parent) return null;
      const metrics = observations(box).map((row) => metric(`m-${row.metric}`, row.metric, row.observedValue));
      return {
        review: { ...review, status: box.verificationClaim === 'READY' ? review.status : box.verificationClaim },
        parent: {
          id: parent.id,
          tenantId: owner.tenantId,
          expectedDecision: 'VERIFY',
          conflictDetected: false,
          completedAt: parent.completedAt,
        },
        verification: {
          id: result.id,
          tenantId: result.tenantId,
          status: result.status,
          finding: result.finding,
          fingerprint: result.fingerprint,
          reviewResultId: result.reviewResultId,
          decisionTaskId: result.decisionTaskId,
          evidenceId: result.evidenceId,
        },
        task: {
          id: task.id,
          tenantId: task.tenantId,
          status: task.status,
          taskType: task.taskType,
          reviewResultId: task.reviewResultId,
          evidenceId: task.evidenceId,
        },
        evidence: {
          id: 'ev-phase33',
          tenantId: owner.tenantId,
          connectionId: 'conn-phase33',
          purpose: 'verification-fixture',
          periodStart: '2026-09-24',
          periodEnd: '2026-09-30',
          timezone: 'Asia/Seoul',
          metricIds: metrics.map((row) => row.id),
          adapterKey: 'aisle-self',
          collectedAt: '2026-10-02T00:00:00.000Z',
          contentHash: 'hash-phase33',
          piiExcluded: true,
          readOnly: true,
        },
        metrics,
        scopes: [{ tenantId: owner.tenantId, connectionId: 'conn-phase33', status: 'APPROVED' as JuryScopeStatus }],
      };
    },
    async claimReady() {
      if (box.verificationClaim === 'READY') {
        box.verificationClaim = 'RUNNING';
        return 'CLAIMED';
      }
      if (box.verificationClaim === 'EXECUTED') return 'EXECUTED';
      if (box.verificationClaim === 'RUNNING') return 'RUNNING';
      return 'NOT_READY';
    },
    async core() {
      box.coreCalls += 1;
      return reading('ACCEPT');
    },
    async commit(input) {
      box.verificationClaim = 'EXECUTED';
      if (!box.verificationRequests.some((row) => row.id === input.request.id)) box.verificationRequests.push(input.request);
      if (!box.acceptResults.some((row) => row.id === input.result.id)) box.acceptResults.push(input.result);
      const index = box.verificationReviews.findIndex((row) => row.id === input.result.reReviewRequestId);
      if (index >= 0) box.verificationReviews[index] = { ...box.verificationReviews[index], status: 'EXECUTED', updatedAt: fixtureCommand().now };
      box.childDecision = input.result.expectedDecision;
    },
    async fail() {
      box.verificationClaim = 'FAILED';
    },
    async audit() {},
  };
}

function verifyBody() {
  return {
    id: 'pending-verify',
    tenantId: owner.tenantId,
    evidenceId: 'ev-phase33',
    expectedDecision: 'VERIFY',
    conflictDetected: false,
    overclaimDetected: false,
    revisionRequired: false,
  };
}

function observations(box: Box): VerificationObservation[] {
  const ga4 = box.mode === 'inconclusive' ? 4 : 0;
  return [observation('DATABASE', 'newUsersLast7d', 0), observation('GA4', 'ga4.newUsers', ga4)];
}

function observation(source: 'DATABASE' | 'GA4', metricName: string, observedValue: number): VerificationObservation {
  return {
    source,
    sourceRef: metricName,
    metric: metricName,
    observedValue,
    availability: 'AVAILABLE',
    observedAt: '2026-10-02T00:00:00.000Z',
    methodology: '저장된 JuryNormalizedMetric만 읽었다.',
    provenance: 'evidence:ev-phase33',
  };
}

function loadIterationReview(box: Box, id: string): IterationReview | null {
  if (id === ROOT_ID) {
    return { id, tenantId: owner.tenantId, expectedDecision: 'REWORD', requestStatus: 'COMPLETED', completedAt: box.review.completedAt };
  }
  const verify = box.verifyResults.find((row) => row.id === id);
  if (verify) {
    return { id, tenantId: verify.tenantId, expectedDecision: verify.expectedDecision, requestStatus: 'COMPLETED', completedAt: verify.completedAt };
  }
  const accepted = box.acceptResults.find((row) => row.id === id);
  if (!accepted) return null;
  return { id, tenantId: accepted.tenantId, expectedDecision: accepted.expectedDecision, requestStatus: 'COMPLETED', completedAt: accepted.completedAt };
}

function lineage(box: Box): LineageIo {
  return {
    async load(id): Promise<LineageStep | null> {
      if (id === ROOT_ID) return { id, tenantId: owner.tenantId, ancestorIds: [] };
      if (box.verifyResults.some((row) => row.id === id)) return { id, tenantId: owner.tenantId, ancestorIds: [ROOT_ID] };
      if (box.acceptResults.some((row) => row.id === id) && box.verifyResults[0]) {
        return { id, tenantId: owner.tenantId, ancestorIds: [box.verifyResults[0].id] };
      }
      return null;
    },
    async cyclesFor(id): Promise<LineageCycleRef[]> {
      return box.cycle && box.cycle.rootReviewResultId === id ? [box.cycle] : [];
    },
  };
}

function resolutionIo(box: Box, reviewResultId: string): ResolutionIo {
  return {
    async load() {
      return snapshot(box, reviewResultId);
    },
    async saveCycle(next) {
      if (next.id === box.protected.id) throw new Error('LIVE_CYCLE');
      box.cycle = next;
    },
    async audit() {},
    decisionTx: decisionTx(box),
    improvementTx: {
      async findByDecisionTask() {
        return null;
      },
      async insert() {
        throw new Error('IMPROVEMENT');
      },
      async audit() {},
    },
  };
}

function snapshot(box: Box, reviewResultId: string): ResolutionSnapshot {
  const verify = box.verifyResults.find((row) => row.id === reviewResultId);
  const accepted = box.acceptResults.find((row) => row.id === reviewResultId);
  const decision = accepted ? 'ACCEPT' : verify ? 'VERIFY' : 'REWORD';
  return {
    review: {
      id: reviewResultId,
      tenantId: owner.tenantId,
      evidenceId: box.review.evidenceId,
      expectedDecision: decision,
      evidenceStrength: 'strong',
      claimStrength: 'weak',
      conflictDetected: decision === 'REWORD',
      overclaimDetected: false,
      revisionRequired: false,
    },
    evidence: { id: box.review.evidenceId, tenantId: owner.tenantId },
    chain: chain(box, reviewResultId, box.verificationResults[0]?.id ?? null),
    cycle: box.cycle,
    policy: box.policy,
  };
}

function chain(box: Box, reviewResultId: string, verificationResultId: string | null): CycleReviewNode[] {
  const verifyId = box.verifyResults[0]?.id;
  const node = (id: string, parent: string | null, decision: CycleReviewNode['decision'], conflict: boolean): CycleReviewNode => ({
    id,
    tenantId: owner.tenantId,
    evidenceIdentity: 'evidence-hash',
    decision,
    conflictDetected: conflict,
    overclaimDetected: false,
    revisionRequired: false,
    parentReviewResultId: parent,
    verificationResultId: id === verifyId ? verificationResultId : null,
    completedAt: '2026-10-02T00:00:00.000Z',
  });
  const nodes = [node(ROOT_ID, null, 'REWORD', true)];
  if (verifyId) nodes.push(node(verifyId, ROOT_ID, 'VERIFY', false));
  if (reviewResultId !== ROOT_ID && reviewResultId !== verifyId && verifyId) nodes.push(node(reviewResultId, verifyId, 'ACCEPT', false));
  return nodes;
}

function uniqueError(): Error {
  const error = new Error('unique') as Error & { code: string };
  error.code = 'P2002';
  return error;
}
