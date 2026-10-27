import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import postcss from 'postcss';
import { SERVICE_TABS, visibleServiceTabs } from './service-detail-tabs-model';

const dir = join(process.cwd(), 'src/app/(jury)/jury');
const read = (f: string) => readFileSync(join(dir, f), 'utf8');
const css = read('jury.module.css');
const root = postcss.parse(css);

function rule(selector: string): Record<string, string> {
  const found: postcss.Rule[] = [];
  root.walkRules((r) => {
    if (r.parent?.type === 'root' && r.selector.replace(/\s+/g, ' ') === selector) found.push(r);
  });
  assert.equal(found.length, 1, `${selector} defined once`);
  const out: Record<string, string> = {};
  found[0].walkDecls((d) => { out[d.prop] = d.value; });
  return out;
}

function lum(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test('nav: surface-1 band, icon links, active = 3px left accent + bold (no pill)', () => {
  assert.match(rule('.navWrap').background, /--jury-surface-1/);
  const a = rule('.nav a');
  assert.equal(a.display, 'inline-flex');
  assert.equal(a['border-left'], '3px solid transparent');
  const active = rule('.navActive');
  assert.match(active['border-left-color'], /--jury-accent/);
  assert.equal(active['font-weight'], '800');
  assert.ok(!JSON.stringify(active).includes('!important'));
  assert.ok(!active['border-radius']);
  const shell = read('shell-client.tsx');
  assert.match(shell, /from 'lucide-react'/);
  assert.match(shell, /<Icon size=\{16\} aria-hidden="true" \/>/);
});

test('tabs: one segTabs pattern (underline + accent text), count badge, old tab classes gone', () => {
  const active = rule('.segTab.segTabActive');
  assert.match(active.color, /--jury-accent/);
  assert.match(active['border-bottom-color'], /--jury-accent/);
  assert.equal(rule('.segTab')['border-bottom'], '2px solid transparent');
  assert.ok(rule('.segTabCount')['border-radius']);
  for (const old of ['.tabActive', '.serviceTabActive', '.serviceTab {', '.tabs {']) assert.ok(!css.includes(old), old);
  assert.match(read('ui-primitives.tsx'), /styles\.segTabs/);
  assert.match(read('service-detail-tabs.tsx'), /styles\.segTabActive/);
  assert.match(read('service-operations-ui.tsx'), /styles\.segTabCount/);
});

test('tabs: unavailable areas are hidden unless active', () => {
  assert.deepEqual(visibleServiceTabs(['screen'], 'overview').map((t) => t.key), SERVICE_TABS.map((t) => t.key).filter((k) => k !== 'screen'));
  assert.ok(visibleServiceTabs(['screen'], 'screen').some((t) => t.key === 'screen'));
  assert.equal(visibleServiceTabs([], 'overview').length, SERVICE_TABS.length);
  assert.match(read('services/[connectionId]/page.tsx'), /shouldShowReadonlyAccountSection\(\{ uiEnabled: READONLY_ACCOUNT_UI_ENABLED, accessMethod \}\) \? \[\] : \['screen'\]/);
});

test('forms: surface-2 inputs, 2px accent focus ring, 13px labels, fail-colored errors, dark autofill', () => {
  const field = rule('.field');
  assert.match(field.background, /--jury-surface-2/);
  assert.match(field.border, /^1px solid/);
  assert.match(rule('.field:focus').outline, /^2px solid var\(--jury-accent/);
  const inputs = rule('.wrap input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="submit"]), .wrap select, .wrap textarea');
  assert.match(inputs.background, /--jury-surface-2/);
  assert.match(rule('.wrap input:focus-visible, .wrap select:focus-visible, .wrap textarea:focus-visible').outline, /^2px solid var\(--jury-accent/);
  const auto = rule('.wrap input:-webkit-autofill, .wrap input:-webkit-autofill:hover, .wrap input:-webkit-autofill:focus');
  assert.match(auto['-webkit-box-shadow'], /--jury-surface-2.*inset/);
  assert.match(auto['-webkit-text-fill-color'], /--jury-text/);
  assert.equal(rule('.fieldError, .wrap form p[role="alert"]').color, 'var(--jury-st-fail, #fc8d8d)');
  assert.equal(rule('.fieldHelp')['font-size'], '13px');
  assert.match(css, /\.wrap label:has\(> select\)/);
});

test('AA contrast for form/nav/tab text', () => {
  const s2 = '#132238', s1 = '#0e1a2c';
  for (const [fg, bg] of [['#eef4ff', s2], ['#d7dee8', s2], ['#a8b5c9', s2], ['#fc8d8d', s1], ['#fc8d8d', s2], ['#72c7f3', s1], ['#a8b5c9', s1], ['#f5f7ff', s2]]) assert.ok(ratio(fg, bg) >= 4.5, `${fg} on ${bg}`);
  assert.ok(ratio('#6b7c95', s2) >= 3, 'input border meets 3:1 non-text contrast');
  assert.match(rule('.field').border, /#6b7c95/);
});
