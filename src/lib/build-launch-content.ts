const BULLET_LINE =
  /^[\s]*(?:[-*•]|[\d]+[.)])\s+(.+)$/;

const URL_IN_TEXT = /https?:\/\/[^\s<>"')]+/gi;

/** 본문에서 첫 HTTP(S) URL */
export function extractFirstHttpUrl(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  URL_IN_TEXT.lastIndex = 0;
  const m = URL_IN_TEXT.exec(text.trim());
  return m ? m[0] : null;
}

export type ParsedProductDoc = {
  features: string[];
  overview: string;
};

/** 불릿/번호 목록은 특징으로, 나머지 줄은 개요 문단으로 분리 */
export function parseProductDocContent(content: string | null | undefined): ParsedProductDoc {
  if (!content?.trim()) return { features: [], overview: '' };
  const lines = content.trim().split(/\r?\n/);
  const features: string[] = [];
  const overviewLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const m = trimmed.match(BULLET_LINE);
    if (m?.[1]) {
      features.push(m[1].trim());
    } else {
      overviewLines.push(line);
    }
  }
  return {
    features,
    overview: overviewLines.join('\n').trim(),
  };
}

/** CTA와 중복되지 않게 단독 URL 한 줄은 개요에서 제거 */
export function stripStandaloneUrlFromOverview(overview: string, url: string | null): string {
  if (!url || !overview) return overview;
  const lines = overview.split(/\r?\n/);
  const filtered = lines.filter((line) => {
    const t = line.trim();
    if (t === url) return false;
    if (t === `<${url}>`) return false;
    if (t === `(${url})`) return false;
    return true;
  });
  return filtered.join('\n').trim();
}
