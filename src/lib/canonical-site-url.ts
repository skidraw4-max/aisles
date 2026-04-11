/**
 * 검색·OG·사이트맵 등에 쓰는 정규 도메인.
 * 배포 환경에서는 `NEXT_PUBLIC_SITE_URL=https://실제도메인` 권장.
 */
export function getCanonicalSiteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env) {
    return env.replace(/\/$/, '');
  }
  return 'https://aisleshub.com';
}
