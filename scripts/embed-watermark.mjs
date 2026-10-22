/**
 * public/watermark.png 변경 후 실행: node scripts/embed-watermark.mjs
 * → src/lib/watermark-embedded.ts 갱신
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const wmPath = path.join(root, 'public', 'watermark.png');
const outPath = path.join(root, 'src', 'lib', 'watermark-embedded.ts');

const buf = fs.readFileSync(wmPath);
const b64 = buf.toString('base64');
const head = buf.subarray(0, 3);
const kind =
  head[0] === 0xff && head[1] === 0xd8
    ? 'JPEG'
    : head[0] === 0x89 && head[1] === 0x50
      ? 'PNG'
      : 'binary';

const ts = `/** Auto: \`public/watermark.png\` (${kind}) base64 — 서버리스에서 fs 없이 로드. 에셋 바꾼 뒤 \`node scripts/embed-watermark.mjs\` */
export const WATERMARK_PNG_BASE64 = "${b64}";
`;
fs.writeFileSync(outPath, ts, 'utf8');
console.log('Wrote', outPath, `(${buf.length} bytes, ${kind})`);
