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

export type FetchExternalPlainTextFailure = {
  ok: false;
  code: 'invalid_url' | 'http_error' | 'timeout' | 'network' | 'empty_body';
  message: string;
};

export type FetchExternalPlainTextSuccess = { ok: true; text: string };

export type FetchExternalPlainTextResult = FetchExternalPlainTextSuccess | FetchExternalPlainTextFailure;

/**
 * 외부 원문 URL에서 HTML을 받아 평문으로 변환.
 * 실패 시 단계·사유를 담아 반환 (호출부에서 JSON/로그용).
 */
export async function fetchExternalArticlePlainText(url: string): Promise<FetchExternalPlainTextResult> {
  const u = url.trim();
  if (!u.toLowerCase().startsWith('https://')) {
    return {
      ok: false,
      code: 'invalid_url',
      message: '원문 URL은 https:// 로 시작해야 합니다.',
    };
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
    if (!res.ok) {
      return {
        ok: false,
        code: 'http_error',
        message: `원문 접속 불가: HTTP ${res.status}`,
      };
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      const html = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, MAX_BYTES));
      const text = htmlToPlainText(html);
      return text.length > 0 ? { ok: true, text } : { ok: false, code: 'empty_body', message: '원문 추출 결과가 비었습니다.' };
    }
    const html = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    const text = htmlToPlainText(html);
    if (!text.length) {
      return { ok: false, code: 'empty_body', message: '원문 HTML에서 본문 텍스트를 추출하지 못했습니다.' };
    }
    return { ok: true, text };
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof Error && e.name === 'AbortError') {
      return { ok: false, code: 'timeout', message: '원문 요청 시간 초과(28초).' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, code: 'network', message: `원문 네트워크 오류: ${msg}` };
  }
}
