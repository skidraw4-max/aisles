/** Build X / Kakao share URLs after clipboard copy (client-safe). */
export function buildXShareUrl(url: string, text: string): string {
  const u = new URL('https://twitter.com/intent/tweet');
  u.searchParams.set('url', url);
  u.searchParams.set('text', text.slice(0, 200));
  return u.toString();
}

export function buildKakaoShareUrl(url: string): string {
  // Kakao Talk share via Kakao Link requires SDK; use open chat-friendly URL share page.
  const u = new URL('https://story.kakao.com/share');
  u.searchParams.set('url', url);
  return u.toString();
}
