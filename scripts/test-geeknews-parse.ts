/**
 * GeekNews `/new` HTML 파서 스모크 테스트.
 * Usage: npx tsx scripts/test-geeknews-parse.ts [html-file]
 * 기본: 프로젝트 루트의 tmp-geeknews.html (없으면 live fetch)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { parseGeekNewsNewListHtml } from '../src/lib/geeknews/parse-list';

const GEEKNEWS_NEW_URL = 'https://news.hada.io/new';
const htmlPath = process.argv[2] ?? 'tmp-geeknews.html';

async function loadHtml(): Promise<string> {
  if (existsSync(htmlPath)) {
    return readFileSync(htmlPath, 'utf8');
  }
  console.log(`[test] ${htmlPath} 없음 — live fetch: ${GEEKNEWS_NEW_URL}`);
  const res = await fetch(GEEKNEWS_NEW_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AIsle-GeekNews/1.0)',
      Accept: 'text/html,*/*',
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const html = await res.text();
  writeFileSync(htmlPath, html, 'utf8');
  return html;
}

async function main() {
  const html = await loadHtml();
  const items = parseGeekNewsNewListHtml(html);
  console.log(`[test] 파싱 ${items.length}건`);
  if (items.length === 0) {
    console.error('[test] FAIL: EMPTY_PARSE');
    process.exit(1);
  }
  const first = items[0]!;
  if (!first.title || !first.externalUrl || !first.topicId) {
    console.error('[test] FAIL: invalid first item', first);
    process.exit(1);
  }
  console.log('[test] PASS — first:', {
    topicId: first.topicId,
    title: first.title.slice(0, 60),
    externalUrl: first.externalUrl,
  });
}

main().catch((e) => {
  console.error('[test] FAIL:', e);
  process.exit(1);
});
