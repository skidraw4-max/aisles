/**
 * Measures elapsed time and recorded agent cost for an existing loop guard.
 * It does not change the guard comparison, write a cycle, or start an agent.
 */

export type LoopSpend = {
  runtimeMs: number | null;
  costUsd: number | null;
};

export function measureLoopSpend(input: {
  now: string;
  startedAt: string | null;
  tenantId: string;
  costs: readonly { tenantId: string; estimatedCostUsd: number | null }[];
}): LoopSpend {
  return {
    runtimeMs: elapsed(input.startedAt, input.now),
    costUsd: recordedCost(input.tenantId, input.costs),
  };
}

type SpendDb = {
  juryImprovementTask: {
    findMany(args: {
      where: { tenantId: string; reviewResultId: string };
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
  };
  juryAgentExecution: {
    findMany(args: {
      where: { taskId: { in: string[] } };
      select: { tenantId: true; estimatedCostUsd: true };
    }): Promise<Array<{ tenantId: string; estimatedCostUsd: unknown }>>;
  };
};

export async function loadLoopSpend(
  db: SpendDb,
  input: { tenantId: string; rootReviewResultId: string; startedAt: Date | string; now: string },
): Promise<LoopSpend> {
  const tasks = await db.juryImprovementTask.findMany({
    where: { tenantId: input.tenantId, reviewResultId: input.rootReviewResultId },
    select: { id: true },
  });
  const executions =
    tasks.length === 0
      ? []
      : await db.juryAgentExecution.findMany({
          where: { taskId: { in: tasks.map((task) => task.id) } },
          select: { tenantId: true, estimatedCostUsd: true },
        });
  return measureLoopSpend({
    now: input.now,
    startedAt: input.startedAt instanceof Date ? input.startedAt.toISOString() : input.startedAt,
    tenantId: input.tenantId,
    costs: executions.map((row) => ({ tenantId: row.tenantId, estimatedCostUsd: finiteCost(row.estimatedCostUsd) })),
  });
}

function elapsed(startedAt: string | null, now: string): number | null {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(now);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

function recordedCost(
  tenantId: string,
  costs: readonly { tenantId: string; estimatedCostUsd: number | null }[],
): number | null {
  const amounts = costs
    .filter((row) => row.tenantId === tenantId)
    .map((row) => row.estimatedCostUsd)
    .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
  if (amounts.length === 0) return null;
  return amounts.reduce((sum, value) => sum + value, 0);
}

function finiteCost(value: unknown): number | null {
  const amount =
    typeof value === 'number'
      ? value
      : value && typeof value === 'object' && 'toNumber' in value && typeof value.toNumber === 'function'
        ? value.toNumber()
        : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}
