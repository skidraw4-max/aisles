/** YouTube 영상 간 Gemini·자막 처리 간격 (요청 과부하 완화) */
export const YOUTUBE_SYNC_GAP_MS = 5000;

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
