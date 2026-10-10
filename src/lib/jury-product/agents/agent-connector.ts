/**
 * Boundary for talking to an agent runtime.
 * The product default selects the local runner. An injected adapter is forwarded as itself.
 */
import { inspectionWorkspaceForProduct } from '../product-inspection-workspace';
import type { AgentAdapter, AgentAdapterInput, AgentAdapterResult } from './agent-adapter';
import { cursorAgentRunner, localAgentRunner } from './agent-runner';

const LOCAL_RUN_TIMEOUT_MS = 120_000;

export type AgentConnector = {
  run(input: AgentAdapterInput): Promise<AgentAdapterResult>;
};

export function localAgentConnector(adapter: AgentAdapter): AgentConnector {
  return {
    run(input) {
      return adapter.run(input);
    },
  };
}

export function localRunnerConnector(): AgentConnector {
  return runnerConnector(localAgentRunner());
}

export function cursorRunnerConnector(): AgentConnector {
  return runnerConnector(cursorAgentRunner());
}

function runnerConnector(runner: ReturnType<typeof localAgentRunner>): AgentConnector {
  return {
    run(input) {
      return runner.run({
        executionId: input.executionId,
        workspaceRef: inspectionWorkspaceForProduct(input.workspaceRef) ?? input.workspaceRef,
        workspaceRoot: input.workspaceRoot,
        instruction: input.instruction,
        timeoutMs: LOCAL_RUN_TIMEOUT_MS,
        signal: input.signal,
      });
    },
  };
}

export function agentAdapterFromConnector(connector: AgentConnector): AgentAdapter {
  return {
    run(input) {
      return connector.run(input);
    },
  };
}
