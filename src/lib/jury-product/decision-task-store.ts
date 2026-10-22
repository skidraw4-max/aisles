/**
 * Stores a decision task and its audit. It does not execute the task.
 */
import type { DecisionTaskAudit, DecisionTaskCommand, DecisionTaskDraft, DecisionTaskWriteTx } from './decision-task';
import { runDecisionTaskPersist } from './decision-task';

type PersistOutcome = Awaited<ReturnType<typeof runDecisionTaskPersist>>;

export async function persistDecisionTask(command: DecisionTaskCommand): Promise<PersistOutcome> {
  const { prisma } = await import('@/lib/prisma');
  return prisma.$transaction(async (tx) => {
    const boundary: DecisionTaskWriteTx = {
      async findByResultAndType(reviewResultId, taskType) {
        const row = await tx.juryDecisionTask.findUnique({
          where: { reviewResultId_taskType: { reviewResultId, taskType } },
        });
        return row ? mapTask(row) : null;
      },
      async insert(task, audit) {
        await tx.juryDecisionTask.create({ data: taskData(task) });
        await tx.juryAuditEvent.create({ data: auditData(audit) });
      },
    };
    return runDecisionTaskPersist(command, boundary);
  });
}

function mapTask(row: {
  id: string;
  tenantId: string;
  reviewResultId: string;
  evidenceId: string;
  taskType: DecisionTaskDraft['taskType'];
  decision: string;
  title: string;
  description: string;
  reason: string;
  status: DecisionTaskDraft['status'];
  createdAt: Date;
  updatedAt: Date;
}): DecisionTaskDraft {
  if (row.decision !== 'VERIFY' && row.decision !== 'REWORD') {
    throw new Error('DECISION_NOT_IN_CONTRACT');
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    reviewResultId: row.reviewResultId,
    evidenceId: row.evidenceId,
    taskType: row.taskType,
    decision: row.decision,
    title: row.title,
    description: row.description,
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function taskData(task: DecisionTaskDraft) {
  return {
    id: task.id,
    tenantId: task.tenantId,
    reviewResultId: task.reviewResultId,
    evidenceId: task.evidenceId,
    taskType: task.taskType,
    decision: task.decision,
    title: task.title,
    description: task.description,
    reason: task.reason,
    status: task.status,
    createdAt: new Date(task.createdAt),
    updatedAt: new Date(task.updatedAt),
  };
}

function auditData(audit: DecisionTaskAudit) {
  return {
    id: audit.id,
    tenantId: audit.tenantId,
    timestamp: new Date(audit.timestamp),
    actor: audit.actorUserId,
    action: audit.action,
    evidenceId: audit.evidenceId,
    reviewId: audit.reviewResultId,
    decision: audit.decision,
    improvementTaskId: audit.taskId,
  };
}
