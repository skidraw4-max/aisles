/**
 * Existing cursor entry point.
 * Product execution does not call this. The process starts in the cursor connector.
 */
import type { AgentAdapterInput, AgentAdapterResult } from './agent-adapter';
import { runCursorConnector } from './cursor-connector';

const CURSOR_TIMEOUT_MS = 120_000;

export async function runCursorAdapter(input: AgentAdapterInput): Promise<AgentAdapterResult> {
  return runCursorConnector({
    executionId: input.executionId,
    workspaceRef: input.workspaceRef,
    workspaceRoot: input.workspaceRoot,
    instruction: input.instruction,
    timeoutMs: CURSOR_TIMEOUT_MS,
    signal: input.signal,
  });
}
