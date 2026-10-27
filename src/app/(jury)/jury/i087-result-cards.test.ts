import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import postcss from 'postcss';

const read = (f: string) => readFileSync(join(process.cwd(), 'src/app/(jury)/jury', f), 'utf8');
const css = postcss.parse(read('jury.module.css'));
const decls = (selector: string) => {
  const out: Record<string, string> = {};
  css.walkRules((r) => { if (r.selector === selector) r.walkDecls((d) => { out[d.prop] = d.value; }); });
  return out;
};

function lum(hex: string) {
  const v = hex.replace('#', '').match(/../g)!.map((h) => parseInt(h, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('result card: surface-1, 24px padding, 16px gap', () => {
  const d = decls('.resultCard');
  assert.equal(d.padding, '24px');
  assert.match(d.background, /--jury-surface-1/);
  assert.equal(d.gap, '16px');
  assert.match(decls('.resultCardHeader')['justify-content'], /space-between/);
  assert.equal(decls('.resultList').gap, '8px');
});

test('result table: 44px rows, 16px cell padding, right-aligned numbers, header surface', () => {
  const cell = decls('.resultTable th, .resultTable td');
  assert.equal(cell.height, '44px');
  assert.equal(cell.padding, '8px 16px');
  assert.equal(decls('.resultTable th.num, .resultTable td.num')['text-align'], 'right');
  assert.match(decls('.resultTable thead th').background, /--jury-surface-2/);
});

test('screen audit section uses the card, primary icon button and status badge heading', () => {
  const s = read('screen-audit-section.tsx');
  assert.match(s, /className=\{styles\.resultCard\} aria-labelledby="screen-audit-title"/);
  assert.match(s, /<div className=\{styles\.resultCardHeader\}>\s*<h2 id="screen-audit-title">화면 심사<\/h2>\s*<ScreenAuditRunButton[^>]*variant="primary" icon=\{latest \? 'refresh' : 'play'\}/);
  assert.match(s, /<h3 className=\{styles\.resultSubhead\}>\s*최근 심사\s*<span className=\{styles\.resultMeta\}>/);
  assert.match(s, /<StatusBadge status=\{latest\.status/);
  assert.match(s, /<table className=\{styles\.resultTable\}>/);
  assert.match(s, /<th scope="col" className=\{styles\.num\}>발견<\/th>/);
  assert.match(s, /<ul className=\{styles\.findingList\}>/);
  assert.doesNotMatch(s, /<table>|<ul>|#ddd/);
  const b = read('ScreenAuditRunButton.tsx');
  assert.match(b, /<Button type="submit" variant=\{props\.variant \?\? 'primary'\} icon=/);
  assert.match(b, /refresh: RefreshCw/);
});

test('other result tabs and admin screens use the unified card/header', () => {
  assert.match(read('service-operations-ui.tsx'), /<section className=\{styles\.resultCard\}>/);
  assert.match(read('readonly-account-section.tsx'), /styles\.resultCard\} aria-label="읽기 전용 관찰 결과"/);
  assert.doesNotMatch(read('operations/page.tsx'), /styles\.panel|<ul>/);
  for (const p of ['members', 'services', 'security']) assert.match(read(`organization/${p}/page.tsx`), /<PageHeader/);
  assert.match(read('organization/members/page.tsx'), /<ButtonLink variant="primary" icon=\{UserPlus\}/);
});

test('AA contrast for result text on surfaces', () => {
  for (const bg of ['#0e1a2c', '#132238']) {
    assert.ok(ratio('#a8b5c9', bg) >= 4.5, `muted on ${bg}`);
    assert.ok(ratio('#d7dee8', bg) >= 4.5, `soft on ${bg}`);
  }
});
