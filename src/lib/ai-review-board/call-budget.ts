import type { CallBudget } from './types';

/** Flash-Lite 대략치 — 표시용 (정확 과금 아님) */
export const EST_USD_PER_CALL = 0.015;

export function createBudget(maxCalls: number): CallBudget {
  return {
    maxCalls,
    usedCalls: 0,
    estimatedCostUsd: 0,
    warnings: [],
  };
}

export function assertWithinBudget(budget: CallBudget): void {
  if (budget.usedCalls >= budget.maxCalls) {
    throw new Error(
      `AI_REVIEW_BOARD call budget exceeded (${budget.usedCalls}/${budget.maxCalls})`,
    );
  }
}

export function recordCall(budget: CallBudget): CallBudget {
  assertWithinBudget(budget);
  const usedCalls = budget.usedCalls + 1;
  const estimatedCostUsd = Number((usedCalls * EST_USD_PER_CALL).toFixed(4));
  const warnings = [...budget.warnings];
  if (usedCalls >= Math.floor(budget.maxCalls * 0.8) && !warnings.includes('approaching_limit')) {
    warnings.push('approaching_limit');
  }
  return { ...budget, usedCalls, estimatedCostUsd, warnings };
}

export function defaultMaxCallsFromEnv(): number {
  const raw = process.env.AI_REVIEW_BOARD_MAX_CALLS_PER_RUN?.trim();
  const n = raw ? Number(raw) : 40;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 40;
}
