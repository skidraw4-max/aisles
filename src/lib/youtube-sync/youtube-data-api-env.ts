/** 서버 전용 — 클라이언트에 노출 금지 */
export function readYoutubeDataApiKey(): string | undefined {
  return (
    process.env.YOUTUBE_DATA_API_KEY?.trim() ||
    process.env.GOOGLE_YOUTUBE_API_KEY?.trim() ||
    process.env.YOUTUBE_API_KEY?.trim()
  );
}
