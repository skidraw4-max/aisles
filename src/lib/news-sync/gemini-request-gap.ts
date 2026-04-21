/** 뉴스 자동 수집 시 Gemini `generateContent` 호출 간 최소 간격 (Rate limit 완화) */
export const NEWS_SYNC_GEMINI_GAP_MS = 3000;

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
