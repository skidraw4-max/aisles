import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { WATERMARK_PNG_BASE64 } from '@/lib/watermark-embedded';

/** 우하단 여백 — 빨간 표시 구역과 비슷하게 모서리에서 살짝 안쪽 */
const MARGIN_PX = 14;
/** 원본 너비 대비 워터마크 너비 (스크린샷 빨간 박스 ≈ 30~35% 너비에 맞춤) */
const WM_WIDTH_RATIO = 0.33;
/** 로고 알파 — 최대에 가깝게 */
const WM_ALPHA_SCALE = 1;
const MIN_WM_WIDTH = 100;

const WATERMARK_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type WatermarkUploadPayload = {
  buffer: Buffer;
  mimeType: string;
  ext: string;
};

function resolveWatermarkBufferFromFs(): Buffer | null {
  const cwd = process.cwd();
  for (const rel of ['public/watermark.png']) {
    const p = path.join(cwd, ...rel.split('/'));
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p);
    } catch {
      /* continue */
    }
  }
  return null;
}

/** 서버리스에서도 동작: 빌드에 포함된 base64 → (옵션) 디스크 폴백 */
function getWatermarkSourceBuffer(): Buffer {
  try {
    const fromB64 = Buffer.from(WATERMARK_PNG_BASE64, 'base64');
    if (fromB64.length > 100) return fromB64;
  } catch {
    /* fall through */
  }
  const disk = resolveWatermarkBufferFromFs();
  if (disk) return disk;
  throw new Error('[watermark] no embedded or file watermark');
}

/**
 * JPEG/PNG/WebP에만 우하단 워터마크 합성. 실패 시 원본 버퍼 반환.
 */
export async function applyWatermarkForUpload(payload: WatermarkUploadPayload): Promise<WatermarkUploadPayload> {
  const { buffer: input, mimeType, ext } = payload;
  if (!WATERMARK_MIME.has(mimeType)) {
    return payload;
  }

  let wmSource: Buffer;
  try {
    wmSource = getWatermarkSourceBuffer();
  } catch (e) {
    console.warn(e);
    return payload;
  }

  try {
    const basePipeline = sharp(input).rotate();
    const baseMeta = await basePipeline.metadata();
    const bw = baseMeta.width ?? 0;
    const bh = baseMeta.height ?? 0;
    if (bw < 40 || bh < 40) {
      return payload;
    }

    const maxBoxW = bw - 2 * MARGIN_PX;
    const maxBoxH = bh - 2 * MARGIN_PX;
    if (maxBoxW < 24 || maxBoxH < 24) {
      return payload;
    }

    let wmTargetW = Math.round(bw * WM_WIDTH_RATIO);
    wmTargetW = Math.max(MIN_WM_WIDTH, Math.min(wmTargetW, maxBoxW));

    const { data, info } = await sharp(wmSource)
      .resize({
        width: wmTargetW,
        fit: 'inside',
        withoutEnlargement: false,
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (info.channels !== 4) {
      console.warn('[watermark] expected 4 channels after ensureAlpha, got', info.channels);
      return payload;
    }

    const raw = Buffer.from(data);
    for (let i = 3; i < raw.length; i += 4) {
      raw[i] = Math.min(255, Math.round(raw[i] * WM_ALPHA_SCALE));
    }

    let wmOverlay = await sharp(raw, {
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

    const composited = basePipeline.clone().composite([{ input: wmOverlay, left, top }]);

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
