/** R2 퍼블릭 URL만 게시글 썸네일로 허용 (임의 URL 주입 방지) */
export function getR2PublicBase(): string | null {
  const raw =
    process.env.R2_PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL?.trim();
  const b = raw?.replace(/\/$/, '');
  return b || null;
}

export function isTrustedR2Url(url: string): boolean {
  const base = getR2PublicBase();
  if (!base) return false;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  return url === base || url.startsWith(`${base}/`);
}
