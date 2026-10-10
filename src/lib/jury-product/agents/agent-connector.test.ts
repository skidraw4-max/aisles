/**
 * The local connector matches the existing agent adapter contract.
 * Run: node --import tsx --test src/lib/jury-product/agents/agent-connector.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { AgentAdapter, AgentAdapterInput } from './agent-adapter';
import { agentAdapterFromConnector, localAgentConnector, type AgentConnector } from './agent-connector';
import { fakeCursorAdapter } from './fake-cursor-adapter';

const input: AgentAdapterInput = {
  executionId: 'phase79-connector',
  workspaceRef: { type: 'PROJECT', ref: 'jury-product' },
  workspaceRoot: '',
  inputSnapshot: {
    improvementTaskId: 'task',
    taskType: 'REWORD',
    title: 'copy',
    description: 'copy',
    reason: 'copy',
    objective: 'copy',
    constraints: ['stay inside the fixture'],
    evidenceId: 'evidence',
    reviewResultId: 'review',
    provenance: {
      reviewResultId: 'review',
      decisionTaskId: 'decision',
      evidenceId: 'evidence',
      sourceDecision: 'REWORD',
      comparator: {
        evidenceStrength: 'WEAK',
        claimStrength: 'WEAK',
        conflictDetected: false,
        overclaimDetected: false,
        revisionRequired: true,
        expectedDecision: 'REWORD',
      },
    },
    workspaceRef: { type: 'PROJECT', ref: 'jury-product' },
  },
  instruction: '',
  signal: new AbortController().signal,
};

test('the local connector uses the existing adapter result contract', async () => {
  const adapter = fakeCursorAdapter('success');
  const connector: AgentConnector = localAgentConnector(adapter);
  const throughConnector = await connector.run(input);
  const direct = fakeCursorAdapter('success');
  const throughAdapter = await direct.run(input);
  assert.deepEqual(throughConnector, throughAdapter);
  assert.equal(adapter.calls.length, 1);
  assert.deepEqual(adapter.calls[0].workspaceRef, { type: 'PROJECT', ref: 'jury-product' });
  assert.equal(adapter.calls[0].workspaceRoot, '');
});

test('a connector can be used as an agent adapter and the fake adapter still runs alone', async () => {
  const selected = fakeCursorAdapter('fail');
  const adapted: AgentAdapter = agentAdapterFromConnector(localAgentConnector(selected));
  const wrapped = await adapted.run(input);
  const alone = await fakeCursorAdapter('fail').run(input);
  assert.deepEqual(wrapped, alone);
  assert.equal(wrapped.ok, false);
  if (!wrapped.ok) assert.equal(wrapped.errorCode, 'AGENT_EXECUTION_FAILED');
  assert.equal(selected.calls.length, 1);
});

test('the connector boundary does not reach jury, git, or an external runtime', () => {
  const connector = readFileSync(new URL('./agent-connector.ts', import.meta.url), 'utf8');
  const product = readFileSync(new URL('../product-execution.ts', import.meta.url), 'utf8');
  const adapter = readFileSync(new URL('./agent-adapter.ts', import.meta.url), 'utf8');
  for (const token of [
    'child_process',
    'cursor-agent',
    'fetch(',
    'prisma',
    'evaluateChangeGate',
    'runReviewBoardPipeline',
    'externalExecutionId',
    'DISPATCHED',
    'claude',
  ]) {
    assert.equal(connector.includes(token), false, token);
  }
  assert.equal(product.includes('localAgentConnector'), true);
  assert.equal(product.includes('localRunnerConnector'), true);
  assert.equal(product.includes('claimProductAgentExecution'), true);
  assert.equal(product.includes('completeProductAgentExecution'), true);
  assert.equal(product.includes('executeHumanAgentExecution'), false);
  assert.equal(adapter.includes('changedFiles'), true);
  assert.equal(adapter.includes('executionId'), true);
  assert.equal(adapter.includes('workspaceRoot'), true);
});
