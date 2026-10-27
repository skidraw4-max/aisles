import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { statusTone, STATUS_TONES } from '@/lib/jury-product/status-tone';
import { userLabel } from '@/lib/jury-product/ui-labels';

const css = readFileSync('src/app/(jury)/jury/jury.module.css', 'utf8');

function hex(name: string): string {
  const m = [...css.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`, 'g'))].at(-1);
  assert.ok(m, name);
  return m[1];
}
function lum(h: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** Badge background is the status color at 14% over the page surface. */
function mix(fg: string, bg: string, a: number): string {
  return '#' + [1, 3, 5].map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16) * a + parseInt(bg.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, '0')).join('');
}

test('I-083 status colors are AA on every surface, including their own 14% tint', () => {
  for (const s of ['pass', 'fail', 'partial', 'blocked', 'error', 'running', 'neutral']) {
    const fg = hex(`jury-st-${s}`);
    for (const surface of ['jury-bg', 'jury-surface-1', 'jury-surface-2', 'jury-surface-3']) {
      const bg = hex(surface);
      assert.ok(ratio(fg, mix(fg, bg, 0.14)) >= 4.5, `${s} on ${surface} tint`);
    }
  }
  assert.ok(ratio(hex('jury-bg'), hex('jury-accent')) >= 4.5, 'primary label on accent');
  assert.ok(ratio(hex('jury-danger'), hex('jury-surface-1')) >= 4.5, 'danger on surface');
});

test('I-083 status codes map to one palette', () => {
  assert.equal(statusTone('PASS'), 'pass');
  assert.equal(statusTone('FAIL'), 'fail');
  assert.equal(statusTone('PARTIAL'), 'partial');
  assert.equal(statusTone('BLOCKED'), 'blocked');
  assert.equal(statusTone('ERROR'), 'error');
  assert.equal(statusTone('NOT_TESTED'), 'neutral');
  assert.equal(statusTone('RUNNING'), 'running');
  assert.equal(statusTone('DELETED'), 'deleted');
  assert.equal(statusTone('CONNECTED'), 'pass');
  assert.equal(statusTone('DISCONNECTED'), 'deleted');
  assert.equal(statusTone(null, '일부 확인'), 'partial');
  assert.equal(statusTone(null, userLabel('BLOCKED')), 'blocked');
  assert.equal(statusTone('SOMETHING_NEW'), 'info');
  assert.equal(STATUS_TONES.length, 9);
});

test('I-083 Button/StatusBadge contract (source; CSS modules are not loadable under tsx)', () => {
  const src = readFileSync('src/app/(jury)/jury/jury-controls.tsx', 'utf8');
  for (const v of ['primary', 'secondary', 'ghost', 'danger']) assert.match(src, new RegExp(`${v}:`));
  assert.match(src, /saveState/);
  assert.match(src, /LoaderCircle/);
  assert.match(src, /저장됨/);
  assert.match(src, /aria-live/);
  assert.match(src, /data-tone/);
  assert.match(src, /aria-hidden/);
  assert.match(src, /statusTone\(/);
});

test('I-083 Jury screens no longer use the old badge/button classes', () => {
  const files = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(p) && !/\.test\./.test(p) ? [p] : []; });
  const old = /styles\.(badge|badgeWarn|statusBadge|serviceTabBadge\w*|button|primaryButton|secondaryButton|outlineButton|dangerButton|bigButton|copyButton|summaryButton)\b/;
  const offenders = files('src/app/(jury)').filter((f) => old.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
});
