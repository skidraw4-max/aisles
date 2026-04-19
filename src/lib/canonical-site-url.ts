/**
 * 검색·OG·사이트맵·metadataBase 등에 쓰는 정규 오리진.
 * 배포: `NEXT_PUBLIC_SITE_URL=https://www.example.com` (프로토콜 포함 권장)
 * `www.example.com` 처럼 프로토콜이 없으면 `https://` 를 붙입니다.
 */
/** 환경 변수 미설정 시 기본값(실 서비스 도메인과 일치시켜 canonical·OG·사이트맵 불일치 방지) */
const DEFAULT_ORIGIN = 'https://www.aisleshub.com';

function normalizeToOrigin(raw: string): string {
  let s = raw.trim().replace(/\/$/, '');
  if (!s) return DEFAULT_ORIGIN;
  if (!/^https?:\/\//i.test(s)) {
    s = `https://${s}`;
  }
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return DEFAULT_ORIGIN;
    }
    return u.origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

export function getCanonicalSiteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!env) {
    return DEFAULT_ORIGIN;
  }
  return normalizeToOrigin(env);
}
