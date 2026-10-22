import { isTrustedMediaUrl } from '@/lib/r2-url';

export const MAX_POST_MEDIA = 5;

/** API 본문에서 mediaUrls 배열 파싱·검증 (최대 5, 신뢰 URL만) */
export function parseMediaUrlsField(
  b: Record<string, unknown>
): { ok: true; urls: string[] } | { ok: false; message: string } {
  if (b.mediaUrls === undefined) {
    return { ok: true, urls: [] };
  }
  if (!Array.isArray(b.mediaUrls)) {
    return { ok: false, message: 'mediaUrls는 문자열 배열이어야 합니다.' };
  }
  const urls = b.mediaUrls
    .filter((x): x is string => typeof x === 'string')
    .map((u) => u.trim())
    .filter(Boolean);
  if (urls.length > MAX_POST_MEDIA) {
    return { ok: false, message: `첨부 미디어는 최대 ${MAX_POST_MEDIA}개까지입니다.` };
  }
  for (const u of urls) {
    if (!isTrustedMediaUrl(u)) {
      return { ok: false, message: '허용된 저장소에서 업로드된 미디어 URL만 사용할 수 있습니다.' };
    }
  }
  return { ok: true, urls };
}

export function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(url);
}
