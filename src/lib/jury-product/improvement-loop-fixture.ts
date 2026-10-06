/**
 * Connects one isolated improvement cycle through the existing modules.
 * It does not spawn a process or touch a live review.
 */
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentAdapter } from './agents/agent-adapter';
import { fakeCursorAdapter } from './agents/fake-cursor-adapter';
import type { AgentExecutionDraft, HandoffTask, HandoffProvenance, HandoffWriteTx } from './agent-handoff';
import type { ExecutionArtifact, ExecutionWriteTx } from './agent-execution';
import {
  type ChangeGateReviewDraft,
  type ChangeGateReviewExecIo,
  type ChangeGateReviewRequestTx,
  type ChangeGateReviewResult,
} from './change-gate-rereview';
import type { ChangeGateDraft, ChangeGateWriteTx, ChangeInspection } from './change-gate';
import { resolveReReviewDecision, type ResolutionIo, type ResolutionSnapshot } from './decision-cycle-resolution';
import type { LineageCycleRef, LineageIo, LineageStep } from './decision-cycle-lineage';
import { executeImprovementTask } from './improvement-agent-run';
import { runImprovementAutoLoop, type AutoLoopResult } from './improvement-auto-loop';
import { runChangeGateForExecution } from './improvement-change-gate';
import { runApprovedGateReReview } from './improvement-gate-rereview';
import { startNewImprovementCycle, type StartIo, type StartReview } from './improvement-cycle-start';
import { reenterReReviewDecision } from './improvement-decision-reentry';
import { runSingleImprovementIteration, type IterationReview } from './improvement-iteration';
import { PRODUCT_LOOP_GUARD_DEFAULTS, type CycleReviewNode, type DecisionCycleDraft } from './loop-guard';
import type { JuryMembership, JuryNormalizedMetric, JuryReviewRequest } from './records';
import type { FrozenCoreReading } from './review-boundary';
import { REWORD_CONSTRAINTS, type ImprovementTaskDraft } from './improvement-bridge';
import type { DecisionTaskDraft } from './decision-task';

export const FIXTURE_ROOT = 'data/jury-product/workspaces/re-review-fixture';
export const FIXTURE_FILE = 'phase31-note.md';
const owner: JuryMembership = {
  id: 'mem-phase31',
  tenantId: 'tenant-phase31',
  userId: 'user-phase31',
  role: 'OWNER',
  createdAt: '2026-10-02T00:00:00.000Z',
};

export type FixtureMode = 'accept' | 'agent-fail' | 'gated' | 'blocked' | 'rereview-refused';

export function fixtureCommand(rootReviewResultId = 'phase31-root') {
  return {
    userId: owner.userId,
    memberships: [owner],
    clientTenantId: 'forged-tenant',
    now: '2026-10-02T11:30:00.000Z',
    rootReviewResultId,
  };
}

export async function openFixture(mode: FixtureMode = 'accept') {
  const box = createBox(mode);
  await seed(box);
  return box;
}

export async function runConnected(box: Box): Promise<AutoLoopResult> {
  return runImprovementAutoLoop(fixtureCommand(), connect(box));
}

export async function runFixtureLoop(mode: FixtureMode = 'accept') {
  const box = await openFixture(mode);
  const outcome = await runConnected(box);
  return view(box, outcome);
}

export function view(box: Box, outcome: AutoLoopResult) {
  return {
    outcome,
    executions: box.executions,
    gates: box.gates,
    reviews: box.reviews,
    requests: box.requests,
    results: box.results,
    tasks: box.tasks,
    improvements: box.improvements,
    childDecision: box.childDecision,
    cycleStatus: box.cycle?.status ?? 'MISSING',
    cycleId: box.cycle?.id ?? null,
    coreCalls: box.coreCalls,
    adapterCalls: box.adapterCalls,
    protected: box.protected,
  };
}

type Box = ReturnType<typeof createBox>;

function createBox(mode: FixtureMode) {
  const review = seedReview();
  return {
    mode,
    review,
    executions: [] as AgentExecutionDraft[],
    artifacts: new Map<string, ExecutionArtifact>(),
    gates: [] as ChangeGateDraft[],
    reviews: [] as ChangeGateReviewDraft[],
    tasks: [] as DecisionTaskDraft[],
    improvements: [] as ImprovementTaskDraft[],
    cycle: null as DecisionCycleDraft | null,
    childDecision: null as string | null,
    claim: 'READY' as ChangeGateReviewDraft['status'],
    storedResult: null as ChangeGateReviewResult | null,
    requests: [] as JuryReviewRequest[],
    results: [] as ChangeGateReviewResult[],
    coreCalls: 0,
    adapterCalls: 0,
    protected: {
      id: '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e',
      updatedAt: '2026-10-01T16:33:57.676Z',
      iteration: 2,
      status: 'ACTIVE',
    },
  };
}

function connect(box: Box) {
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
      return PRODUCT_LOOP_GUARD_DEFAULTS;
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
        { ...fixtureCommand(), improvementTaskId, timeoutMs: 1000, clock: () => fixtureCommand().now },
        { load: async () => (task ? handoffTask(task) : null), handoff: handoffTx(box), execution: executionTx(box) },
        adapterFor(box),
      );
      if (!ran.ok) return { ok: false as const, reason: ran.reason };
      if (ran.execution.status !== 'COMPLETED') return { ok: false as const, reason: 'AGENT_FAILED' };
      return { ok: true as const, executionId: ran.execution.id, status: ran.execution.status };
    },
    async gate(executionId: string) {
      const ran = await runChangeGateForExecution(
        { ...fixtureCommand(), executionId },
        { load: async (id) => loadGate(box, id), inspect: (root) => inspectFixture(box, root), gate: gateTx(box) },
      );
      if (!ran.ok) return { ok: false as const, reason: ran.reason, status: 'GATED' };
      return { ok: true as const, id: ran.gate.id, status: ran.gate.status };
    },
    async rereview(changeGateResultId: string) {
      const before = box.coreCalls;
      const ran = await runApprovedGateReReview(
        { ...fixtureCommand(), siteName: 'phase31-fixture', gate: gateView(box, changeGateResultId), ...reviewLinks(box) },
        { request: requestTx(box), execution: reviewExec(box) },
      );
      if (!ran.ok) return { ok: false as const, reason: ran.reason };
      box.childDecision = ran.result.expectedDecision;
      return { ok: true as const, reviewResultId: ran.result.id, coreRuns: box.coreCalls - before };
    },
    async verification() {
      return { ok: false as const, reason: 'VERIFICATION_STOPPED', status: 'INCONCLUSIVE' };
    },
    async verificationReview() {
      return { ok: false as const, reason: 'VERIFICATION_STOPPED' };
    },
  };
}

function adapterFor(box: Box): AgentAdapter {
  if (box.mode === 'agent-fail') return counting(box, fakeCursorAdapter('fail'));
  return counting(box, {
    async run() {
      const absolute = path.join(process.cwd(), FIXTURE_ROOT, FIXTURE_FILE);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, '측정된 범위의 문구만 사용합니다.\n', 'utf8');
      return {
        ok: true as const,
        changedFiles: [FIXTURE_FILE],
        summary: 'fixture copy',
        testsRun: ['fixture'],
        testsPassed: true,
      };
    },
  });
}

function counting(box: Box, adapter: AgentAdapter): AgentAdapter {
  return {
    async run(input) {
      box.adapterCalls += 1;
      return adapter.run(input);
    },
  };
}

async function inspectFixture(box: Box, root: string): Promise<ChangeInspection> {
  if (root !== FIXTURE_ROOT || box.mode === 'gated') return { files: [], present: [] };
  if (box.mode === 'blocked') {
    return { files: [{ path: FIXTURE_FILE, kind: 'added', additions: 1, deletions: 0, patch: 'password = hidden' }], present: [FIXTURE_FILE] };
  }
  const absolute = path.join(process.cwd(), root, FIXTURE_FILE);
  try {
    await access(absolute);
  } catch {
    return { files: [], present: [] };
  }
  return { files: [{ path: FIXTURE_FILE, kind: 'added', additions: 1, deletions: 0 }], present: [FIXTURE_FILE] };
}

export async function removeFixtureFile(): Promise<void> {
  await unlink(path.join(process.cwd(), FIXTURE_ROOT, FIXTURE_FILE)).catch(() => undefined);
}

function seedReview(): StartReview {
  return {
    id: 'phase31-root',
    tenantId: owner.tenantId,
    evidenceId: 'ev-phase31',
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

async function seed(box: Box) {
  await startNewImprovementCycle({ ...fixtureCommand(), reviewResultId: box.review.id }, startIo(box));
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
      return { id: 'policy-phase31', policy: PRODUCT_LOOP_GUARD_DEFAULTS };
    },
    async insertCycle(cycle) {
      if (box.cycle) {
        const error = new Error('unique') as Error & { code: string };
        error.code = 'P2002';
        throw error;
      }
      box.cycle = cycle;
    },
    async auditCycle() {},
    decisionTx: {
      async findByResultAndType(reviewResultId, taskType) {
        return box.tasks.find((row) => row.reviewResultId === reviewResultId && row.taskType === taskType) ?? null;
      },
      async insert(task) {
        if (box.tasks.some((row) => row.reviewResultId === task.reviewResultId && row.taskType === task.taskType)) {
          const error = new Error('unique') as Error & { code: string };
          error.code = 'P2002';
          throw error;
        }
        box.tasks.push(task);
      },
    },
    improvementTx: {
      async findByDecisionTask(decisionTaskId) {
        return box.improvements.find((row) => row.decisionTaskId === decisionTaskId) ?? null;
      },
      async insert(task) {
        if (box.improvements.some((row) => row.decisionTaskId === task.decisionTaskId)) {
          const error = new Error('unique') as Error & { code: string };
          error.code = 'P2002';
          throw error;
        }
        box.improvements.push(task);
      },
      async audit() {},
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
      if (box.executions.some((row) => row.taskId === execution.taskId && row.agent === execution.agent)) {
        const error = new Error('unique') as Error & { code: string };
        error.code = 'P2002';
        throw error;
      }
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
    testResults: {
      available: artifact?.testsPassed != null,
      passed: artifact?.testsPassed ?? null,
      commands: artifact?.testsRun ?? [],
    },
  };
}

function gateTx(box: Box): ChangeGateWriteTx {
  return {
    async findByExecution(executionId) {
      return box.gates.find((row) => row.executionId === executionId) ?? null;
    },
    async insert(row) {
      if (box.gates.some((item) => item.executionId === row.executionId)) {
        const error = new Error('unique') as Error & { code: string };
        error.code = 'P2002';
        throw error;
      }
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

function reviewLinks(box: Box) {
  return {
    reason: { code: 'APPROVED_CHANGE', message: 'The approved fixture change is ready for review.' },
    executionTenantId: owner.tenantId,
    taskTenantId: owner.tenantId,
    parent: { id: box.review.id, tenantId: owner.tenantId },
    evidence: evidence(),
    sourceEvidenceId: 'ev-source',
    metrics: [metric()],
    scopes: [{ tenantId: owner.tenantId, connectionId: 'conn-phase31', status: 'APPROVED' as const }],
  };
}

function evidence() {
  return {
    id: 'ev-phase31',
    tenantId: owner.tenantId,
    connectionId: 'conn-phase31',
    purpose: 'change-gate-rereview-fixture',
    periodStart: '2026-09-24',
    periodEnd: '2026-09-30',
    timezone: 'Asia/Seoul',
    metricIds: ['m-phase31'],
    adapterKey: 'aisle-self',
    collectedAt: '2026-10-02T00:00:00.000Z',
    contentHash: 'hash-phase31',
    piiExcluded: true,
    readOnly: true,
  };
}

function metric(): JuryNormalizedMetric {
  return {
    id: 'm-phase31',
    tenantId: owner.tenantId,
    connectionId: 'conn-phase31',
    evidenceId: 'ev-phase31',
    metric: 'newUsersLast7d',
    value: 0,
    unit: 'COUNT',
    periodStart: '2026-09-24',
    periodEnd: '2026-09-30',
    timezone: 'Asia/Seoul',
    sourceSystem: 'DATABASE',
    sourceRef: 'newUsersLast7d',
    collectedAt: '2026-10-02T00:00:00.000Z',
    availability: 'AVAILABLE',
    rawPayloadRef: 'evidence-pack:newUsersLast7d',
    adapterKey: 'aisle-self',
    adapterVersion: 'aisle-self-v1',
    ruleId: 'normalize.evidence-pack.aggregate.v1',
  };
}

const acceptReading: FrozenCoreReading = {
  boardRunId: 'run-phase31',
  evidenceStrength: 'strong',
  claimStrength: 'weak',
  conflictDetected: false,
  overclaimDetected: false,
  revisionRequired: false,
  expectedDecision: 'ACCEPT',
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
  completedAt: '2026-10-02T11:30:00.000Z',
};

function requestTx(box: Box): ChangeGateReviewRequestTx {
  return {
    async findByGate(id) {
      return box.reviews.find((row) => row.changeGateResultId === id) ?? null;
    },
    async insert(row) {
      if (box.reviews.some((item) => item.changeGateResultId === row.changeGateResultId)) {
        const error = new Error('unique') as Error & { code: string };
        error.code = 'P2002';
        throw error;
      }
      box.reviews.push(row);
    },
    async auditRequested() {},
  };
}

function reviewExec(box: Box): ChangeGateReviewExecIo {
  return {
    async load(requestId) {
      const review = box.reviews.find((row) => row.id === requestId);
      if (!review) return null;
      return {
        ...reviewLinks(box),
        gate: gateView(box, review.changeGateResultId),
        review: { ...review, status: box.claim, reviewResultId: box.storedResult?.id ?? review.reviewResultId },
        result: box.storedResult,
      };
    },
    async claimReady() {
      if (box.claim === 'READY') {
        box.claim = 'RUNNING';
        return 'CLAIMED';
      }
      if (box.claim === 'EXECUTED') return 'EXECUTED';
      if (box.claim === 'RUNNING') return 'RUNNING';
      return 'NOT_READY';
    },
    async core() {
      box.coreCalls += 1;
      return acceptReading;
    },
    async commit(input) {
      box.storedResult = input.result;
      box.claim = 'EXECUTED';
      const index = box.reviews.findIndex((row) => row.id === input.review.id);
      if (index >= 0) box.reviews[index] = input.review;
      if (!box.requests.some((row) => row.id === input.request.id)) box.requests.push(input.request);
      if (!box.results.some((row) => row.id === input.result.id)) box.results.push(input.result);
      box.childDecision = input.result.expectedDecision;
    },
    async fail(requestId, errorCode) {
      box.claim = 'FAILED';
      const index = box.reviews.findIndex((row) => row.id === requestId);
      if (index >= 0) box.reviews[index] = { ...box.reviews[index], status: 'FAILED', errorCode };
    },
    async audit() {},
  };
}

function loadIterationReview(box: Box, id: string): IterationReview | null {
  if (id === box.review.id) {
    return { id, tenantId: box.review.tenantId, expectedDecision: box.review.expectedDecision, requestStatus: 'COMPLETED', completedAt: box.review.completedAt };
  }
  if (box.results.some((row) => row.id === id)) {
    return { id, tenantId: owner.tenantId, expectedDecision: 'ACCEPT', requestStatus: 'COMPLETED', completedAt: acceptReading.completedAt };
  }
  return null;
}

function lineage(box: Box): LineageIo {
  return {
    async load(id): Promise<LineageStep | null> {
      if (id === box.review.id) return { id, tenantId: owner.tenantId, ancestorIds: [] };
      const child = box.reviews.find((row) => row.reviewResultId === id) ?? box.results.find((row) => row.id === id);
      if (!child) return null;
      return { id, tenantId: owner.tenantId, ancestorIds: [child.parentReviewResultId] };
    },
    async cyclesFor(id): Promise<LineageCycleRef[]> {
      if (!box.cycle || box.cycle.rootReviewResultId !== id) return [];
      return [box.cycle];
    },
  };
}

function resolutionIo(box: Box, reviewResultId: string): ResolutionIo {
  const child = reviewResultId !== box.review.id;
  const node = (id: string, parent: string | null, decision: CycleReviewNode['decision']): CycleReviewNode => ({
    id,
    tenantId: owner.tenantId,
    evidenceIdentity: 'evidence-hash',
    decision,
    conflictDetected: decision === 'REWORD',
    overclaimDetected: decision === 'REWORD',
    revisionRequired: decision === 'REWORD',
    parentReviewResultId: parent,
    verificationResultId: null,
    completedAt: '2026-10-02T00:00:00.000Z',
  });
  const snapshot = (): ResolutionSnapshot => ({
    review: {
      id: reviewResultId,
      tenantId: owner.tenantId,
      evidenceId: 'ev-phase31',
      expectedDecision: child ? 'ACCEPT' : 'REWORD',
      evidenceStrength: 'strong',
      claimStrength: 'moderate',
      conflictDetected: !child,
      overclaimDetected: false,
      revisionRequired: false,
    },
    evidence: { id: 'ev-phase31', tenantId: owner.tenantId },
    chain: [node(box.review.id, null, 'REWORD'), ...(child ? [node(reviewResultId, box.review.id, 'ACCEPT')] : [])],
    cycle: box.cycle,
    policy: PRODUCT_LOOP_GUARD_DEFAULTS,
  });
  return {
    async load() {
      return box.cycle ? { ...snapshot(), cycle: box.cycle } : snapshot();
    },
    async saveCycle(next) {
      if (next.id === box.protected.id) throw new Error('LIVE_CYCLE');
      box.cycle = next;
    },
    async audit() {},
    decisionTx: {
      async findByResultAndType() {
        return null;
      },
      async insert() {},
    },
    improvementTx: {
      async findByDecisionTask() {
        return null;
      },
      async insert() {},
      async audit() {},
    },
  };
}
