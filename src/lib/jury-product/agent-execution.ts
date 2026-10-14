/**
 * Moves one PENDING execution to RUNNING and then COMPLETED or BLOCKED.
 * COMPLETED means the agent process finished. It does not approve the change.
 * This module does not spawn a process, open Change Gate, or start a re-review.
 */
import { parseWorkspaceRef, type AgentExecutionDraft, type HandoffTask } from './agent-handoff';
import { decideJuryMutation, resolveJuryActor } from './access';
import type { AgentAdapter, AgentAdapterResult, AgentRunErrorCode } from './agents/agent-adapter';
import { resolveAllowedWorkspace } from './agent-workspace';
import type { JuryMembership } from './records';

export const DEFAULT_AGENT_TIMEOUT_MS = 120_000;

export const AGENT_TASK_INSTRUCTION = [
  '이 작업은 JuryImprovementTask의 objective와 constraints를 만족하기 위한 코드 수정 작업이다.',
  '',
  'Evidence 값을 변경하지 않는다.',
  'metric 값을 변경하지 않는다.',
  'Evidence provenance를 변경하지 않는다.',
  '수집 결과를 조작하지 않는다.',
  '측정되지 않은 값을 사실처럼 만들지 않는다.',
  'Jury decision contract를 변경하지 않는다.',
  'credential을 접근하거나 출력하지 않는다.',
  '',
  '작업 범위는 승인된 workspace로 제한한다.',
  '',
  '작업 완료 후:',
  '- 변경된 파일 목록',
  '- 변경 요약',
  '- 실행한 테스트',
  '- 테스트 결과',
  '- 오류가 있다면 오류 요약',
  '',
  '을 반환한다.',
].join('\n');

export type ExecutionBlockCode =
  | 'EXECUTION_NOT_FOUND'
  | 'EXECUTION_NOT_PENDING'
  | 'TENANT_MISMATCH'
  | 'IMPROVEMENT_TASK_NOT_FOUND'
  | 'IMPROVEMENT_TASK_NOT_OPEN'
  | 'AGENT_TYPE_UNSUPPORTED'
  | 'WORKSPACE_REF_REQUIRED'
  | 'WORKSPACE_REF_INVALID'
  | 'CREDENTIAL_DATA_DETECTED'
  | 'LOOP_GUARD_BLOCKED'
  | 'EXECUTION_POLICY_BLOCKED'
  | AgentRunErrorCode;

export type ExecutionAuditAction = 'AGENT_EXECUTION_STARTED' | 'AGENT_EXECUTION_COMPLETED' | 'AGENT_EXECUTION_BLOCKED';

export type ExecutionArtifact = {
  executionId: string;
  changedFiles: string[];
  summary: string;
  testsRun: string[];
  testsPassed: boolean | null;
};

export type ExecuteCommand = {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  clock?: () => string;
  timeoutMs: number;
  loopGuardBlocked: boolean;
  execution: AgentExecutionDraft | null;
  task: HandoffTask | null;
};

export type ExecutionWriteTx = {
  claimRunning(id: string, at: string): Promise<boolean>;
  blockPending(id: string, errorCode: string, at: string): Promise<boolean>;
  completeRunning(id: string, resultRef: string, at: string): Promise<boolean>;
  failRunning(id: string, errorCode: string, at: string): Promise<boolean>;
  audit(action: ExecutionAuditAction, execution: AgentExecutionDraft): Promise<void>;
  saveResult(artifact: ExecutionArtifact): Promise<string>;
};

export type ExecuteOutcome =
  | { ok: false; reason: 'UNAUTHENTICATED' | 'NO_MEMBERSHIP' | 'AMBIGUOUS_MEMBERSHIP' | 'STORE_UNAVAILABLE' | 'FORBIDDEN' }
  | { ok: false; reason: ExecutionBlockCode; execution: AgentExecutionDraft | null; adapterCalled: boolean }
  | { ok: true; execution: AgentExecutionDraft; adapterCalled: boolean };

export function buildAgentInstruction(task: { objective: string; description: string; constraints: readonly string[] }): string {
  return [
    AGENT_TASK_INSTRUCTION,
    '',
    `objective: ${task.objective}`,
    `description: ${task.description}`,
    'constraints:',
    ...task.constraints.map((item) => `- ${item}`),
  ].join('\n');
}

export function containsSecret(value: unknown): boolean {
  const text = JSON.stringify(value);
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes('credentialref') ||
    lower.includes('private_key') ||
    lower.includes('begin private') ||
    lower.includes('postgres://') ||
    lower.includes('password') ||
    lower.includes('access_token') ||
    lower.includes('refresh_token') ||
    lower.includes('api_key') ||
    lower.includes('sessioncookie')
  );
}

function safeFiles(files: string[]): string[] | null {
  if (files.some((file) => file.length === 0 || file.length > 200)) return null;
  if (
    files.some(
      (file) =>
        file.includes('..') ||
        file.startsWith('/') ||
        file.startsWith('\\') ||
        /^[a-zA-Z]:/.test(file) ||
        file.includes('\\'),
    )
  ) {
    return null;
  }
  return files;
}

export async function executeAgent(
  command: ExecuteCommand,
  adapter: AgentAdapter,
  tx: ExecutionWriteTx,
): Promise<ExecuteOutcome> {
  void command.clientTenantId;
  const actor = resolveJuryActor({
    userId: command.userId,
    memberships: command.memberships,
    clientTenantId: command.clientTenantId,
  });
  if (!actor.ok) return actor;
  const allowed = decideJuryMutation({
    actor,
    action: 'agent.execute',
    resourceTenantId: actor.tenantId,
    clientTenantId: command.clientTenantId,
  });
  if (!allowed.ok) {
    if (
      allowed.reason === 'UNAUTHENTICATED' ||
      allowed.reason === 'NO_MEMBERSHIP' ||
      allowed.reason === 'AMBIGUOUS_MEMBERSHIP' ||
      allowed.reason === 'STORE_UNAVAILABLE' ||
      allowed.reason === 'FORBIDDEN'
    ) {
      return { ok: false, reason: allowed.reason };
    }
    return { ok: false, reason: 'TENANT_MISMATCH', execution: command.execution, adapterCalled: false };
  }
  const execution = command.execution;
  if (!execution) return { ok: false, reason: 'EXECUTION_NOT_FOUND', execution: null, adapterCalled: false };
  if (execution.tenantId !== actor.tenantId) {
    return { ok: false, reason: 'TENANT_MISMATCH', execution, adapterCalled: false };
  }
  if (execution.status !== 'PENDING') {
    return { ok: false, reason: 'EXECUTION_NOT_PENDING', execution, adapterCalled: false };
  }

  const policy = policyBlock(command, execution);
  if (policy) {
    const stamped = await blockPending(execution, policy, command.now, tx);
    return { ok: false, reason: policy, execution: stamped, adapterCalled: false };
  }

  const claimed = await tx.claimRunning(execution.id, command.now);
  if (!claimed) return { ok: false, reason: 'EXECUTION_NOT_PENDING', execution, adapterCalled: false };
  const running: AgentExecutionDraft = { ...execution, status: 'RUNNING', startedAt: command.now, updatedAt: command.now };
  await tx.audit('AGENT_EXECUTION_STARTED', running);

  const workspace = parseWorkspaceRef(execution.workspaceRef);
  const workspaceRoot = workspace ? resolveAllowedWorkspace(workspace) : null;
  if (!workspace || !workspaceRoot) {
    const blocked = await failRunning(running, 'WORKSPACE_REF_INVALID', command, tx);
    return { ok: false, reason: 'WORKSPACE_REF_INVALID', execution: blocked, adapterCalled: false };
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<AgentAdapterResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, errorCode: 'EXECUTION_TIMEOUT', message: 'timeout' });
    }, command.timeoutMs);
  });
  let result: AgentAdapterResult;
  try {
    result = await Promise.race([
      adapter.run({
        executionId: execution.id,
        workspaceRef: workspace,
        workspaceRoot,
        inputSnapshot: execution.inputSnapshot,
        instruction: buildAgentInstruction(execution.inputSnapshot),
        signal: controller.signal,
      }),
      timeout,
    ]);
  } catch {
    result = { ok: false, errorCode: 'AGENT_EXECUTION_FAILED', message: 'adapter failed' };
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }

  if (!result.ok || containsSecret(result)) {
    const code = !result.ok ? result.errorCode : 'CREDENTIAL_DATA_DETECTED';
    const blocked = await failRunning(running, code, command, tx);
    return { ok: false, reason: code, execution: blocked, adapterCalled: true };
  }
  const changedFiles = safeFiles(result.changedFiles);
  if (!changedFiles || containsSecret(changedFiles) || containsSecret(result.summary)) {
    const blocked = await failRunning(running, 'WORKSPACE_EXECUTION_FAILED', command, tx);
    return { ok: false, reason: 'WORKSPACE_EXECUTION_FAILED', execution: blocked, adapterCalled: true };
  }

  const artifact: ExecutionArtifact = {
    executionId: execution.id,
    changedFiles,
    summary: result.summary,
    testsRun: result.testsRun,
    testsPassed: result.testsPassed,
  };
  if (containsSecret(artifact)) {
    const blocked = await failRunning(running, 'CREDENTIAL_DATA_DETECTED', command, tx);
    return { ok: false, reason: 'CREDENTIAL_DATA_DETECTED', execution: blocked, adapterCalled: true };
  }
  let resultRef: string;
  try {
    resultRef = await tx.saveResult(artifact);
  } catch {
    const blocked = await failRunning(running, 'WORKSPACE_EXECUTION_FAILED', command, tx);
    return { ok: false, reason: 'WORKSPACE_EXECUTION_FAILED', execution: blocked, adapterCalled: true };
  }
  const at = command.clock?.() ?? command.now;
  const completed = await tx.completeRunning(execution.id, resultRef, at);
  if (!completed) return { ok: false, reason: 'EXECUTION_NOT_PENDING', execution: running, adapterCalled: true };
  const done: AgentExecutionDraft = {
    ...running,
    status: 'COMPLETED',
    resultRef,
    errorCode: null,
    finishedAt: at,
    updatedAt: at,
  };
  await tx.audit('AGENT_EXECUTION_COMPLETED', done);
  return { ok: true, execution: done, adapterCalled: true };
}

function policyBlock(command: ExecuteCommand, execution: AgentExecutionDraft): ExecutionBlockCode | null {
  if (command.loopGuardBlocked) return 'LOOP_GUARD_BLOCKED';
  if (!command.task) return 'IMPROVEMENT_TASK_NOT_FOUND';
  if (command.task.tenantId !== execution.tenantId) return 'TENANT_MISMATCH';
  if (command.task.id !== execution.taskId) return 'EXECUTION_POLICY_BLOCKED';
  if (command.task.status !== 'OPEN') return 'IMPROVEMENT_TASK_NOT_OPEN';
  if (command.task.taskType !== 'REWORD') return 'EXECUTION_POLICY_BLOCKED';
  if (execution.agent !== 'CURSOR') return 'AGENT_TYPE_UNSUPPORTED';
  if (execution.workspaceRef == null) return 'WORKSPACE_REF_REQUIRED';
  const workspace = parseWorkspaceRef(execution.workspaceRef);
  if (!workspace) return 'WORKSPACE_REF_INVALID';
  if (!resolveAllowedWorkspace(workspace)) return 'WORKSPACE_REF_INVALID';
  if (!execution.inputSnapshot) return 'EXECUTION_POLICY_BLOCKED';
  if (containsSecret(execution.inputSnapshot) || containsSecret(execution.provenance)) return 'CREDENTIAL_DATA_DETECTED';
  if (execution.inputSnapshot.improvementTaskId !== execution.taskId) return 'EXECUTION_POLICY_BLOCKED';
  if (execution.inputSnapshot.objective.trim().length === 0 || execution.inputSnapshot.constraints.length === 0) {
    return 'EXECUTION_POLICY_BLOCKED';
  }
  return null;
}

async function blockPending(
  execution: AgentExecutionDraft,
  errorCode: string,
  at: string,
  tx: ExecutionWriteTx,
): Promise<AgentExecutionDraft> {
  const blocked = await tx.blockPending(execution.id, errorCode, at);
  if (!blocked) return execution;
  const next: AgentExecutionDraft = { ...execution, status: 'BLOCKED', errorCode, finishedAt: at, updatedAt: at };
  await tx.audit('AGENT_EXECUTION_BLOCKED', next);
  return next;
}

async function failRunning(
  execution: AgentExecutionDraft,
  errorCode: string,
  command: ExecuteCommand,
  tx: ExecutionWriteTx,
): Promise<AgentExecutionDraft> {
  const at = command.clock?.() ?? command.now;
  const failed = await tx.failRunning(execution.id, errorCode, at);
  if (!failed) return execution;
  const next: AgentExecutionDraft = {
    ...execution,
    status: 'BLOCKED',
    errorCode,
    finishedAt: at,
    updatedAt: at,
  };
  await tx.audit('AGENT_EXECUTION_BLOCKED', next);
  return next;
}
