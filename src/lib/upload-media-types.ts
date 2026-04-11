import { sniffMediaMime } from '@/lib/sniff-media-mime';

/** 업로드 허용 MIME → 파일 확장자 (키는 소문자 기준으로 조회) */
export const MEDIA_EXT = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/pjpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/x-png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
  ['video/quicktime', 'mov'],
]);

/**
 * `File.type`이 비어 있거나 브라우저/OS별 별칭일 때 버퍼 시그니처로 보정.
 */
export function resolveUploadMimeType(
  fileType: string | undefined,
  buf: Buffer
): { mime: string; ext: string } | null {
  const trimmed = fileType?.trim();
  if (trimmed) {
    const lower = trimmed.toLowerCase();
    if (MEDIA_EXT.has(lower)) {
      return { mime: lower, ext: MEDIA_EXT.get(lower)! };
    }
  }
  const sniffed = sniffMediaMime(buf);
  if (sniffed && MEDIA_EXT.has(sniffed)) {
    return { mime: sniffed, ext: MEDIA_EXT.get(sniffed)! };
  }
  return null;
}
