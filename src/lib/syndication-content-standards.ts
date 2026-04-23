/** 수집 글(뉴스·영상) 본문 최소 분량 — AdSense·SEO용 서술형 깊이 확보 */
export const MIN_SYNDICATED_BODY_CHARS = 600;

/** 메타데이터만 있는 YouTube 요약 등 — 입력이 빈약할 때 하한 완화 */
export const MIN_YOUTUBE_METADATA_SUMMARY_CHARS = 320;

export function totalCharCount(parts: readonly string[]): number {
  return parts.reduce((n, s) => n + (typeof s === 'string' ? s.length : 0), 0);
}
