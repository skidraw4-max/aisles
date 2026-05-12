import sharp from 'sharp';

/** WebP로 변환 가능한 정적 이미지 MIME */
const WEBP_CONVERTIBLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type NormalizedImage = {
  buffer: Buffer;
  mimeType: string;
  ext: string;
};

/**
 * 저장소 PUT 직전에 정적 이미지를 **WebP**로 정규화.
 * - JPEG/PNG → WebP (quality 82)
 * - WebP → 그대로 (재인코딩 없이)
 * - GIF·영상·기타 → 입력 그대로 반환
 * 실패 시 입력 그대로 반환 (저장 자체는 막지 않음).
 */
export async function normalizeImageToWebp(input: NormalizedImage): Promise<NormalizedImage> {
  if (!WEBP_CONVERTIBLE.has(input.mimeType)) return input;
  if (input.mimeType === 'image/webp') return input;

  try {
    const out = await sharp(input.buffer).rotate().webp({ quality: 82 }).toBuffer();
    return { buffer: out, mimeType: 'image/webp', ext: 'webp' };
  } catch (e) {
    console.warn('[normalize-upload-image] webp 변환 실패, 원본 사용:', e);
    return input;
  }
}
