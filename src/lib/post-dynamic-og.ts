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

/** Satori가 외부 URL 페치 시 타임아웃·OOM을 유발할 수 있어 동일 오리진만 허용 */
export function isSameOriginMediaUrl(url: string, siteBase: string): boolean {
  try {
    const origin = new URL(siteBase.replace(/\/$/, '') || 'https://www.aisleshub.com').origin;
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** 썸네일·첫 첨부 중 비디오가 아닌 URL — OG 합성용(동일 오리진만) */
export function resolvePostOgThumbnailUrl(
  post: { thumbnail: string | null; attachmentUrls: string[] },
  siteBase: string
): string | null {
  const fromThumb = post.thumbnail?.trim();
  const fromAttach = post.attachmentUrls.find((u) => u?.trim())?.trim();
  const raw = fromThumb || fromAttach;
  if (!raw || isProbablyVideoAssetUrl(raw)) return null;
  const abs = toAbsoluteMediaUrl(raw, siteBase);
  return isSameOriginMediaUrl(abs, siteBase) ? abs : null;
}

export function truncateForOgTitle(title: string, maxChars: number): string {
  const t = title.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(0, maxChars - 1))}…`;
}
