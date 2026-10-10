/**
 * The local runner accepts only the mock-aisle workspace and does not spawn a process.
 * Run: node --import tsx --test src/lib/jury-product/agents/agent-runner.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveAllowedWorkspace } from '../agent-workspace';
import type { AgentRunnerRequest } from './agent-runner';
import { localAgentRunner } from './agent-runner';

const root = resolveAllowedWorkspace({ type: 'PROJECT', ref: 'mock-aisle' });

function request(overrides: Partial<AgentRunnerRequest> = {}): AgentRunnerRequest {
  return {
    executionId: 'phase79-runner',
    workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' },
    workspaceRoot: root ?? '',
    instruction: 'adjust the user-facing copy',
    timeoutMs: 120_000,
    signal: new AbortController().signal,
    ...overrides,
  };
}

test('the runner accepts the allowlisted mock-aisle root and rejects the other workspace inputs', async () => {
  assert.equal(root, 'data/jury-product/workspaces/mock-aisle');
  const runner = localAgentRunner();
  const allowed = await runner.run(request());
  assert.equal(allowed.ok, true);
  if (allowed.ok) assert.equal(allowed.changedFiles.includes('workspace/mock-aisle/user-facing-copy.ts'), true);

  const lineage = await runner.run(request({ workspaceRef: { type: 'PROJECT', ref: 'jury-product' } }));
  assert.equal(lineage.ok, false);
  if (!lineage.ok) assert.equal(lineage.errorCode, 'WORKSPACE_EXECUTION_FAILED');

  const absolute = await runner.run(request({ workspaceRoot: 'C:\\dev\\AIsle\\data\\jury-product\\workspaces\\mock-aisle' }));
  assert.equal(absolute.ok, false);
  if (!absolute.ok) assert.equal(absolute.errorCode, 'WORKSPACE_EXECUTION_FAILED');

  const parent = await runner.run(request({ workspaceRoot: 'data/jury-product/workspaces/mock-aisle/../mock-aisle' }));
  assert.equal(parent.ok, false);
  if (!parent.ok) assert.equal(parent.errorCode, 'WORKSPACE_EXECUTION_FAILED');

  const outside = await runner.run(request({ workspaceRoot: 'data/jury-product/workspaces/re-review-fixture' }));
  assert.equal(outside.ok, false);
  if (!outside.ok) assert.equal(outside.errorCode, 'WORKSPACE_EXECUTION_FAILED');
});

test('an aborted run returns the existing timeout code without waiting', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await localAgentRunner().run(request({ signal: controller.signal }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, 'EXECUTION_TIMEOUT');
});

test('the runner does not reach the database or an external command', () => {
  const source = readFileSync(new URL('./agent-runner.ts', import.meta.url), 'utf8');
  for (const token of ['prisma', 'child_process', 'cursor-agent', 'spawn(', 'exec(', 'shell: true', 'fetch(', 'claude']) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes('resolveAllowedWorkspace'), true);
  assert.equal(source.includes('setTimeout'), false);
});
