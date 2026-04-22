import type { YoutubeSyndicationSource } from '@/lib/youtube-sync/summarize-youtube';

/** 요약 본문만 (iframe은 게시글 상세에서 별도 렌더) */
export function formatYoutubePostBody(source: YoutubeSyndicationSource, summaryBody: string): string {
  const body = summaryBody.trim();
  if (source === 'MIT_OCW') {
    return `${body}

---

콘텐츠 출처: MIT OpenCourseWare (CC BY-NC-SA 적용)`.trim();
  }
  return body;
}
