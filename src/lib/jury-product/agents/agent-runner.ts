/**
 * Chooses a local fixture edit or, only when asked, the cursor connector.
 * This file does not start a process.
 */
import path from 'node:path';
import { resolveAllowedWorkspace } from '../agent-workspace';
import type { WorkspaceRef } from '../agent-handoff';
import type { AgentAdapterResult } from './agent-adapter';
import { runCursorConnector } from './cursor-connector';
import { executeFakeCursorLocal } from './fake-cursor-adapter';

export type AgentRunnerRequest = {
  executionId: string;
  workspaceRef: WorkspaceRef;
  workspaceRoot: string;
  instruction: string;
  timeoutMs: number;
  signal: AbortSignal;
};

export type AgentRunner = {
  run(input: AgentRunnerRequest): Promise<AgentAdapterResult>;
};

export function localAgentRunner(): AgentRunner {
  return {
    async run(input) {
      const blocked = runnerBlock(input);
      if (blocked) return blocked;
      return executeFakeCursorLocal(input.workspaceRoot);
    },
  };
}

export function cursorAgentRunner(): AgentRunner {
  return {
    async run(input) {
      const blocked = runnerBlock(input);
      if (blocked) return blocked;
      return runCursorConnector(input);
    },
  };
}

function runnerBlock(input: AgentRunnerRequest): AgentAdapterResult | null {
  if (input.signal.aborted || !Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    return { ok: false, errorCode: 'EXECUTION_TIMEOUT', message: 'run cancelled' };
  }
  if (!workspaceAllowed(input.workspaceRef, input.workspaceRoot)) {
    return { ok: false, errorCode: 'WORKSPACE_EXECUTION_FAILED', message: 'workspace is not allowlisted' };
  }
  return null;
}

function workspaceAllowed(workspaceRef: WorkspaceRef, workspaceRoot: string): boolean {
  if (workspaceRef.type !== 'PROJECT' || workspaceRef.ref === 'jury-product' || workspaceRef.ref !== 'mock-aisle') return false;
  if (workspaceRoot.includes('..') || path.isAbsolute(workspaceRoot)) return false;
  const allowed = resolveAllowedWorkspace(workspaceRef);
  if (!allowed || workspaceRoot !== allowed) return false;
  const parent = path.resolve(process.cwd(), 'data', 'jury-product', 'workspaces');
  const root = path.resolve(process.cwd(), workspaceRoot);
  return root === path.resolve(parent, 'mock-aisle') && root.startsWith(parent + path.sep);
}
