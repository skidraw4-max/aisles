/**
 * Boundary the execution service uses to run one agent.
 * The service does not spawn a process itself.
 */
import type { HandoffSnapshot, WorkspaceRef } from '../agent-handoff';

export type AgentRunErrorCode =
  | 'AGENT_EXECUTION_FAILED'
  | 'EXECUTION_TIMEOUT'
  | 'AGENT_NOT_AVAILABLE'
  | 'WORKSPACE_EXECUTION_FAILED';

export type AgentAdapterInput = {
  executionId: string;
  workspaceRef: WorkspaceRef;
  workspaceRoot: string;
  inputSnapshot: HandoffSnapshot;
  instruction: string;
  signal: AbortSignal;
};

export type AgentAdapterResult =
  | {
      ok: true;
      changedFiles: string[];
      summary: string;
      testsRun: string[];
      testsPassed: boolean | null;
    }
  | {
      ok: false;
      errorCode: AgentRunErrorCode;
      message: string;
    };

export type AgentAdapter = {
  run(input: AgentAdapterInput): Promise<AgentAdapterResult>;
};
