import type { MitNewsSummaryJson } from '@/lib/mit-news/summarize-mit-article';

function stripVisualMarkdown(s: string): string {
  return s
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** 게시 본문 + 하단 출처(원문 링크 강조) */
export function formatMitNewsPostBody(originalUrl: string, data: MitNewsSummaryJson): string {
  const summary = stripVisualMarkdown(data.easySummary);
  const future = stripVisualMarkdown(data.futureImpact);

  return `## 배경

${stripVisualMarkdown(data.backgroundContext)}

## 핵심 정리

${summary}

## 이 기술이 바꿀 미래

${future}

---

**출처: MIT News (Original Article)**

[**원문 기사 보기 (영문)**](${originalUrl})`.trim();
}
