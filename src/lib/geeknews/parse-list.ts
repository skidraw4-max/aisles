/** GeekNews `/new` HTML에서 상단 나열 순서대로 항목 파싱 */

export type GeekNewsListItem = {
  /** 목록 제목 `<h1>` */
  title: string;
  /** `topictitle` 안의 외부 원문 링크 */
  externalUrl: string;
  /** `topic?id=` 식별용 */
  topicId: string;
};

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    });
}

/**
 * `https://news.hada.io/new` 응답 HTML.
 * 동일 외부 URL이 목록에 중복되면 첫 항목만 유지.
 */
export function parseGeekNewsNewListHtml(html: string): GeekNewsListItem[] {
  const chunks = html.split(/<div class='topic_row'/);
  const out: GeekNewsListItem[] = [];
  const seenExternal = new Set<string>();

  for (let i = 1; i < chunks.length; i++) {
    const block = chunks[i] ?? '';
    const idMatch = block.match(/data-topic-state-id='(\d+)'/);
    const linkMatch = block.match(
      /<div class=topictitle>[\s\S]*?<a href=['"](https?:\/\/[^'"]+)['"][^>]*>\s*<h1>([^<]*)<\/h1>/i,
    );
    if (!idMatch?.[1] || !linkMatch?.[1] || !linkMatch?.[2]) continue;

    const topicId = idMatch[1];
    const externalUrl = linkMatch[1].trim();
    const title = decodeHtmlEntities(linkMatch[2].replace(/\s+/g, ' ').trim());

    if (!title || !/^https?:\/\//i.test(externalUrl)) continue;
    if (seenExternal.has(externalUrl)) continue;
    seenExternal.add(externalUrl);

    out.push({ title, externalUrl, topicId });
  }

  return out;
}
