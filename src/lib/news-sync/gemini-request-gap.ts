import { classifyGeminiFailure } from '@/lib/gemini-prompt-analysis-engine';

/** 뉴스 자동 수집 시 Gemini `generateContent` 호출 간 최소 간격 (Rate limit 완화) */
export const NEWS_SYNC_GEMINI_GAP_MS = 6000;

/** 크론 1회당 Gemini 요약 시도 상한 (rate limit 연쇄 방지) */
export const MAX_GEMINI_CALLS_PER_SYNC_RUN = 5;

/** RATE_LIMIT 시 지수 백오프 재시도 간격 (ms) — 마지막은 userMessage의 1분 안내에 맞춤 */
export const GEMINI_RATE_LIMIT_RETRY_DELAYS_MS = [8000, 20000, 60000] as const;

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

/** Gemini `generateContent` 등 — RATE_LIMIT만 지수 백오프 재시도 */
export async function retryOnGeminiRateLimit<T>(
  fn: () => Promise<T>,
  logTag: string,
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
      console.warn(
        `[${logTag}] Gemini RATE_LIMIT — ${delay}ms 후 재시도 (${attempt + 1}/${GEMINI_RATE_LIMIT_RETRY_DELAYS_MS.length})`,
      );
      await sleepMs(delay);
    }
  }
  throw lastErr;
}
