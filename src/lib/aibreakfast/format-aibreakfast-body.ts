import type { AiBreakfastSummaryJson } from '@/lib/aibreakfast/summarize-aibreakfast';

/** 모델이 넣은 마크다운 이미지·잔여 이미지 URL 설명 제거 */
function stripVisualMarkdown(s: string): string {
  return s
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function formatAiBreakfastPostBody(originalUrl: string, data: AiBreakfastSummaryJson): string {
  const blocks = data.topics.map((t, i) => {
    const headline = stripVisualMarkdown(t.headline.trim());
    const summary = stripVisualMarkdown(t.summary.trim());
    const insight = stripVisualMarkdown(t.insight.trim());
    return `### ${i + 1}. ${headline}

**요약** — ${summary}

**인사이트** — ${insight}`;
  });

  return `${blocks.join('\n\n')}

---

Source: AI Breakfast Newsletter ([Original link](${originalUrl}))`.trim();
}
