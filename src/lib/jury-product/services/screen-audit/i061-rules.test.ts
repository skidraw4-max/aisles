import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LayoutMetrics } from './layout-probe';
import { analyzePage, summarizeAudit } from './rules';

const clean = (w: number): LayoutMetrics => ({ viewportWidth: w, viewportHeight: 800, docWidth: w, docHeight: 1500, overflowBoxes: [], clippedBoxes: [], interactive: [{ x: 0, y: 0, w: 100, h: 44 }], lowContrast: [{ ratio: 6, large: false, box: { x: 0, y: 0, w: 10, h: 10 } }], textSamples: 20, navVisible: true, searchVisible: true, headings: 3 });

test('clean page has no findings; a 4.5–7 contrast sample is not a failure', () => {
  assert.deepEqual(analyzePage('/a', 'MOBILE', clean(390)), []);
});

test('mobile overflow, small/overlapping targets and low contrast are found with boxes', () => {
  const m: LayoutMetrics = { ...clean(390), docWidth: 520, overflowBoxes: [{ x: 300, y: 0, w: 220, h: 40 }],
    interactive: [{ x: 0, y: 0, w: 16, h: 16 }, { x: 10, y: 5, w: 40, h: 30 }],
    lowContrast: [{ ratio: 2.1, large: false, box: { x: 1, y: 1, w: 50, h: 12 } }, { ratio: 3.5, large: true, box: { x: 1, y: 1, w: 50, h: 30 } }] };
  const rules = analyzePage('/a', 'MOBILE', m).map((f) => [f.rule, f.severity, f.status]);
  assert.deepEqual(rules, [['LAYOUT_HORIZONTAL_OVERFLOW', 'HIGH', 'FAIL'], ['TAP_TARGET_SMALL', 'LOW', 'WARN'], ['TAP_TARGET_OVERLAP', 'MEDIUM', 'FAIL'], ['CONTRAST_LOW', 'LOW', 'FAIL']]);
  assert.ok(analyzePage('/a', 'MOBILE', m)[0].boxes.length > 0);
});

test('summary: never PASS without measurement; blocked and not-tested pages are explicit', () => {
  const s = summarizeAudit([
    { path: '/a', label: 'a', viewport: 'DESKTOP', status: 'PASS', metrics: clean(1366) },
    { path: '/b', label: 'b', viewport: 'DESKTOP', status: 'NOT_TESTED', reason: 'BUDGET' },
    { path: '/mypage', label: 'm', viewport: 'MOBILE', status: 'BLOCKED', reason: 'SENSITIVE_PATH' },
  ]);
  const get = (area: string, vp: string) => s.areas.find((a) => a.area === area && a.viewport === vp)?.status;
  assert.equal(get('LAYOUT', 'DESKTOP'), 'PARTIAL');
  assert.equal(get('MOBILE', 'DESKTOP'), undefined);
  assert.equal(get('MOBILE', 'MOBILE'), 'BLOCKED');
  assert.equal(s.status, 'PARTIAL');
  assert.equal(summarizeAudit([]).status, 'NOT_TESTED');
  const full = summarizeAudit([{ path: '/a', label: 'a', viewport: 'MOBILE', status: 'PASS', metrics: { ...clean(390), docWidth: 600 } }]);
  assert.equal(full.status, 'FAIL');
});
