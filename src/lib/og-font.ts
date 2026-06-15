import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

let cachedFont: ArrayBuffer | null | undefined;

/** Satori용 Pretendard Bold — WOFF2 미지원, OTF만 사용 */
export async function loadOgFontData(): Promise<ArrayBuffer | null> {
  if (cachedFont !== undefined) return cachedFont;
  try {
    const buf = await readFile(join(process.cwd(), 'public/fonts/Pretendard-Bold.otf'));
    cachedFont = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return cachedFont;
  } catch {
    cachedFont = null;
    return null;
  }
}
