/**
 * Builds 1024×1024 icon and splash from repo public/ assets.
 * Source: public/watermark.png (stylized "A" mark) on brand dark background.
 * Run from repo root: node mobile/scripts/generate-brand-assets.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const assetsDir = path.resolve(__dirname, '../assets');
const watermarkPath = path.join(repoRoot, 'public', 'watermark.png');

const BRAND_BG = '#0b0d17';
const ICON_SIZE = 1024;
const SPLASH_SIZE = 2732;

async function main() {
  const watermark = sharp(watermarkPath);
  const meta = await watermark.metadata();
  const cropSize = Math.min(meta.height ?? 249, Math.round((meta.width ?? 1003) * 0.28));

  const iconMark = await sharp(watermarkPath)
    .extract({ left: 0, top: 0, width: cropSize, height: cropSize })
    .resize(Math.round(ICON_SIZE * 0.62), Math.round(ICON_SIZE * 0.62), {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const icon = await sharp({
    create: {
      width: ICON_SIZE,
      height: ICON_SIZE,
      channels: 4,
      background: BRAND_BG,
    },
  })
    .composite([{ input: iconMark, gravity: 'center' }])
    .png()
    .toBuffer();

  const logo = await sharp(watermarkPath)
    .resize(Math.round(SPLASH_SIZE * 0.55), null, { fit: 'inside' })
    .png()
    .toBuffer();

  const splash = await sharp({
    create: {
      width: SPLASH_SIZE,
      height: SPLASH_SIZE,
      channels: 4,
      background: BRAND_BG,
    },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toBuffer();

  await mkdir(assetsDir, { recursive: true });
  await writeFile(path.join(assetsDir, 'icon.png'), icon);
  await writeFile(path.join(assetsDir, 'splash.png'), splash);

  console.log(`Wrote ${assetsDir}/icon.png and splash.png (${BRAND_BG} background)`);
  console.log('Next: cd mobile && npx capacitor-assets generate --android');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
