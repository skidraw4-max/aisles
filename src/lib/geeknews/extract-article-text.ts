/** 큰 원문도 최대한 반영(메모리·타임아웃 한도 내) */
const MAX_BYTES = 8_000_000;

/** HTML에서 본문 후보 텍스트만 거칠게 추출 (스크립트·스타일 제거) */
export function htmlToPlainText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ');

  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/gi, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * 외부 원문 URL에서 HTML을 받아 평문으로 변환.
 * 실패 시 빈 문자열(호출부에서 스킵).
 */
export async function fetchExternalArticlePlainText(url: string): Promise<string> {
  const u = url.trim();
  if (!u.toLowerCase().startsWith('https://')) {
    return '';
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 28_000);
  try {
    const res = await fetch(u, {
      method: 'GET',
      redirect: 'follow',
      signal: ac.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; AIsle-GeekNews/1.0; +https://github.com/skidraw4-max/aisles)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return '';

    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return htmlToPlainText(
        new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, MAX_BYTES)),
      );
    }
    const html = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    return htmlToPlainText(html);
  } catch {
    clearTimeout(timer);
    return '';
  }
}
