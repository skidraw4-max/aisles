/**
 * Reads a completed execution against the workspace.
 * APPROVED means the mechanical checks passed. It does not mean Jury passed.
 * This module does not write files, commit, deploy, or start a re-review.
 */
import { createHash } from 'node:crypto';
import { parseWorkspaceRef, type WorkspaceRef } from './agent-handoff';
import { decideJuryMutation, resolveJuryActor } from './access';
import { resolveAllowedWorkspace } from './agent-workspace';
import type { JuryMembership, JuryRiskFlag } from './records';

export type ChangeGateStatus = 'GATED' | 'APPROVED' | 'BLOCKED';
export type ChangeRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type WorkspaceChange = {
  path: string;
  kind: 'added' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
  patch?: string;
};

export type ChangeInspection = {
  files: WorkspaceChange[];
  present: string[];
};

export type ChangeGateDraft = {
  id: string;
  tenantId: string;
  executionId: string;
  improvementTaskId: string;
  status: ChangeGateStatus;
  gate: 'PASS' | 'NEEDS_APPROVAL' | 'BLOCK';
  changedFiles: string[];
  addedFiles: string[];
  modifiedFiles: string[];
  deletedFiles: string[];
  blockedFiles: string[];
  riskFlags: JuryRiskFlag[];
  riskLevel: ChangeRiskLevel;
  riskReasons: string[];
  testsPassed: boolean | null;
  testResults: { available: boolean; passed: boolean | null; commands: string[]; required: boolean };
  agentReportedFiles: string[];
  discrepancy: boolean;
  discrepancyReasons: string[];
  diffStat: {
    filesChanged: number;
    additions: number;
    deletions: number;
    totalChangedLines: number;
    largestChangedFile: string | null;
    files: { path: string; additions: number; deletions: number }[];
  };
  credentialDetected: boolean;
  credentialType: string | null;
  errorCode: string | null;
  provenance: {
    agentExecutionId: string;
    improvementTaskId: string;
    workspaceRef: WorkspaceRef | null;
  };
  createdAt: string;
  updatedAt: string;
};

export type ChangeGateCommand = {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  execution: {
    id: string;
    tenantId: string;
    taskId: string;
    status: string;
    workspaceRef: unknown;
    provenance: { reviewResultId: string; decisionTaskId: string; evidenceId: string } | null;
  } | null;
  task: { id: string; tenantId: string } | null;
  agentReportedFiles: string[];
  testResults: { available: boolean; passed: boolean | null; commands: string[] };
  inspection: ChangeInspection | null;
};

export type ChangeGateFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'EXECUTION_NOT_FOUND'
  | 'EXECUTION_NOT_COMPLETED'
  | 'TASK_MISMATCH';

export type ChangeGateWriteTx = {
  findByExecution(executionId: string): Promise<ChangeGateDraft | null>;
  insert(row: ChangeGateDraft): Promise<void>;
  audit(action: 'CHANGE_GATE_STARTED' | 'CHANGE_GATE_COMPLETED' | 'CHANGE_GATE_BLOCKED', row: ChangeGateDraft): Promise<void>;
};

const LEGACY_GATE: Record<ChangeGateStatus, ChangeGateDraft['gate']> = {
  GATED: 'NEEDS_APPROVAL',
  APPROVED: 'PASS',
  BLOCKED: 'BLOCK',
};

function stableId(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

function escapes(value: string): boolean {
  if (!value || value.includes('..') || value.startsWith('/') || value.startsWith('\\')) return true;
  if (/^[a-zA-Z]:/.test(value)) return true;
  return false;
}

function isRiskFile(rel: string): boolean {
  const base = rel.split('/').pop() ?? '';
  if (base === '.env' || base.startsWith('.env.')) return true;
  if (base === 'id_rsa' || base.endsWith('.pem') || base.endsWith('.key')) return true;
  if (base === 'credentials.json') return true;
  return false;
}

function isProtected(rel: string): boolean {
  if (rel === 'prisma/schema.prisma' || rel.startsWith('prisma/migrations/')) return true;
  if (rel.startsWith('src/lib/ai-review-board/')) return true;
  if (rel.startsWith('src/lib/auth/') || rel.includes('/auth/') || rel.startsWith('auth/')) return true;
  if (rel.includes('payment') || rel.includes('stripe')) return true;
  if (rel === 'vercel.json' || rel === 'Dockerfile' || rel.startsWith('.github/workflows/')) return true;
  if (rel.startsWith('infra/') || rel.startsWith('terraform/')) return true;
  return false;
}

function credentialType(patch: string): string | null {
  if (/BEGIN PRIVATE KEY/.test(patch)) return 'PRIVATE_KEY';
  if (/postgres:\/\//i.test(patch) || /mongodb:\/\//i.test(patch)) return 'CONNECTION_STRING';
  if (/\bsk-[A-Za-z0-9]/.test(patch) || /\bAKIA[0-9A-Z]{16}\b/.test(patch)) return 'API_KEY';
  if (/password\s*[:=]/i.test(patch)) return 'PASSWORD';
  if (/secret\s*[:=]/i.test(patch) || /api[_-]?key\s*[:=]/i.test(patch)) return 'SECRET';
  return null;
}

function riskFor(rel: string): ChangeRiskLevel {
  if (rel.startsWith('src/lib/ai-review-board/') || rel.endsWith('.pem') || rel.endsWith('.key') || rel === 'id_rsa') {
    return 'CRITICAL';
  }
  if (rel === '.env' || rel.startsWith('.env.') || isProtected(rel) || isRiskFile(rel)) return 'HIGH';
  if (rel.endsWith('.ts') || rel.endsWith('.tsx') || rel.endsWith('.js')) return 'MEDIUM';
  return 'LOW';
}

function higher(left: ChangeRiskLevel, right: ChangeRiskLevel): ChangeRiskLevel {
  const rank = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
  return rank[left] >= rank[right] ? left : right;
}

export async function evaluateChangeGate(
  command: ChangeGateCommand,
  tx: ChangeGateWriteTx,
): Promise<
  | { ok: false; reason: ChangeGateFailure }
  | { ok: true; created: boolean; gate: ChangeGateDraft }
> {
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
    if (allowed.reason === 'TENANT_MISMATCH') return { ok: false, reason: 'TENANT_MISMATCH' };
    return { ok: false, reason: allowed.reason };
  }
  const execution = command.execution;
  if (!execution) return { ok: false, reason: 'EXECUTION_NOT_FOUND' };
  if (execution.tenantId !== actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  if (!command.task || command.task.tenantId !== actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  if (command.task.id !== execution.taskId) return { ok: false, reason: 'TASK_MISMATCH' };
  const existing = await tx.findByExecution(execution.id);
  if (existing) {
    if (existing.tenantId !== actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
    return { ok: true, created: false, gate: existing };
  }
  if (execution.status !== 'COMPLETED') return { ok: false, reason: 'EXECUTION_NOT_COMPLETED' };

  const workspace = parseWorkspaceRef(execution.workspaceRef);
  const workspaceRoot = workspace ? resolveAllowedWorkspace(workspace) : null;
  const judged = judge(command, workspace, workspaceRoot);
  const row: ChangeGateDraft = {
    id: stableId([actor.tenantId, execution.id, 'change-gate']),
    tenantId: actor.tenantId,
    executionId: execution.id,
    improvementTaskId: execution.taskId,
    status: judged.status,
    gate: LEGACY_GATE[judged.status],
    changedFiles: judged.changedFiles,
    addedFiles: judged.addedFiles,
    modifiedFiles: judged.modifiedFiles,
    deletedFiles: judged.deletedFiles,
    blockedFiles: judged.blockedFiles,
    riskFlags: judged.riskFlags,
    riskLevel: judged.riskLevel,
    riskReasons: judged.riskReasons,
    testsPassed: command.testResults.available ? command.testResults.passed : null,
    testResults: {
      available: command.testResults.available,
      passed: command.testResults.available ? command.testResults.passed : null,
      commands: command.testResults.commands,
      required: false,
    },
    agentReportedFiles: command.agentReportedFiles,
    discrepancy: judged.discrepancy,
    discrepancyReasons: judged.discrepancyReasons,
    diffStat: judged.diffStat,
    credentialDetected: judged.credentialDetected,
    credentialType: judged.credentialType,
    errorCode: judged.errorCode,
    provenance: {
      agentExecutionId: execution.id,
      improvementTaskId: execution.taskId,
      workspaceRef: workspace,
    },
    createdAt: command.now,
    updatedAt: command.now,
  };
  await tx.insert(row);
  await tx.audit('CHANGE_GATE_STARTED', row);
  await tx.audit(row.status === 'BLOCKED' ? 'CHANGE_GATE_BLOCKED' : 'CHANGE_GATE_COMPLETED', row);
  return { ok: true, created: true, gate: row };
}

function judge(
  command: ChangeGateCommand,
  workspace: WorkspaceRef | null,
  workspaceRoot: string | null,
): Omit<
  ChangeGateDraft,
  | 'id'
  | 'tenantId'
  | 'executionId'
  | 'improvementTaskId'
  | 'gate'
  | 'testsPassed'
  | 'testResults'
  | 'agentReportedFiles'
  | 'provenance'
  | 'createdAt'
  | 'updatedAt'
> {
  const files = command.inspection?.files ?? [];
  const present = new Set(command.inspection?.present ?? []);
  const reasons = new Set<string>();
  const blocked = new Set<string>();
  let risk: ChangeRiskLevel = 'LOW';
  let credential: string | null = null;
  let errorCode: string | null = null;
  let status: ChangeGateStatus = 'APPROVED';

  if (!workspace || !workspaceRoot) {
    status = 'BLOCKED';
    errorCode = 'WORKSPACE_NOT_ALLOWED';
    reasons.add('WORKSPACE_NOT_ALLOWED');
    risk = 'HIGH';
  }

  for (const reported of command.agentReportedFiles) {
    if (escapes(reported)) {
      status = 'BLOCKED';
      errorCode = errorCode ?? 'PATH_ESCAPE';
      reasons.add('PATH_ESCAPE');
      risk = 'CRITICAL';
      continue;
    }
    const normalized = reported.replace(/\\/g, '/').replace(/^\.\//, '');
    const changed = files.some((file) => file.path === normalized);
    if (!changed && !present.has(normalized)) reasons.add('AGENT_REPORTED_FILE_NOT_FOUND_IN_WORKSPACE');
    else if (!changed) reasons.add('AGENT_REPORTED_FILE_NOT_CHANGED');
  }

  const reportedSet = new Set(command.agentReportedFiles.map((file) => file.replace(/\\/g, '/')));
  for (const file of files) {
    if (escapes(file.path)) {
      status = 'BLOCKED';
      errorCode = errorCode ?? 'PATH_ESCAPE';
      reasons.add('PATH_ESCAPE');
      risk = 'CRITICAL';
      blocked.add(file.path);
      continue;
    }
    if (!reportedSet.has(file.path)) reasons.add('WORKSPACE_CHANGE_NOT_REPORTED');
    risk = higher(risk, riskFor(file.path));
    if (file.path.startsWith('src/lib/ai-review-board/')) {
      status = 'BLOCKED';
      reasons.add('PROTECTED_V9_PATH');
      blocked.add(file.path);
      risk = 'CRITICAL';
    } else if (isProtected(file.path)) {
      status = 'BLOCKED';
      reasons.add('PROTECTED_PATH');
      blocked.add(file.path);
      risk = higher(risk, 'HIGH');
    }
    if (isRiskFile(file.path)) {
      status = 'BLOCKED';
      reasons.add('RISK_FILE');
      blocked.add(file.path);
      risk = higher(risk, file.path.startsWith('.env.production') ? 'CRITICAL' : 'HIGH');
    }
    const found = file.patch ? credentialType(file.patch) : null;
    if (found) {
      credential = found;
      status = 'BLOCKED';
      reasons.add('CREDENTIAL_DETECTED');
      blocked.add(file.path);
      risk = 'CRITICAL';
    }
  }

  if (risk === 'HIGH' || risk === 'CRITICAL') status = 'BLOCKED';
  const discrepancy = reasons.size > 0 && !(reasons.size === 1 && reasons.has('WORKSPACE_NOT_ALLOWED') && files.length === 0);
  const discrepancyReasons = [...reasons].filter((reason) => reason !== 'WORKSPACE_NOT_ALLOWED');
  if (status !== 'BLOCKED' && (discrepancy || discrepancyReasons.length > 0)) status = 'GATED';

  const addedFiles = files.filter((file) => file.kind === 'added' && !escapes(file.path)).map((file) => file.path);
  const modifiedFiles = files.filter((file) => file.kind === 'modified' && !escapes(file.path)).map((file) => file.path);
  const deletedFiles = files.filter((file) => file.kind === 'deleted' && !escapes(file.path)).map((file) => file.path);
  const changedFiles = [...addedFiles, ...modifiedFiles, ...deletedFiles];
  const flags = new Set<JuryRiskFlag>();
  if (credential || [...blocked].some((file) => file.startsWith('src/lib/ai-review-board/'))) flags.add('SECURITY');
  if ([...blocked].some((file) => isRiskFile(file))) flags.add('HIGH_RISK_FILE');
  if ([...blocked].some((file) => file.startsWith('prisma/migrations/') || file === 'prisma/schema.prisma')) flags.add('DB_MIGRATION');
  if ([...blocked].some((file) => file === 'vercel.json' || file.startsWith('.github/workflows/') || file.startsWith('infra/'))) {
    flags.add('PRODUCTION_CONFIG');
  }
  let largest: string | null = null;
  let largestSize = -1;
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    if (escapes(file.path)) continue;
    additions += file.additions;
    deletions += file.deletions;
    const size = file.additions + file.deletions;
    if (size > largestSize) {
      largestSize = size;
      largest = file.path;
    }
  }
  return {
    status,
    changedFiles,
    addedFiles,
    modifiedFiles,
    deletedFiles,
    blockedFiles: [...blocked],
    riskFlags: [...flags],
    riskLevel: risk,
    riskReasons: [...reasons],
    discrepancy: discrepancyReasons.length > 0,
    discrepancyReasons,
    diffStat: {
      filesChanged: changedFiles.length,
      additions,
      deletions,
      totalChangedLines: additions + deletions,
      largestChangedFile: largest,
      files: files
        .filter((file) => !escapes(file.path))
        .map((file) => ({ path: file.path, additions: file.additions, deletions: file.deletions })),
    },
    credentialDetected: credential != null,
    credentialType: credential,
    errorCode,
  };
}
