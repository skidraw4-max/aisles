/**
 * Loads one improvement task and passes the normalized fields to the pure check.
 * It does not write a row or an audit.
 */
import { evaluateAutoLoopPreflight, type AutoLoopPreflightResult } from './auto-loop-preflight';

export async function inspectStoredImprovementTask(
  taskId: string,
  actorTenantId: string,
): Promise<AutoLoopPreflightResult> {
  const { prisma } = await import('@/lib/prisma');
  const row = await prisma.juryImprovementTask.findUnique({
    where: { id: taskId },
    select: {
      tenantId: true,
      status: true,
      taskType: true,
      title: true,
      description: true,
      reason: true,
      objective: true,
      constraints: true,
      provenance: true,
    },
  });
  if (!row || !row.taskType) return { status: 'BLOCKED', code: 'TASK_INCOMPLETE' };
  return evaluateAutoLoopPreflight({
    actorTenantId,
    tenantId: row.tenantId,
    status: row.status,
    taskType: row.taskType,
    title: row.title,
    description: row.description,
    reason: row.reason,
    objective: row.objective,
    constraints: row.constraints,
    provenance: row.provenance,
  });
}
