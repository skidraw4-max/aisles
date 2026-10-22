import type { GeekNewsArticleJson } from '@/lib/geeknews/summarize';

/**
 * Lounge 본문 + 하단 Source: Techmeme, 원문·리버 링크.
 */
export function formatTechmemePostBody(
  originalArticleUrl: string,
  techmemeRiverUrl: string,
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

  const footer = `📝 원문 및 참고

- Source: Techmeme
- Techmeme 리버: [techmeme.com](${techmemeRiverUrl})
- 원문 기사: [링크 열기](${originalArticleUrl})

---

출처: Techmeme ([Original Article](${originalArticleUrl}))`;

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
