import type { AiBreakfastSummaryJson } from '@/lib/aibreakfast/summarize-aibreakfast';

export function formatAiBreakfastPostBody(originalUrl: string, data: AiBreakfastSummaryJson): string {
  const blocks = data.topics.map((t, i) => {
    return `### ${i + 1}. ${t.headline.trim()}

**요약** — ${t.summary.trim()}

**인사이트** — ${t.insight.trim()}`;
  });

  return `${blocks.join('\n\n')}

---

Source: AI Breakfast Newsletter ([Original link](${originalUrl}))`.trim();
}
