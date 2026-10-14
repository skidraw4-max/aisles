/**
 * Intent check stops a plain contradiction before the change gate.
 * It does not write, audit, or call a live review.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import { runImprovementAutoLoop } from './improvement-auto-loop';
import { REWORD_CONSTRAINTS, REWORD_FIXTURE_OBJECTIVE } from './improvement-bridge';
import { evaluateImprovementIntent, type ImprovementIntentChange, type ImprovementIntentInput, type ImprovementIntentResult } from './improvement-intent-check';
import { PRODUCT_LOOP_GUARD_DEFAULTS } from './loop-guard';
import type { JuryMembership } from './records';

const COPY = 'workspace/mock-aisle/user-facing-copy.ts';
const COPY_TEXT = 'export const userFacingCopy = "측정된 Evidence가 직접 지지하는 범위의 문구만 사용합니다.";\n';
const METRIC_TEXT = 'export function loadMetrics() {\n  db.newUsersLast7d = 4;\n}\n';
const owner: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'OWNER',
  createdAt: '2026-10-02T00:00:00.000Z',
};

function input(text: string, patch: Partial<ImprovementIntentInput> = {}): ImprovementIntentInput {
  const change: ImprovementIntentChange = { path: COPY, kind: 'modified', text };
  return {
    actorTenantId: 'tenant-a',
    taskTenantId: 'tenant-a',
    executionTenantId: 'tenant-a',
    objective: REWORD_FIXTURE_OBJECTIVE,
    constraints: [...REWORD_CONSTRAINTS],
    provenance: { sourceDecision: 'REWORD' },
    allowedPaths: [COPY],
    workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' },
    changedFiles: [COPY],
    changes: [change],
    summary: null,
    ...patch,
  };
}

test('a copy edit stays inside the task intent', () => {
  const safe = evaluateImprovementIntent(input(COPY_TEXT));
  assert.deepEqual(safe, { status: 'SAFE', code: 'SAFE', reason: 'WITHIN_TASK_INTENT' });
  assert.deepEqual(evaluateImprovementIntent(input(`${COPY_TEXT}// production migration token\n`)), safe);
  const noted = evaluateImprovementIntent(input(`${COPY_TEXT}// newUsersLast7d = 4\n`));
  assert.equal(noted.status, 'SAFE');
});

test('a metric rewrite and forbidden edits stay out of the change gate', () => {
  const mismatch = evaluateImprovementIntent(input(METRIC_TEXT));
  assert.equal(mismatch.code, 'INTENT_MISMATCH');
  assert.equal(JSON.stringify(mismatch).includes('postgres://'), false);
  for (const text of [
    'const ref = process.env.DATABASE_URL;\n',
    'const authConfig = { enabled: false };\n',
    'vercel deploy --prod\n',
    'ALTER TABLE users ADD COLUMN note text;\n',
    'await prisma.$executeRaw`select 1`;\n',
  ]) {
    const blocked = evaluateImprovementIntent(input(text));
    assert.equal(blocked.code, 'FORBIDDEN_BEHAVIOR', text);
    assert.equal(JSON.stringify(blocked).includes('DATABASE_URL'), false);
  }
  assert.equal(evaluateImprovementIntent(input(COPY_TEXT, { executionTenantId: 'tenant-b' })).code, 'TENANT_MISMATCH');
});

test('intent runs only after a safe scope and does not replace the change gate', async () => {
  const safe = await once(COPY_TEXT, 'open');
  assert.equal(safe.outcome.stop, 'CHANGE_GATE_GATED');
  assert.equal(safe.agents, 1);
  assert.equal(safe.intents, 1);
  assert.equal(safe.gates, 1);
  assert.equal(safe.rereviews, 0);
  assert.equal(safe.cores, 0);

  const mismatch = await once(METRIC_TEXT, 'open');
  assert.equal(mismatch.outcome.stop, 'INTENT_BLOCKED');
  assert.equal(mismatch.agents, 1);
  assert.equal(mismatch.intents, 1);
  assert.equal(mismatch.gates, 0);
  assert.equal(mismatch.rereviews, 0);
  assert.equal(mismatch.cores, 0);

  const scoped = await once(COPY_TEXT, 'scope-blocked');
  assert.equal(scoped.outcome.stop, 'SCOPE_BLOCKED');
  assert.equal(scoped.intents, 0);
  assert.equal(scoped.gates, 0);

  const foreign = await once(COPY_TEXT, 'open', { executionTenantId: 'tenant-b' });
  assert.equal(foreign.outcome.stop, 'TENANT_MISMATCH');
  assert.equal(foreign.gates, 0);

  const first = harness(COPY_TEXT, 'open', {}, 'APPROVED');
  const completed = await runImprovementAutoLoop(command(), first.io);
  assert.equal(completed.stop, 'ACCEPT');
  assert.equal(first.agents, 1);
  const again = await runImprovementAutoLoop(command(), first.io);
  assert.equal(again.stop, 'ALREADY_COMPLETED');
  assert.equal(first.agents, 1);
  assert.equal(first.intents, 1);

  const shared = harness(COPY_TEXT, 'open');
  const [left, right] = await Promise.all([runImprovementAutoLoop(command(), shared.io), runImprovementAutoLoop(command(), shared.io)]);
  assert.equal(left.stop, 'CHANGE_GATE_GATED');
  assert.equal(right.stop, 'CHANGE_GATE_GATED');
  assert.deepEqual(shared.checks[0], shared.checks[1]);
  assert.equal(shared.agents, 1);
  assert.equal(shared.gates, 1);
});

test('intent check adds no permission and keeps secrets out of its source contract', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/improvement-intent-check.ts'), 'utf8');
  assert.equal(source.includes('automation.write'), false);
  assert.equal(source.includes('juryAuditEvent'), false);
  assert.equal(source.includes('postgres://'), false);
  assert.equal(source.includes('3707202563ecae9b38'), false);
});

function command() {
  return {
    userId: owner.userId,
    memberships: [owner],
    clientTenantId: 'forged-tenant',
    now: '2026-10-02T07:30:00.000Z',
    rootReviewResultId: 'root-1',
  };
}

async function once(text: string, mode: 'open' | 'scope-blocked', patch: Partial<ImprovementIntentInput> = {}) {
  const box = harness(text, mode, patch);
  const outcome = await runImprovementAutoLoop(command(), box.io);
  return { outcome, agents: box.agents, intents: box.intents, gates: box.gates, rereviews: box.rereviews, cores: box.cores };
}

function harness(text: string, mode: 'open' | 'scope-blocked', patch: Partial<ImprovementIntentInput> = {}, gateStatus = 'GATED') {
  const box = { agents: 0, intents: 0, gates: 0, rereviews: 0, cores: 0, checks: [] as ImprovementIntentResult[], done: false };
  let execution: string | null = null;
  let gate: string | null = null;
  const intentInput = input(text, patch);
  const io = {
    async iteration(step: { reviewResultId: string }) {
      if (step.reviewResultId !== 'root-1') {
        return {
          ok: true as const,
          decision: 'ACCEPT' as const,
          nextAction: 'NONE' as const,
          cycleStatus: 'COMPLETED',
          guard: 'ALLOWED',
          verificationTaskId: null,
          decisionTaskId: null,
          improvementTaskId: null,
          cycleId: 'cycle-1',
        };
      }
      return {
        ok: true as const,
        decision: 'REWORD' as const,
        nextAction: 'IMPROVEMENT' as const,
        cycleStatus: 'ACTIVE',
        guard: 'ALLOWED',
        verificationTaskId: null,
        decisionTaskId: 'decision-1',
        improvementTaskId: 'improvement-1',
        cycleId: 'cycle-1',
      };
    },
    async policy() {
      return PRODUCT_LOOP_GUARD_DEFAULTS;
    },
    async counters() {
      return { iteration: 1, verificationAttempts: 0, sameDecisionCount: 1, sameConflictCount: 0, runtimeMs: null, costUsd: null };
    },
    async alreadyDone() {
      return box.done;
    },
    async markDone() {
      box.done = true;
    },
    async preflight() {
      return { status: 'SAFE' as const, code: 'SAFE' as const };
    },
    async agent() {
      if (execution) return { ok: true as const, executionId: execution, status: 'COMPLETED' };
      execution = 'exec-1';
      box.agents += 1;
      return { ok: true as const, executionId: execution, status: 'COMPLETED' };
    },
    async scope() {
      if (mode === 'scope-blocked') return { status: 'BLOCKED' as const, code: 'FORBIDDEN_SCHEMA' as const, reason: 'OUTSIDE_TASK_SCOPE' as const };
      return { status: 'SAFE' as const, code: 'SAFE' as const, reason: 'WITHIN_TASK_SCOPE' as const };
    },
    async intent() {
      box.intents += 1;
      const result = evaluateImprovementIntent(intentInput);
      box.checks.push(result);
      return result;
    },
    async gate() {
      if (!gate) {
        gate = 'gate-1';
        box.gates += 1;
      }
      return { ok: true as const, id: gate, status: gateStatus };
    },
    async rereview() {
      box.rereviews += 1;
      box.cores += 1;
      return { ok: true as const, reviewResultId: 'review-2', coreRuns: 1 };
    },
    async verification() {
      return { ok: false as const, reason: 'VERIFICATION_STOPPED', status: 'INCONCLUSIVE' };
    },
    async verificationReview() {
      return { ok: false as const, reason: 'VERIFICATION_STOPPED' };
    },
  };
  return {
    get agents() {
      return box.agents;
    },
    get intents() {
      return box.intents;
    },
    get gates() {
      return box.gates;
    },
    get rereviews() {
      return box.rereviews;
    },
    get cores() {
      return box.cores;
    },
    get checks() {
      return box.checks;
    },
    io,
  };
}
