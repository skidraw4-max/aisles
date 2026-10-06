/**
 * Preflight stops a forbidden improvement task before the agent.
 * It does not write, audit, or call a live review.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { evaluateAutoLoopPreflight, type AutoLoopPreflightInput, type AutoLoopPreflightResult } from './auto-loop-preflight';
import { runImprovementAutoLoop } from './improvement-auto-loop';
import { REWORD_CONSTRAINTS, REWORD_FIXTURE_OBJECTIVE, REWORD_FIXTURE_REASON } from './improvement-bridge';
import { PRODUCT_LOOP_GUARD_DEFAULTS } from './loop-guard';
import type { JuryMembership } from './records';

const owner: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'OWNER',
  createdAt: '2026-10-02T00:00:00.000Z',
};

const SECRET = 'postgres://hidden';

function safeTask(patch: Partial<AutoLoopPreflightInput> = {}): AutoLoopPreflightInput {
  return {
    actorTenantId: 'tenant-a',
    tenantId: 'tenant-a',
    status: 'OPEN',
    taskType: 'REWORD',
    title: '결과 문구 정리',
    description: '결과 문구를 측정된 범위 안에서 다시 다듬는다.',
    reason: REWORD_FIXTURE_REASON,
    objective: REWORD_FIXTURE_OBJECTIVE,
    constraints: [...REWORD_CONSTRAINTS],
    provenance: { reviewResultId: 'review-1', sourceDecision: 'REWORD' },
    ...patch,
  };
}

test('a normal reword task is safe and ordinary words stay safe', () => {
  const safe = evaluateAutoLoopPreflight(safeTask());
  assert.deepEqual(safe, { status: 'SAFE', code: 'SAFE' });
  assert.equal(evaluateAutoLoopPreflight(safeTask({ description: 'do not print the password' })).status, 'SAFE');
  assert.equal(evaluateAutoLoopPreflight(safeTask({ description: 'copy migration notes for the user' })).status, 'SAFE');
  assert.equal(evaluateAutoLoopPreflight(safeTask({ description: 'production copy stays measured' })).status, 'SAFE');
  assert.equal(JSON.stringify(safe).includes(SECRET), false);
});

test('preflight blocks the forbidden and incomplete cases without keeping a secret', () => {
  assert.equal(evaluateAutoLoopPreflight(safeTask({ tenantId: 'tenant-b' })).code, 'TENANT_MISMATCH');
  assert.equal(evaluateAutoLoopPreflight(safeTask({ objective: 'ALTER TABLE users ADD COLUMN note text' })).code, 'FORBIDDEN_SCHEMA_CHANGE');
  assert.equal(evaluateAutoLoopPreflight(safeTask({ objective: 'run the migration before editing copy' })).code, 'FORBIDDEN_MIGRATION');
  const credential = evaluateAutoLoopPreflight(safeTask({ objective: `store ${SECRET}` }));
  assert.equal(credential.code, 'CREDENTIAL_DETECTED');
  assert.equal(JSON.stringify(credential).includes(SECRET), false);
  assert.equal(evaluateAutoLoopPreflight(safeTask({ objective: 'change the security configuration for the site' })).code, 'FORBIDDEN_SECURITY_CONFIG');
  assert.equal(evaluateAutoLoopPreflight(safeTask({ objective: 'deploy the copy to production' })).code, 'FORBIDDEN_DEPLOYMENT');
  assert.equal(evaluateAutoLoopPreflight(safeTask({ objective: '   ' })).code, 'OBJECTIVE_MISSING');
  assert.equal(evaluateAutoLoopPreflight(safeTask({ constraints: [] })).code, 'CONSTRAINTS_MISSING');
  assert.equal(evaluateAutoLoopPreflight(safeTask({ provenance: null })).code, 'PROVENANCE_MISSING');
  assert.equal(evaluateAutoLoopPreflight(safeTask({ status: 'DONE' })).code, 'TASK_NOT_OPEN');
  assert.equal(evaluateAutoLoopPreflight(safeTask({ taskType: 'VERIFICATION' })).code, 'TASK_TYPE_UNSUPPORTED');
});

test('full auto runs the agent only after a safe preflight', async () => {
  const cases: Array<{ label: string; task: AutoLoopPreflightInput; stop: string; agent: number }> = [
    { label: 'safe', task: safeTask(), stop: 'CHANGE_GATE_GATED', agent: 1 },
    { label: 'migration', task: safeTask({ objective: 'prisma migrate deploy' }), stop: 'PREFLIGHT_BLOCKED', agent: 0 },
    { label: 'credential', task: safeTask({ reason: 'api_key=sk-live-hidden' }), stop: 'PREFLIGHT_BLOCKED', agent: 0 },
    { label: 'security', task: safeTask({ title: 'disable row level security' }), stop: 'PREFLIGHT_BLOCKED', agent: 0 },
    { label: 'deployment', task: safeTask({ description: 'production deployment of the copy' }), stop: 'PREFLIGHT_BLOCKED', agent: 0 },
    { label: 'malformed', task: safeTask({ provenance: {} }), stop: 'PREFLIGHT_BLOCKED', agent: 0 },
  ];
  for (const item of cases) {
    const run = await once(item.task);
    assert.equal(run.outcome.stop, item.stop, item.label);
    assert.equal(run.agents, item.agent, item.label);
    assert.equal(run.gates > 0, item.agent === 1, item.label);
    assert.equal(run.rereviews, 0, item.label);
    assert.equal(run.cores, 0, item.label);
    assert.equal(JSON.stringify(run.outcome).includes(SECRET), false);
  }

  const foreign = await once(safeTask({ tenantId: 'tenant-b' }));
  assert.equal(foreign.outcome.stop, 'TENANT_MISMATCH');
  assert.equal(foreign.agents, 0);
  assert.equal(foreign.gates, 0);

  const first = harness(safeTask(), { acceptChild: true });
  const completed = await runImprovementAutoLoop(command(), first.io);
  assert.equal(completed.stop, 'ACCEPT');
  assert.equal(first.agents, 1);
  const again = await runImprovementAutoLoop(command(), first.io);
  assert.equal(again.stop, 'ALREADY_COMPLETED');
  assert.equal(first.agents, 1);
  assert.equal(first.preflights, 1);

  const shared = harness(safeTask());
  const [left, right] = await Promise.all([
    runImprovementAutoLoop(command(), shared.io),
    runImprovementAutoLoop(command(), shared.io),
  ]);
  assert.equal(left.stop, 'CHANGE_GATE_GATED');
  assert.equal(right.stop, 'CHANGE_GATE_GATED');
  assert.deepEqual(shared.checks[0], shared.checks[1]);
  assert.equal(shared.agents, 1);
  assert.equal(shared.gates, 1);
  assert.equal(shared.rereviews, 0);
});

test('task only and preflight stay separate from permissions and audits', () => {
  const taskOnly = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/auto-loop-execution-mode.ts'), 'utf8');
  const preflight = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/auto-loop-preflight.ts'), 'utf8');
  assert.equal(taskOnly.includes('evaluateAutoLoopPreflight'), false);
  assert.equal(preflight.includes("from '@/lib/prisma'"), false);
  assert.equal(preflight.includes('juryAuditEvent'), false);
  assert.equal(preflight.includes('automation.write'), false);
});

function command() {
  return {
    userId: owner.userId,
    memberships: [owner],
    clientTenantId: 'forged-tenant',
    now: '2026-10-02T06:30:00.000Z',
    rootReviewResultId: 'root-1',
  };
}

async function once(task: AutoLoopPreflightInput) {
  const box = harness(task);
  const outcome = await runImprovementAutoLoop(command(), box.io);
  return { outcome, agents: box.agents, gates: box.gates, rereviews: box.rereviews, cores: box.cores };
}

function harness(task: AutoLoopPreflightInput, options?: { acceptChild?: boolean }) {
  const box = { agents: 0, gates: 0, rereviews: 0, cores: 0, preflights: 0, checks: [] as AutoLoopPreflightResult[], done: false };
  let execution: string | null = null;
  let gate: string | null = null;
  const io = {
    async iteration(input: { reviewResultId: string }) {
      if (options?.acceptChild && input.reviewResultId !== 'root-1') {
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
      box.preflights += 1;
      const result = evaluateAutoLoopPreflight(task);
      box.checks.push(result);
      return result;
    },
    async agent() {
      if (execution) return { ok: true as const, executionId: execution, status: 'COMPLETED' };
      execution = 'exec-1';
      box.agents += 1;
      return { ok: true as const, executionId: execution, status: 'COMPLETED' };
    },
    async gate() {
      if (!gate) {
        gate = 'gate-1';
        box.gates += 1;
      }
      return { ok: true as const, id: gate, status: options?.acceptChild ? 'APPROVED' : 'GATED' };
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
  return { get agents() { return box.agents; }, get gates() { return box.gates; }, get rereviews() { return box.rereviews; }, get cores() { return box.cores; }, get preflights() { return box.preflights; }, get checks() { return box.checks; }, io };
}
