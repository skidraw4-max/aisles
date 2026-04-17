import type { GeekNewsSummaryJson } from '@/lib/geeknews/summarize';

/** 게시글 본문 + 필수 출처 푸터 */
export function formatGeekNewsPostBody(originalUrl: string, data: GeekNewsSummaryJson): string {
  const lines = data.lines.map((l, i) => `${i + 1}. ${l}`).join('\n');
  const footer = `출처: GeekNews ([원문 링크](${originalUrl}))`;
  return `## 요약\n${lines}\n\n**인사이트:** ${data.insight}\n\n---\n\n${footer}`;
}
