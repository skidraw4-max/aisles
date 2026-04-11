import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const MARGIN_PX = 20;
/** 원본 너비 대비 워터마크 너비 비율 */
const WM_WIDTH_RATIO = 0.1;
/** 워터마크 알파 스케일 (약 25% → 20~30% 요구에 맞춤) */
const WM_ALPHA_SCALE = 0.25;
const MIN_WM_WIDTH = 48;

/** 애니메이션 보존을 위해 GIF는 합성하지 않음. 동영상도 제외. */
const WATERMARK_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type WatermarkUploadPayload = {
  buffer: Buffer;
  mimeType: string;
  ext: string;
};

function watermarkPath(): string {
  return path.join(process.cwd(), 'public', 'watermark.png');
}

/**
 * JPEG/PNG/WebP에만 우하단 워터마크 합성. 실패 시 원본 버퍼 반환.
 */
export async function applyWatermarkForUpload(payload: WatermarkUploadPayload): Promise<WatermarkUploadPayload> {
  const { buffer: input, mimeType, ext } = payload;
  if (!WATERMARK_MIME.has(mimeType)) {
    return payload;
  }

  const wmFile = watermarkPath();
  if (!fs.existsSync(wmFile)) {
    console.warn('[watermark] public/watermark.png 없음 — 원본 업로드');
    return payload;
  }

  try {
    const baseMeta = await sharp(input).metadata();
    const bw = baseMeta.width ?? 0;
    const bh = baseMeta.height ?? 0;
    if (bw < 40 || bh < 40) {
      return payload;
    }

    const maxBoxW = bw - 2 * MARGIN_PX;
    const maxBoxH = bh - 2 * MARGIN_PX;
    if (maxBoxW < 16 || maxBoxH < 16) {
      return payload;
    }

    let wmTargetW = Math.round(bw * WM_WIDTH_RATIO);
    wmTargetW = Math.max(MIN_WM_WIDTH, Math.min(wmTargetW, maxBoxW));

    const { data, info } = await sharp(wmFile)
      .resize({ width: wmTargetW, withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    for (let i = 3; i < data.length; i += 4) {
      data[i] = Math.round(data[i] * WM_ALPHA_SCALE);
    }

    let wmOverlay = await sharp(Buffer.from(data), {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4,
      },
    })
      .png()
      .toBuffer();

    let wmMeta = await sharp(wmOverlay).metadata();
    let ow = wmMeta.width ?? 0;
    let oh = wmMeta.height ?? 0;

    if (ow > maxBoxW || oh > maxBoxH) {
      wmOverlay = await sharp(wmOverlay)
        .resize({ width: maxBoxW, height: maxBoxH, fit: 'inside' })
        .png()
        .toBuffer();
      wmMeta = await sharp(wmOverlay).metadata();
      ow = wmMeta.width ?? 0;
      oh = wmMeta.height ?? 0;
    }

    const left = Math.max(MARGIN_PX, Math.round(bw - ow - MARGIN_PX));
    const top = Math.max(MARGIN_PX, Math.round(bh - oh - MARGIN_PX));

    const composited = sharp(input).composite([{ input: wmOverlay, left, top }]);

    let out: Buffer;
    if (mimeType === 'image/jpeg') {
      out = await composited.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
    } else if (mimeType === 'image/webp') {
      out = await composited.webp({ quality: 90 }).toBuffer();
    } else {
      out = await composited.png({ compressionLevel: 9 }).toBuffer();
    }

    return { buffer: out, mimeType, ext };
  } catch (e) {
    console.error('[watermark] 합성 실패, 원본 업로드:', e);
    return payload;
  }
}
