'use client';

import imageCompression from 'browser-image-compression';
import { COMPRESSED_IMAGE_MAX_BYTES } from '@/lib/upload-limits';

/** 압축 후에도 이 값을 넘으면 알림 + 업로드 중단 */
const COMPRESSED_TOO_LARGE_MESSAGE = '파일이 너무 큽니다';

const MAX_SIZE_MB = 2;
const MAX_WIDTH_OR_HEIGHT = 1200;

/** 압축 결과를 다시 File로 감쌀 때 webp 확장자가 어울리면 교체 */
function withCompressedFilename(original: string, mimeType: string): string {
  const base = original.replace(/\.[^./\\]+$/, '') || 'image';
  if (mimeType === 'image/webp') return `${base}.webp`;
  if (mimeType === 'image/jpeg') return `${base}.jpg`;
  if (mimeType === 'image/png') return `${base}.png`;
  return original;
}

/** GIF/영상은 압축하지 않음 (애니메이션·코덱 보존) */
function shouldCompress(file: File): boolean {
  if (!file.type.startsWith('image/')) return false;
  if (file.type === 'image/gif') return false;
  return true;
}

export class CompressedTooLargeError extends Error {
  constructor() {
    super(COMPRESSED_TOO_LARGE_MESSAGE);
    this.name = 'CompressedTooLargeError';
  }
}

/**
 * 업로드 전 클라이언트에서 이미지 압축.
 * - 최대 ~2MB, 최대 변 1200px (비율 유지)
 * - 압축 후에도 {@link COMPRESSED_IMAGE_MAX_BYTES} 초과면 `alert` 후 `CompressedTooLargeError` 던짐.
 */
export async function compressImageForUpload(file: File): Promise<File> {
  if (!shouldCompress(file)) {
    if (file.size > COMPRESSED_IMAGE_MAX_BYTES && file.type.startsWith('image/')) {
      if (typeof window !== 'undefined') window.alert(COMPRESSED_TOO_LARGE_MESSAGE);
      throw new CompressedTooLargeError();
    }
    return file;
  }

  let compressedBlob: Blob;
  try {
    compressedBlob = await imageCompression(file, {
      maxSizeMB: MAX_SIZE_MB,
      maxWidthOrHeight: MAX_WIDTH_OR_HEIGHT,
      useWebWorker: true,
      initialQuality: 0.85,
    });
  } catch {
    /** 압축 실패 시 원본으로 폴백 — 서버 한도에서 다시 검증 */
    compressedBlob = file;
  }

  const outType = compressedBlob.type || file.type;
  const outName = withCompressedFilename(file.name, outType);
  const compressed =
    compressedBlob instanceof File && compressedBlob.name
      ? compressedBlob
      : new File([compressedBlob], outName, {
          type: outType,
          lastModified: Date.now(),
        });

  if (compressed.size > COMPRESSED_IMAGE_MAX_BYTES) {
    if (typeof window !== 'undefined') window.alert(COMPRESSED_TOO_LARGE_MESSAGE);
    throw new CompressedTooLargeError();
  }

  return compressed;
}
