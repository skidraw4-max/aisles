/** I-084 (UI plan P3): cards, single table style, page header, empty state, one definition per selector. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import postcss, { type Rule } from 'postcss';

const DIR = path.join(process.cwd(), 'src/app/(jury)/jury');
const CSS = readFileSync(path.join(DIR, 'jury.module.css'), 'utf8');
const root = postcss.parse(CSS);
const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

function ctx(r: Rule): string {
  const p = r.parent;
  return p && p.type === 'atrule' ? `@${(p as postcss.AtRule).name} ${(p as postcss.AtRule).params}` : '';
}
function decls(selector: string, context = ''): Record<string, string> {
  const out: Record<string, string> = {};
  let count = 0;
  root.walkRules((r) => {
    if (ctx(r) !== context || !r.selectors.map(norm).includes(selector)) return;
    count += 1;
    r.walkDecls((d) => { out[d.prop] = d.value; });
  });
  assert.equal(count, 1, `${selector} must be defined exactly once`);
  return out;
}

test('every selector is defined exactly once per media/supports context', () => {
  const seen = new Map<string, number>();
  root.walkRules((r) => {
    const p = r.parent;
    if (p && p.type === 'atrule' && /keyframes/.test((p as postcss.AtRule).name)) return;
    for (const s of r.selectors) {
      const key = `${ctx(r)}|${norm(s)}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  });
  const dups = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  assert.deepEqual(dups, []);
  for (const s of ['.wrap', '.panel', '.table', '.notice', '.header', '.navWrap', '.navActive', '.metric', '.field']) {
    assert.ok(seen.has(`|${s}`), `${s} still defined`);
  }
});

test('cards: surface-1, 1px border, 12px radius, no shadow', () => {
  for (const s of ['.panel', '.adminCard']) {
    const d = decls(s);
    assert.equal(d.background, 'var(--jury-surface-1)', s);
    assert.equal(d.border, '1px solid var(--jury-border)', s);
    assert.equal(d['border-radius'], '12px', s);
    assert.equal(d['box-shadow'], 'none', s);
  }
});

test('table: one style with surface-2 header, 12px muted text, 44px rows, surface-3 hover', () => {
  const th = decls('.table th');
  assert.equal(th.background, 'var(--jury-surface-2)');
  assert.equal(th['font-size'], '12px');
  assert.equal(th.color, 'var(--jury-text-muted)');
  assert.equal(th.height, '44px');
  assert.equal(decls('.table td').height, '44px');
  assert.equal(decls('.table tbody tr:hover td').background, 'var(--jury-surface-3)');
  assert.equal(decls('.table td.num')['text-align'], 'right');
  assert.equal(decls('.table td.rowActions')['text-align'], 'right');
  assert.equal(decls('.iconButton').background, 'transparent');
  assert.equal(decls('.table td', '@media (max-width: 480px)').height, 'auto');
});

test('deleted-view (I-080/I-081) services table keeps its own palette', () => {
  assert.match(CSS, /--svc-body: #16213a/);
  assert.equal(decls('.servicesTableWrap .table.servicesTable tbody tr:hover td').background, 'var(--svc-hover, rgba(255,255,255,0.04))');
});

test('page header: 24px title, breadcrumb, actions on the right', () => {
  assert.equal(decls('.pageTitle')['font-size'], '24px');
  assert.equal(decls('.pageHeaderActions')['justify-content'], 'flex-end');
  assert.equal(decls('.pageIntro')['justify-content'], 'space-between');
  const tsx = readFileSync(path.join(DIR, 'page-layout.tsx'), 'utf8');
  assert.match(tsx, /aria-label="현재 위치"/);
  assert.match(tsx, /styles\.breadcrumb/);
  const ui = readFileSync(path.join(DIR, 'ui.tsx'), 'utf8');
  assert.ok((ui.match(/<PageHeader/g) ?? []).length >= 6);
  assert.doesNotMatch(ui, /<p>\{displayText\(SHELL_EMPTY\./);
  // I-100: the services empty state moved into the single list (service-operations-ui.tsx).
  const ops = readFileSync(path.join(DIR, 'service-operations-ui.tsx'), 'utf8');
  assert.ok(((ui + ops).match(/<EmptyState/g) ?? []).length >= 6);
});

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function token(name: string): string {
  const m = CSS.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(m, name);
  return m[1];
}
test('AA contrast: muted header text on surface-2/surface-3', () => {
  const fg = lum(token('--jury-text-muted'));
  for (const bg of ['--jury-surface-1', '--jury-surface-2', '--jury-surface-3']) {
    const b = lum(token(bg));
    const ratio = (Math.max(fg, b) + 0.05) / (Math.min(fg, b) + 0.05);
    assert.ok(ratio >= 4.5, `${bg} ratio ${ratio.toFixed(2)}`);
  }
});
