import { classifyGeminiFailure } from '@/lib/gemini-prompt-analysis-engine';

/** 뉴스 자동 수집 시 Gemini `generateContent` 호출 간 최소 간격 (Rate limit 완화) */
export const NEWS_SYNC_GEMINI_GAP_MS = 12000;

/** 크론 1회당 Gemini 요약 시도 상한 (rate limit 연쇄 방지) */
export const MAX_GEMINI_CALLS_PER_SYNC_RUN = 5;

/** RATE_LIMIT 시 지수 백오프 재시도 간격 (ms) — 마지막은 userMessage의 1분 안내에 맞춤 */
export const GEMINI_RATE_LIMIT_RETRY_DELAYS_MS = [8000, 20000, 60000] as const;

/** Vercel `maxDuration=120` 대비 크론 1회 wall-clock 예산 (응답 직렬화·여유 포함) */
export const NEWS_SYNC_WALL_CLOCK_BUDGET_MS = 95_000;

/** Gemini 1회 호출 전 남아 있어야 할 최소 예산 */
export const NEWS_SYNC_MIN_BUDGET_FOR_GEMINI_MS = 22_000;

export type SyncDeadline = {
  startedAt: number;
  budgetMs: number;
  remainingMs(): number;
  hasBudget(minRequiredMs?: number): boolean;
};

export function createSyncDeadline(
  budgetMs: number = NEWS_SYNC_WALL_CLOCK_BUDGET_MS,
): SyncDeadline {
  const startedAt = Date.now();
  return {
    startedAt,
    budgetMs,
    remainingMs() {
      return Math.max(0, budgetMs - (Date.now() - startedAt));
    },
    hasBudget(minRequiredMs = 0) {
      return this.remainingMs() > minRequiredMs;
    },
  };
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isGeminiRateLimitMessage(message: string | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    message.includes('API 사용량') ||
    lower.includes('rate limit') ||
    lower.includes('resource exhausted') ||
    lower.includes('quota exceeded')
  );
}

export type RetryOnGeminiRateLimitOptions = {
  /** 남은 예산이 부족하면 백오프 재시도를 생략하고 즉시 throw (FUNCTION_INVOCATION_TIMEOUT 방지) */
  deadline?: SyncDeadline;
};

/** Gemini `generateContent` 등 — RATE_LIMIT만 지수 백오프 재시도 */
export async function retryOnGeminiRateLimit<T>(
  fn: () => Promise<T>,
  logTag: string,
  options?: RetryOnGeminiRateLimitOptions,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= GEMINI_RATE_LIMIT_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const classified = classifyGeminiFailure(e);
      if (
        classified.category !== 'RATE_LIMIT' ||
        attempt >= GEMINI_RATE_LIMIT_RETRY_DELAYS_MS.length
      ) {
        throw e;
      }
      const delay = GEMINI_RATE_LIMIT_RETRY_DELAYS_MS[attempt]!;
      const deadline = options?.deadline;
      if (deadline && deadline.remainingMs() <= delay + NEWS_SYNC_MIN_BUDGET_FOR_GEMINI_MS) {
        console.warn(
          `[${logTag}] Gemini RATE_LIMIT — sync 시간 예산 부족, 재시도 생략 (remaining=${deadline.remainingMs()}ms)`,
        );
        throw e;
      }
      console.warn(
        `[${logTag}] Gemini RATE_LIMIT — ${delay}ms 후 재시도 (${attempt + 1}/${GEMINI_RATE_LIMIT_RETRY_DELAYS_MS.length})`,
      );
      await sleepMs(delay);
    }
  }
  throw lastErr;
}
