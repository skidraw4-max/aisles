/**
 * Builds 1024×1024 icon and 2732×2732 splash from repo public/ assets.
 * Source: public/watermark.png — trim margins, extract centered A mark for icon.
 * Android adaptive icons mask ~17% of edges; foreground stays in central ~66% safe zone.
 * Run: cd mobile && npm run assets:generate
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
const BRAND_ACCENT = '#a78bfa';
const ICON_SIZE = 1024;
const SPLASH_SIZE = 2732;
/** Adaptive-icon safe zone: mark fits in central ~52% (≈20% padding per side). */
const ICON_MARK_RATIO = 0.52;
/** Splash logo width as fraction of canvas (portrait/landscape crops keep center safe). */
const SPLASH_LOGO_RATIO = 0.42;

async function loadTrimmedWatermark() {
  return sharp(watermarkPath).trim().png().toBuffer();
}

/** Left portion of trimmed watermark — stylized A mark only. */
async function extractAMark(trimmedBuf) {
  const meta = await sharp(trimmedBuf).metadata();
  const sliceWidth = Math.min(Math.round(meta.width * 0.3), 220);
  return sharp(trimmedBuf)
    .extract({ left: 0, top: 0, width: sliceWidth, height: meta.height })
    .trim()
    .png()
    .toBuffer();
}

function brandBackgroundSvg(size) {
  return Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="50%" cy="42%" r="50%">
      <stop offset="0%" stop-color="${BRAND_ACCENT}" stop-opacity="0.14"/>
      <stop offset="70%" stop-color="${BRAND_BG}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${BRAND_BG}" stop-opacity="1"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="${BRAND_BG}"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
</svg>`);
}

async function buildIcon(aMarkBuf) {
  const markMeta = await sharp(aMarkBuf).metadata();
  const maxSide = Math.round(ICON_SIZE * ICON_MARK_RATIO);
  const scale = maxSide / Math.max(markMeta.width, markMeta.height);
  const markW = Math.round(markMeta.width * scale);
  const markH = Math.round(markMeta.height * scale);

  const mark = await sharp(aMarkBuf)
    .resize(markW, markH, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const left = Math.round((ICON_SIZE - markW) / 2);
  const top = Math.round((ICON_SIZE - markH) / 2);

  return sharp({
    create: {
      width: ICON_SIZE,
      height: ICON_SIZE,
      channels: 4,
      background: BRAND_BG,
    },
  })
    .composite([{ input: mark, left, top }])
    .png()
    .toBuffer();
}

async function buildSplash(trimmedBuf) {
  const bg = await sharp(brandBackgroundSvg(SPLASH_SIZE)).png().toBuffer();
  const logoMaxW = Math.round(SPLASH_SIZE * SPLASH_LOGO_RATIO);
  const logo = await sharp(trimmedBuf)
    .resize(logoMaxW, null, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const logoMeta = await sharp(logo).metadata();
  const left = Math.round((SPLASH_SIZE - logoMeta.width) / 2);
  const top = Math.round((SPLASH_SIZE - logoMeta.height) / 2);

  return sharp(bg)
    .composite([{ input: logo, left, top }])
    .png()
    .toBuffer();
}

async function main() {
  const trimmed = await loadTrimmedWatermark();
  const aMark = await extractAMark(trimmed);
  const icon = await buildIcon(aMark);
  const splash = await buildSplash(trimmed);

  await mkdir(assetsDir, { recursive: true });
  await writeFile(path.join(assetsDir, 'icon.png'), icon);
  await writeFile(path.join(assetsDir, 'splash.png'), splash);

  console.log(`Wrote ${assetsDir}/icon.png (${ICON_SIZE}², mark ${ICON_MARK_RATIO * 100}% safe zone)`);
  console.log(`Wrote ${assetsDir}/splash.png (${SPLASH_SIZE}², logo ${SPLASH_LOGO_RATIO * 100}% width)`);
  console.log('Next: npx capacitor-assets generate --android');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
