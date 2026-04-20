import type { VergeSummaryJson } from '@/lib/verge/summarize-verge';

/** 게시 본문 + 하단 출처(원문 링크) */
export function formatVergePostBody(originalUrl: string, data: VergeSummaryJson): string {
  const [a, b, c] = data.lines;
  const body = `${a}

${b}

${c}

**시사점** — ${data.takeaway.trim()}

---

출처: The Verge ([Original Link](${originalUrl}))`;

  return body.trim();
}
