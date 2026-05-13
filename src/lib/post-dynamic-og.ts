import type { Category } from '@prisma/client';

/** LAB(RECIPE) + UI 「AI 트렌드」 복도(LOUNGE). 레거시 Prisma `TREND`는 메인 복도와 별도이므로 기존 OG 유지 */
export function categoryUsesDynamicPostOg(category: Category): boolean {
  return category === 'RECIPE' || category === 'LOUNGE';
}

export function dynamicOgBoardSubtitle(category: Category): string {
  switch (category) {
    case 'RECIPE':
      return 'AIsle · AI 연구소 (LAB)';
    case 'LOUNGE':
      return 'AIsle · AI 트렌드';
    default:
      return 'AIsle';
  }
}

export function isProbablyVideoAssetUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(url);
}

function toAbsoluteMediaUrl(raw: string, siteBase: string): string {
  const u = raw.trim();
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  if (u.startsWith('//')) return `https:${u}`;
  const base = siteBase.replace(/\/$/, '');
  const path = u.startsWith('/') ? u : `/${u}`;
  return `${base}${path}`;
}

/** 썸네일·첫 첨부 중 비디오가 아닌 URL — OG 합성용 */
export function resolvePostOgThumbnailUrl(
  post: { thumbnail: string | null; attachmentUrls: string[] },
  siteBase: string
): string | null {
  const fromThumb = post.thumbnail?.trim();
  const fromAttach = post.attachmentUrls.find((u) => u?.trim())?.trim();
  const raw = fromThumb || fromAttach;
  if (!raw || isProbablyVideoAssetUrl(raw)) return null;
  return toAbsoluteMediaUrl(raw, siteBase);
}

export function truncateForOgTitle(title: string, maxChars: number): string {
  const t = title.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(0, maxChars - 1))}…`;
}
