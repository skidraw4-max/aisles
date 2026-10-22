/**
 * 빌드 시 ADS_TXT 환경 변수로 public/ads.txt 생성.
 * 정적 파일로 제공하면 AdSense·크롤러 호환성이 동적 라우트보다 안정적이다.
 */
const fs = require('fs');
const path = require('path');

const out = path.join(process.cwd(), 'public', 'ads.txt');
const raw = process.env.ADS_TXT?.trim();

if (!raw) {
  try {
    if (fs.existsSync(out)) {
      fs.unlinkSync(out);
    }
  } catch {
    /* ignore */
  }
  console.warn(
    '[ads.txt] ADS_TXT not set — public/ads.txt not written. ' +
      'Set ADS_TXT in Vercel Production and redeploy for AdSense.',
  );
  process.exit(0);
}

const body = raw.endsWith('\n') ? raw : `${raw}\n`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, body, 'utf8');
console.log('[ads.txt] wrote public/ads.txt from ADS_TXT');
