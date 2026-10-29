/**
 * AIsles Jury 사용자 매뉴얼 PDF 생성
 * node scripts/generate-jury-manual-pdf.mjs
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const PUBLIC_MANUAL = 'aisles-jury-user-manual-v1.1.pdf';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mdPath = join(root, 'docs', 'aisles-jury-user-manual.md');
const htmlPath = join(root, 'docs', 'aisles-jury-user-manual-print.html');
const pdfDocs = join(root, 'docs', 'aisles-jury-user-manual.pdf');
const pdfDownloads = join(process.env.USERPROFILE ?? '', 'Downloads', 'aisles-jury-user-manual.pdf');

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineMd(s) {
  let out = escapeHtml(s);
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return out;
}

/** @param {string} md */
function mdToBodyHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let skipTitleBlock = true;

  let openChapter = false;

  while (i < lines.length) {
    const line = lines[i];

    if (skipTitleBlock) {
      if (line.startsWith('## 이 매뉴얼')) {
        skipTitleBlock = false;
      } else {
        i++;
        continue;
      }
    }

    if (line.trim() === '---') {
      out.push('<hr class="sep"/>');
      i++;
      continue;
    }

    if (line.startsWith('## ')) {
      const title = line.slice(3).trim();
      const isMajor = /^0[1-8] /.test(title) || title.startsWith('부록');
      if (openChapter) {
        out.push('</section>');
        openChapter = false;
      }
      if (isMajor) {
        out.push('<section class="chapter">');
        openChapter = true;
      }
      out.push(`<h2 class="${isMajor ? 'chapter-title' : 'section-title'}">${inlineMd(title)}</h2>`);
      i++;
      continue;
    }

    if (line.startsWith('### ')) {
      out.push(`<h3>${inlineMd(line.slice(4))}</h3>`);
      i++;
      continue;
    }

    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        rows.push(lines[i]);
        i++;
      }
      const cells = rows
        .filter((r) => !/^\|[\s\-:|]+\|$/.test(r.replace(/\s/g, '')))
        .map((r) =>
          r
            .split('|')
            .slice(1, -1)
            .map((c) => inlineMd(c.trim())),
        );
      if (cells.length === 0) continue;
      out.push('<div class="table-wrap"><table>');
      cells.forEach((row, ri) => {
        const tag = ri === 0 ? 'th' : 'td';
        out.push(`<tr>${row.map((c) => `<${tag}>${c}</${tag}>`).join('')}</tr>`);
      });
      out.push('</table></div>');
      continue;
    }

    if (line.startsWith('> ')) {
      const parts = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        parts.push(lines[i].slice(2));
        i++;
      }
      out.push(`<blockquote class="callout">${inlineMd(parts.join(' '))}</blockquote>`);
      continue;
    }

    if (/^-\s/.test(line)) {
      out.push('<ul>');
      while (i < lines.length && /^-\s/.test(lines[i])) {
        out.push(`<li>${inlineMd(lines[i].replace(/^-\s/, ''))}</li>`);
        i++;
      }
      out.push('</ul>');
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      out.push('<ol>');
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        out.push(`<li>${inlineMd(lines[i].replace(/^\d+\.\s/, ''))}</li>`);
        i++;
      }
      out.push('</ol>');
      continue;
    }

    if (/^- \[ \]/.test(line)) {
      out.push('<ul class="checklist">');
      while (i < lines.length && /^- \[ \]/.test(lines[i])) {
        out.push(`<li>${inlineMd(lines[i].replace(/^- \[ \]\s/, ''))}</li>`);
        i++;
      }
      out.push('</ul>');
      continue;
    }

    if (line.startsWith('*') && line.endsWith('*') && !line.startsWith('**')) {
      out.push(`<p class="footer-note">${inlineMd(line.slice(1, -1))}</p>`);
      i++;
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    if (line.startsWith('**') && line.endsWith('**') && !line.slice(2).includes('**')) {
      out.push(`<p class="lead-label">${inlineMd(line.slice(2, -2))}</p>`);
      i++;
      continue;
    }

    out.push(`<p>${inlineMd(line)}</p>`);
    i++;
  }

  if (openChapter) out.push('</section>');
  return out.join('\n');
}

const PRINT_CSS = `
@page {
  size: A4;
  margin: 14mm 15mm 18mm 15mm;
}
@page :first {
  margin: 0;
}

* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

body {
  margin: 0;
  font-family: "Pretendard Variable", "Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", system-ui, sans-serif;
  font-size: 10.5pt;
  line-height: 1.62;
  color: #1e293b;
  background: #fff;
}

.cover {
  min-height: 297mm;
  padding: 22mm 20mm;
  background: linear-gradient(145deg, #0a1220 0%, #0e1a2c 42%, #132238 100%);
  color: #eef4ff;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  page-break-after: always;
  position: relative;
  overflow: hidden;
}
.cover::before {
  content: "";
  position: absolute;
  top: -20%;
  right: -10%;
  width: 55%;
  height: 55%;
  background: radial-gradient(circle, rgba(142, 231, 207, 0.14) 0%, transparent 68%);
  pointer-events: none;
}
.cover::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, #8ee7cf, #72c7f3, #8ee7cf);
}
.cover-eyebrow {
  font-size: 9pt;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #9fd0c8;
  margin: 0 0 12mm;
}
.cover-title {
  font-size: 32pt;
  font-weight: 750;
  letter-spacing: -0.02em;
  margin: 0 0 6mm;
  line-height: 1.15;
}
.cover-sub {
  font-size: 12pt;
  color: #b7c9de;
  max-width: 130mm;
  margin: 0 0 14mm;
  line-height: 1.55;
}
.cover-meta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3mm 8mm;
  font-size: 10pt;
  border: 1px solid rgba(159, 208, 200, 0.28);
  border-radius: 10px;
  padding: 6mm 7mm;
  background: rgba(19, 34, 56, 0.55);
  max-width: 95mm;
}
.cover-meta dt { color: #94a3b8; font-weight: 600; margin: 0; }
.cover-meta dd { margin: 0; color: #f1f5f9; }
.cover-foot {
  font-size: 8.5pt;
  color: #64748b;
  margin: 0;
}

.doc-body { padding: 0; }

.chapter {
  break-before: page;
  page-break-before: always;
  padding-top: 2mm;
}
.doc-body > .section-title:first-child,
.doc-body > p:first-child { margin-top: 0; }
.intro-block { margin-bottom: 4mm; }

.chapter-title {
  font-size: 17pt;
  font-weight: 750;
  color: #0f172a;
  margin: 0 0 5mm;
  padding: 0 0 3mm 4mm;
  border-left: 4px solid #8ee7cf;
  letter-spacing: -0.01em;
}
.section-title {
  font-size: 13pt;
  font-weight: 700;
  color: #0f172a;
  margin: 7mm 0 3mm;
}
h3 {
  font-size: 11pt;
  font-weight: 700;
  color: #334155;
  margin: 5mm 0 2mm;
}
p { margin: 0 0 3mm; }
.lead-label {
  font-weight: 700;
  color: #0f172a;
  margin: 4mm 0 2mm;
}

ul, ol { margin: 0 0 4mm; padding-left: 5mm; }
li { margin-bottom: 1.5mm; }
ul.checklist { list-style: none; padding-left: 0; }
ul.checklist li {
  padding-left: 6mm;
  position: relative;
}
ul.checklist li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.45em;
  width: 3.2mm;
  height: 3.2mm;
  border: 1.5px solid #64748b;
  border-radius: 1px;
}

.table-wrap { margin: 3mm 0 5mm; overflow: hidden; border-radius: 8px; border: 1px solid #e2e8f0; }
table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
th, td { padding: 2.8mm 3.5mm; text-align: left; vertical-align: top; border-bottom: 1px solid #e2e8f0; }
tr:last-child td, tr:last-child th { border-bottom: none; }
th { background: #f8fafc; color: #475569; font-weight: 700; }
td { background: #fff; }

blockquote.callout {
  margin: 4mm 0;
  padding: 3.5mm 4mm 3.5mm 4.5mm;
  border-left: 3px solid #72c7f3;
  background: #f0f9ff;
  color: #0c4a6e;
  border-radius: 0 8px 8px 0;
  font-size: 9.8pt;
}

hr.sep { border: none; border-top: 1px solid #e2e8f0; margin: 6mm 0; }

strong { color: #0f172a; font-weight: 700; }

.footer-note {
  margin-top: 8mm;
  padding-top: 4mm;
  border-top: 1px solid #e2e8f0;
  font-size: 9pt;
  color: #64748b;
  font-style: italic;
}

.doc-footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 8pt;
  color: #94a3b8;
  padding: 2mm;
}
`;

function buildHtml(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8"/>
  <title>AIsles Jury 사용자 매뉴얼 v1.1</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
  <section class="cover">
    <div>
      <p class="cover-eyebrow">AISLES STUDIO</p>
      <h1 class="cover-title">AIsles Jury</h1>
      <p class="cover-sub">가입부터 서비스 연결, 관찰, 화면 심사, 위원 심사, 결과·개선 관리까지 한 번에 따라 하는 실무 안내서</p>
      <dl class="cover-meta">
        <dt>버전</dt><dd>1.1</dd>
        <dt>기준</dt><dd>화면 기준 2026.10</dd>
        <dt>대상</dt><dd>Jury 작업 공간 이용자</dd>
      </dl>
    </div>
    <p class="cover-foot">홈 KPI · 제품 메뉴 · GitHub 연결 반영</p>
  </section>
  <main class="doc-body">
    ${bodyHtml}
  </main>
</body>
</html>`;
}

async function main() {
  const md = await readFile(mdPath, 'utf8');
  const bodyHtml = mdToBodyHtml(md);
  const html = buildHtml(bodyHtml);
  await writeFile(htmlPath, html, 'utf8');

  const playwrightRoots = [
    join(root, '..', 'Game', 'Cannonwar', 'node_modules', 'playwright'),
    join(root, 'node_modules', 'playwright'),
  ];
  let chromium;
  let lastErr;
  for (const pw of playwrightRoots) {
    try {
      ({ chromium } = await import(pathToFileURL(join(pw, 'index.mjs')).href));
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!chromium) throw lastErr ?? new Error('playwright not found');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
  const pdfOpts = {
    path: pdfDocs,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: '14mm', bottom: '16mm', left: '15mm', right: '15mm' },
  };
  await page.pdf({ ...pdfOpts, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="width:100%;text-align:center;font-size:8px;color:#94a3b8;font-family:sans-serif;padding-top:4px"><span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
  await copyFile(pdfDocs, pdfDownloads);
  const publicDir = join(root, 'public', 'jury', 'manual');
  await mkdir(publicDir, { recursive: true });
  const publicPdf = join(publicDir, PUBLIC_MANUAL);
  await copyFile(pdfDocs, publicPdf);
  await browser.close();

  console.log('HTML:', htmlPath);
  console.log('PDF:', pdfDocs);
  console.log('PDF:', pdfDownloads);
  console.log('Public:', publicPdf);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
