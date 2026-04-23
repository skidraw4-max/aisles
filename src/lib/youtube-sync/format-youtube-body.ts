import type { YoutubeSyndicationSource, YoutubeSummaryJson } from '@/lib/youtube-sync/summarize-youtube';

type FormatOpts = {
  /** 자막 없이 YouTube 설명(snippet)만으로 Gemini 요약한 경우 */
  metadataOnly?: boolean;
};

/** 요약 본문만 (iframe은 게시글 상세에서 별도 렌더) */
export function formatYoutubePostBody(
  source: YoutubeSyndicationSource,
  summary: YoutubeSummaryJson,
  opts?: FormatOpts,
): string {
  let body = `## 배경

${summary.backgroundContext.trim()}

## 핵심 정리

${summary.summaryBody.trim()}

## 향후 전망

${summary.futureOutlook.trim()}`;
  if (opts?.metadataOnly) {
    body += `

---

※ 이 글은 해당 영상에 사용 가능한 자막이 없어, YouTube에 표시된 **영상 설명**을 바탕으로 작성되었습니다. 상세 내용은 원본 영상을 시청해 주세요.`;
  }
  if (source === 'MIT_OCW') {
    return `${body}

---

콘텐츠 출처: MIT OpenCourseWare (CC BY-NC-SA 적용)`.trim();
  }
  return body;
}
