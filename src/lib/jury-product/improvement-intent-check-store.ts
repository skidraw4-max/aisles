/**
 * Loads one completed execution and passes its change text to the intent check.
 * It does not write a row, an audit, or a change-gate result.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  evaluateImprovementIntent,
  type ImprovementIntentChange,
  type ImprovementIntentResult,
} from './improvement-intent-check';

export async function inspectImprovementIntent(executionId: string, actorTenantId: string): Promise<ImprovementIntentResult> {
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
  if (!execution?.task) return { status: 'SAFE', code: 'SAFE', reason: 'WITHIN_TASK_INTENT' };
  const artifact = readArtifact(execution.resultRef);
  const provenance = record(execution.task.provenance);
  return evaluateImprovementIntent({
    actorTenantId,
    taskTenantId: execution.task.tenantId,
    executionTenantId: execution.tenantId,
    objective: execution.task.objective,
    constraints: strings(execution.task.constraints),
    provenance: execution.task.provenance,
    allowedPaths: strings(execution.allowedPaths).concat(strings(provenance.allowedPaths)),
    workspaceRef: workspaceOf(execution.workspaceRef) ?? workspaceOf(provenance.workspaceRef),
    changedFiles: artifact.changedFiles,
    changes: artifact.changes,
    summary: artifact.summary,
  });
}

function readArtifact(resultRef: string | null): { changedFiles: string[]; changes: ImprovementIntentChange[]; summary: string | null } {
  const empty = { changedFiles: [], changes: [], summary: null };
  if (!resultRef || !resultRef.startsWith('data/jury-product/agent-executions/') || resultRef.includes('..')) return empty;
  try {
    const body = JSON.parse(readFileSync(path.resolve(process.cwd(), resultRef), 'utf8')) as {
      changedFiles?: unknown;
      summary?: unknown;
      changes?: unknown;
    };
    const changes = Array.isArray(body.changes)
      ? body.changes.flatMap((item) => {
          if (!item || typeof item !== 'object') return [];
          const row = item as { path?: unknown; kind?: unknown; text?: unknown };
          if (typeof row.path !== 'string') return [];
          return [{ path: row.path, kind: typeof row.kind === 'string' ? row.kind : undefined, text: typeof row.text === 'string' ? row.text : null }];
        })
      : [];
    return {
      changedFiles: strings(body.changedFiles),
      changes,
      summary: typeof body.summary === 'string' ? body.summary : null,
    };
  } catch {
    return empty;
  }
}

function workspaceOf(value: unknown): { type: string; ref: string } | null {
  const row = record(value);
  if (row.type === 'PROJECT' && typeof row.ref === 'string') return { type: 'PROJECT', ref: row.ref };
  return null;
}

function record(value: unknown): { type?: unknown; ref?: unknown; workspaceRef?: unknown; allowedPaths?: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as { type?: unknown; ref?: unknown; workspaceRef?: unknown; allowedPaths?: unknown };
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}
