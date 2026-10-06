/**
 * Connects one isolated verification cycle through the existing modules.
 * It does not spawn a process, call an agent, or touch a live review.
 */
import { resolveReReviewDecision, type ResolutionIo, type ResolutionSnapshot } from './decision-cycle-resolution';
import type { DecisionTaskDraft, DecisionTaskWriteTx } from './decision-task';
import type { LineageCycleRef, LineageIo, LineageStep } from './decision-cycle-lineage';
import { runImprovementAutoLoop, type AutoLoopResult } from './improvement-auto-loop';
import { reenterReReviewDecision } from './improvement-decision-reentry';
import { runSingleImprovementIteration, type IterationReview } from './improvement-iteration';
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

const owner: JuryMembership = {
  id: 'mem-phase32',
  tenantId: 'tenant-phase32',
  userId: 'user-phase32',
  role: 'OWNER',
  createdAt: '2026-10-02T00:00:00.000Z',
};

export type VerificationFixtureMode =
  | 'accept'
  | 'inconclusive'
  | 'resolution-fail'
  | 'rereview-refused'
  | 'guard'
  | 'secret';

const ROOT_ID = 'phase32-root';
const VERIFY_ID = 'phase32-verify';

export function fixtureCommand(actor: JuryMembership = owner) {
  return {
    userId: actor.userId,
    memberships: [actor],
    clientTenantId: 'forged-tenant',
    now: '2026-10-02T11:42:00.000Z',
    rootReviewResultId: VERIFY_ID,
  };
}

export async function openFixture(mode: VerificationFixtureMode = 'accept') {
  const box = createBox(mode);
  await resolveReReviewDecision({ ...fixtureCommand(), reviewResultId: VERIFY_ID }, resolutionIo(box, VERIFY_ID));
  if (mode === 'resolution-fail') {
    const task = box.tasks[0];
    if (task) task.status = 'BLOCKED';
  }
  return box;
}

export async function runConnected(box: Box, actor: JuryMembership = owner): Promise<AutoLoopResult> {
  return runImprovementAutoLoop(fixtureCommand(actor), connect(box, actor));
}

export function view(box: Box, outcome: AutoLoopResult) {
  return {
    outcome,
    tasks: box.tasks,
    verificationResults: box.verificationResults,
    reviews: box.reviews,
    requests: box.requests,
    results: box.results,
    childDecision: box.childDecision,
    cycleStatus: box.cycle.status,
    cycleId: box.cycle.id,
    blockedReason: box.cycle.blockedReason,
    coreCalls: box.coreCalls,
    agentCalls: box.agentCalls,
    gateCalls: box.gateCalls,
    protected: box.protected,
  };
}

type Box = ReturnType<typeof createBox>;

function createBox(mode: VerificationFixtureMode) {
  const conflict = mode === 'inconclusive';
  return {
    mode,
    conflict,
    tasks: [] as DecisionTaskDraft[],
    verificationResults: [] as VerificationResultDraft[],
    reviews: [] as VerificationReviewDraft[],
    requests: [] as JuryReviewRequest[],
    results: [] as ReReviewResult[],
    childDecision: null as string | null,
    claim: 'READY' as VerificationReviewDraft['status'],
    coreCalls: 0,
    agentCalls: 0,
    gateCalls: 0,
    policy: (mode === 'guard'
      ? { ...PRODUCT_LOOP_GUARD_DEFAULTS, maxVerificationAttempts: 1 }
      : PRODUCT_LOOP_GUARD_DEFAULTS) satisfies ProductLoopGuardPolicy,
    cycle: {
      id: 'phase32-cycle',
      tenantId: owner.tenantId,
      rootReviewResultId: ROOT_ID,
      currentReviewResultId: ROOT_ID,
      iteration: 1,
      verificationAttempts: 0,
      sameDecisionCount: 1,
      sameConflictCount: 0,
      decisionFingerprint: 'before',
      conflictFingerprint: 'before',
      status: 'ACTIVE',
      blockedReason: null,
      policyId: 'policy-phase32',
      startedAt: '2026-10-02T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    } as DecisionCycleDraft,
    protected: {
      id: '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e',
      updatedAt: '2026-10-01T16:33:57.676Z',
      iteration: 2,
      status: 'ACTIVE',
    },
  };
}

function connect(box: Box, actor: JuryMembership) {
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
            start: () => {
              throw new Error('START');
            },
          }),
      }),
    async policy() {
      return box.policy;
    },
    async counters() {
      return {
        iteration: box.cycle.iteration,
        verificationAttempts: box.cycle.verificationAttempts,
        sameDecisionCount: box.cycle.sameDecisionCount,
        sameConflictCount: box.cycle.sameConflictCount,
        runtimeMs: null,
        costUsd: null,
      };
    },
    async alreadyDone() {
      return false;
    },
    async markDone() {},
    async agent() {
      box.agentCalls += 1;
      return { ok: false as const, reason: 'AGENT_FAILED' };
    },
    async gate() {
      box.gateCalls += 1;
      return { ok: false as const, reason: 'CHANGE_GATE_GATED', status: 'GATED' };
    },
    async rereview() {
      return { ok: false as const, reason: 'RE-REVIEW_NOT_APPROVED' };
    },
    async verification(taskId: string) {
      const task = box.tasks.find((row) => row.id === taskId) ?? null;
      const ran = await resolveVerification(
        {
          ...fixtureCommand(actor),
          task,
          reviewResult: reviewBody(box),
          evidence: evidenceIdentity(box),
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
      if (!task || !result) return { ok: false as const, reason: 'RESULT_REQUIRED' };
      const guard = evaluateLoopGuard({
        policy: box.policy,
        ...foldDecisionCycle(chain(box, VERIFY_ID, result.id)),
        runtimeMs: null,
        costUsd: null,
      });
      if (!guard.allowed) {
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
          evidence: evidenceIdentity(box),
          parentReviewResultId: VERIFY_ID,
        },
        verificationTx(box),
      );
      if (!requested.ok) return { ok: false as const, reason: requested.reason };
      const before = box.coreCalls;
      const executed = await executeVerificationReReview(
        { ...fixtureCommand(actor), requestId: requested.review.id, siteName: 'phase32-fixture' },
        reviewIo(box),
      );
      if (!executed.ok) return { ok: false as const, reason: executed.reason };
      box.childDecision = executed.result.expectedDecision;
      return { ok: true as const, reviewResultId: executed.result.id, coreRuns: box.coreCalls - before };
    },
  };
}

function verificationTx(box: Box): VerificationWriteTx {
  return {
    tasks: box.tasks,
    results: box.verificationResults,
    reviews: box.reviews,
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
      return box.reviews.find((row) => row.verificationResultId === verificationResultId) ?? null;
    },
    async insertReview(review) {
      if (box.reviews.some((row) => row.verificationResultId === review.verificationResultId)) throw uniqueError();
      box.reviews.push(review);
    },
    async audit() {},
  };
}

function reviewIo(box: Box): ReReviewIo {
  return {
    async load(requestId) {
      const review = box.reviews.find((row) => row.id === requestId);
      const result = box.verificationResults.find((row) => row.id === review?.verificationResultId);
      const task = box.tasks.find((row) => row.id === review?.decisionTaskId);
      if (!review || !result || !task) return null;
      const metrics = metricsFor(box);
      return {
        review: { ...review, status: box.claim === 'READY' ? review.status : box.claim },
        parent: {
          id: VERIFY_ID,
          tenantId: owner.tenantId,
          expectedDecision: 'VERIFY',
          conflictDetected: box.conflict,
          completedAt: '2026-10-02T00:00:00.000Z',
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
          ...evidenceIdentity(box),
          connectionId: 'conn-phase32',
          purpose: 'verification-fixture',
          periodStart: '2026-09-24',
          periodEnd: '2026-09-30',
          timezone: 'Asia/Seoul',
          metricIds: metrics.map((row) => row.id),
          adapterKey: 'aisle-self',
          collectedAt: '2026-10-02T00:00:00.000Z',
          piiExcluded: true,
          readOnly: true,
        },
        metrics,
        scopes: [
          {
            tenantId: owner.tenantId,
            connectionId: 'conn-phase32',
            status: (box.mode === 'rereview-refused' ? 'PROPOSED' : 'APPROVED') as JuryScopeStatus,
          },
        ],
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
      box.claim = 'EXECUTED';
      if (!box.requests.some((row) => row.id === input.request.id)) box.requests.push(input.request);
      if (!box.results.some((row) => row.id === input.result.id)) box.results.push(input.result);
      const index = box.reviews.findIndex((row) => row.id === input.result.reReviewRequestId);
      if (index >= 0) box.reviews[index] = { ...box.reviews[index], status: 'EXECUTED', updatedAt: fixtureCommand().now };
      box.childDecision = input.result.expectedDecision;
    },
    async fail() {
      box.claim = 'FAILED';
    },
    async audit() {},
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

function snapshot(box: Box, reviewResultId: string): ResolutionSnapshot {
  const child = box.results.find((row) => row.id === reviewResultId);
  const secret = box.mode === 'secret';
  return {
    review: {
      id: reviewResultId,
      tenantId: owner.tenantId,
      evidenceId: secret ? 'postgres://hidden' : 'ev-phase32',
      expectedDecision: child ? 'ACCEPT' : 'VERIFY',
      evidenceStrength: 'strong',
      claimStrength: 'weak',
      conflictDetected: child ? false : box.conflict,
      overclaimDetected: false,
      revisionRequired: false,
    },
    evidence: { id: secret ? 'postgres://hidden' : 'ev-phase32', tenantId: owner.tenantId },
    chain: chain(box, reviewResultId, box.verificationResults[0]?.id ?? null),
    cycle: box.cycle,
    policy: box.policy,
  };
}

function chain(box: Box, reviewResultId: string, verificationResultId: string | null): CycleReviewNode[] {
  const node = (id: string, parent: string | null, decision: CycleReviewNode['decision'], conflict: boolean): CycleReviewNode => ({
    id,
    tenantId: owner.tenantId,
    evidenceIdentity: 'evidence-hash',
    decision,
    conflictDetected: conflict,
    overclaimDetected: false,
    revisionRequired: false,
    parentReviewResultId: parent,
    verificationResultId: id === VERIFY_ID ? verificationResultId : null,
    completedAt: '2026-10-02T00:00:00.000Z',
  });
  const nodes = [node(ROOT_ID, null, 'VERIFY', false), node(VERIFY_ID, ROOT_ID, 'VERIFY', box.conflict)];
  if (reviewResultId !== VERIFY_ID && reviewResultId !== ROOT_ID) nodes.push(node(reviewResultId, VERIFY_ID, 'ACCEPT', false));
  return nodes;
}

function lineage(box: Box): LineageIo {
  return {
    async load(id): Promise<LineageStep | null> {
      if (id === ROOT_ID) return { id, tenantId: owner.tenantId, ancestorIds: [] };
      if (id === VERIFY_ID) return { id, tenantId: owner.tenantId, ancestorIds: [ROOT_ID] };
      if (box.results.some((row) => row.id === id)) return { id, tenantId: owner.tenantId, ancestorIds: [VERIFY_ID] };
      return null;
    },
    async cyclesFor(id): Promise<LineageCycleRef[]> {
      return box.cycle.rootReviewResultId === id ? [box.cycle] : [];
    },
  };
}

function loadIterationReview(box: Box, id: string): IterationReview | null {
  if (id === VERIFY_ID) {
    return {
      id,
      tenantId: owner.tenantId,
      expectedDecision: 'VERIFY',
      requestStatus: 'COMPLETED',
      completedAt: '2026-10-02T00:00:00.000Z',
    };
  }
  const child = box.results.find((row) => row.id === id);
  if (!child) return null;
  return {
    id,
    tenantId: child.tenantId,
    expectedDecision: child.expectedDecision,
    requestStatus: 'COMPLETED',
    completedAt: child.completedAt,
  };
}

function reviewBody(box: Box) {
  return {
    id: VERIFY_ID,
    tenantId: owner.tenantId,
    evidenceId: 'ev-phase32',
    expectedDecision: 'VERIFY',
    conflictDetected: box.conflict,
    overclaimDetected: false,
    revisionRequired: false,
  };
}

function evidenceIdentity(box: Box) {
  return { id: 'ev-phase32', tenantId: owner.tenantId, contentHash: box.mode === 'secret' ? 'postgres://hidden' : 'hash-phase32' };
}

function observations(box: Box): VerificationObservation[] {
  const ga4 = box.mode === 'inconclusive' ? 4 : 0;
  return [
    observation('DATABASE', 'newUsersLast7d', 0),
    observation('GA4', 'ga4.newUsers', ga4),
  ];
}

function observation(source: 'DATABASE' | 'GA4', metric: string, observedValue: number): VerificationObservation {
  return {
    source,
    sourceRef: metric,
    metric,
    observedValue,
    availability: 'AVAILABLE',
    observedAt: '2026-10-02T00:00:00.000Z',
    methodology: '저장된 JuryNormalizedMetric만 읽었다.',
    provenance: 'evidence:ev-phase32',
  };
}

function metricsFor(box: Box): JuryNormalizedMetric[] {
  return observations(box).map((row) => ({
    id: `m-${row.metric}`,
    tenantId: owner.tenantId,
    connectionId: 'conn-phase32',
    evidenceId: 'ev-phase32',
    metric: row.metric,
    value: row.observedValue,
    unit: 'COUNT',
    periodStart: '2026-09-24',
    periodEnd: '2026-09-30',
    timezone: 'Asia/Seoul',
    sourceSystem: row.source,
    sourceRef: row.metric,
    collectedAt: row.observedAt,
    availability: 'AVAILABLE',
    rawPayloadRef: `evidence-pack:${row.metric}`,
    adapterKey: 'aisle-self',
    adapterVersion: 'aisle-self-v1',
    ruleId: 'normalize.evidence-pack.aggregate.v1',
  }));
}

const acceptReading: FrozenCoreReading = {
  boardRunId: 'run-phase32',
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
  completedAt: '2026-10-02T11:42:00.000Z',
};

function uniqueError(): Error {
  const error = new Error('unique') as Error & { code: string };
  error.code = 'P2002';
  return error;
}
