/**
 * Techmeme RSS `description` HTML에서 원문 기사 URL 추출.
 * 피드는 `link`가 techmeme.com 퍼머링크이고, 본문 링크는 `<B><A HREF="…">` 에 있다.
 */
const BOLD_HEADLINE_LINK_RE = /<b>\s*<a\s+href="([^"]+)"/i;

function isTechmemeHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'techmeme.com' || h === 'www.techmeme.com';
}

function looksLikeImageAssetUrl(url: string): boolean {
  return /\.(jpe?g|png|gif|webp|svg)(\?|#|$)/i.test(url);
}

function isUsableOriginalUrl(raw: string): boolean {
  const s = raw.trim();
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (isTechmemeHost(u.hostname)) return false;
    if (looksLikeImageAssetUrl(s)) return false;
    return true;
  } catch {
    return false;
  }
}

/** RSS `item.description`(HTML)에서 원문 기사 http(s) URL 한 개 */
export function extractTechmemeOriginalArticleUrl(description: string | undefined): string | null {
  if (!description || typeof description !== 'string') return null;
  const bold = description.match(BOLD_HEADLINE_LINK_RE);
  if (bold?.[1] && isUsableOriginalUrl(bold[1])) {
    return bold[1].trim().slice(0, 2048);
  }

  const candidates: string[] = [];
  let m: RegExpExecArray | null;
  const re = /href="([^"]+)"/gi;
  while ((m = re.exec(description)) !== null) {
    const u = m[1]?.trim();
    if (u && isUsableOriginalUrl(u)) candidates.push(u);
  }
  const first = candidates[0];
  return first ? first.slice(0, 2048) : null;
}
