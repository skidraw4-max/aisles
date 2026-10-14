/**
 * Loads one completed execution and passes normalized fields to the scope check.
 * It does not write a row, an audit, or a change-gate result.
 */
import { existsSync, realpathSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveAllowedWorkspace } from './agent-workspace';
import { evaluateImprovementChangeScope, type ImprovementScopeResult } from './improvement-scope-check';

export async function inspectImprovementChangeScope(
  executionId: string,
  actorTenantId: string,
): Promise<ImprovementScopeResult> {
  const { prisma } = await import('@/lib/prisma');
  const execution = await prisma.juryAgentExecution.findUnique({
    where: { id: executionId },
    select: {
      tenantId: true,
      allowedPaths: true,
      workspaceRef: true,
      resultRef: true,
      task: {
        select: {
          tenantId: true,
          objective: true,
          constraints: true,
          provenance: true,
        },
      },
    },
  });
  if (!execution?.task) return { status: 'BLOCKED', code: 'NO_CHANGES', reason: 'OUTSIDE_TASK_SCOPE' };
  const workspaceRef = workspaceOf(execution.workspaceRef) ?? workspaceOf(record(execution.task.provenance).workspaceRef);
  const changedFiles = readChangedFiles(execution.resultRef);
  return evaluateImprovementChangeScope({
    actorTenantId,
    taskTenantId: execution.task.tenantId,
    executionTenantId: execution.tenantId,
    workspaceRef,
    allowedPaths: strings(execution.allowedPaths),
    objective: execution.task.objective,
    constraints: strings(execution.task.constraints),
    provenance: execution.task.provenance,
    changedFiles,
    linkEscape: linkEscapes(workspaceRef, changedFiles),
  });
}

function readChangedFiles(resultRef: string | null): string[] {
  if (!resultRef || !resultRef.startsWith('data/jury-product/agent-executions/') || resultRef.includes('..')) return [];
  try {
    const body = JSON.parse(readFileSync(path.resolve(process.cwd(), resultRef), 'utf8')) as { changedFiles?: unknown };
    return strings(body.changedFiles);
  } catch {
    return [];
  }
}

function linkEscapes(workspaceRef: { type: string; ref: string } | null, files: readonly string[]): boolean {
  if (!workspaceRef || workspaceRef.type !== 'PROJECT') return false;
  const root = resolveAllowedWorkspace({ type: 'PROJECT', ref: workspaceRef.ref });
  if (!root) return false;
  const absoluteRoot = path.resolve(process.cwd(), root);
  for (const file of files) {
    if (file.includes('..') || file.startsWith('/') || file.startsWith('\\') || /^[a-zA-Z]:/.test(file)) continue;
    const relative = file.startsWith(`workspace/${workspaceRef.ref}/`)
      ? file.slice(`workspace/${workspaceRef.ref}/`.length)
      : file.startsWith(`data/jury-product/workspaces/${workspaceRef.ref}/`)
        ? file.slice(`data/jury-product/workspaces/${workspaceRef.ref}/`.length)
        : file.includes('/')
          ? ''
          : file;
    if (!relative) continue;
    const candidate = path.resolve(absoluteRoot, relative);
    if (!existsSync(candidate)) continue;
    const real = realpathSync(candidate);
    const compared = path.relative(absoluteRoot, real);
    if (compared.startsWith('..') || path.isAbsolute(compared)) return true;
  }
  return false;
}

function workspaceOf(value: unknown): { type: string; ref: string } | null {
  const recordValue = record(value);
  if (recordValue.type === 'PROJECT' && typeof recordValue.ref === 'string') return { type: 'PROJECT', ref: recordValue.ref };
  return null;
}

function record(value: unknown): { type?: unknown; ref?: unknown; workspaceRef?: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as { type?: unknown; ref?: unknown; workspaceRef?: unknown };
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}
