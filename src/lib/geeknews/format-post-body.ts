import type { GeekNewsArticleJson } from '@/lib/geeknews/summarize';

/**
 * Lounge `PostRichContent`용 본문.
 * UI에서 위에 "설명" 라벨이 붙으므로 본문은 참고 글처럼 바로 도입부터 시작.
 */
export function formatGeekNewsPostBody(
  originalUrl: string,
  topicUrl: string | null,
  data: GeekNewsArticleJson,
): string {
  const sectionBlocks = data.sections
    .map((s) => `### ${s.title}\n\n${s.content}`)
    .join('\n\n');

  const techBlock =
    data.techStackOrMeta.trim().length > 0
      ? `\n\n### 기술·메타\n\n${data.techStackOrMeta.trim()}`
      : '';

  const bg = data.backgroundContext.trim();
  const fo = data.futureOutlook.trim();

  const gnLine = topicUrl
    ? `- GeekNews 토픽: [보기](${topicUrl})`
    : `- GeekNews: [최신 목록](https://news.hada.io/new)`;

  const footer = `📝 원문 및 참고

- 원문: [링크 열기](${originalUrl})
${gnLine}

---

출처: GeekNews ([원문 링크](${originalUrl}))`;

  return `${data.introduction.trim()}

### 배경 설명

${bg}

${sectionBlocks}

### 가치와 인사이트

${data.valueAndInsight.trim()}${techBlock}

### 향후 전망

${fo}

${footer}`;
}
