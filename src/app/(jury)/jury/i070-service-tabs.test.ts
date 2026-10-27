/** I-070: service detail tab bar (own sticky bar, button tabs, badges, a11y, no empty card). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { serviceTabBadges, serviceTabHref, type ServiceTabBadgeInput } from './service-detail-tabs-model';

const DIR = 'src/app/(jury)/jury';
const read = (f: string) => readFileSync(`${DIR}/${f}`, 'utf8');

const base: ServiceTabBadgeInput = {
  connectionStatus: 'CONNECTED',
  onboarding: { discovery: 'COMPLETE' },
  evidence: { empty: false, evidenceItemCount: 7 },
  review: { empty: false },
  improvement: { openCount: 0 },
  activity: [1, 2, 3],
};

test('badges come from already-loaded model data', () => {
  const b = serviceTabBadges(base);
  assert.deepEqual(b.connect, { text: '✓', tone: 'ok' });
  assert.deepEqual(b.results, { text: '7건', tone: 'ok' });
  assert.deepEqual(b.review, { text: '✓', tone: 'ok' });
  assert.deepEqual(b.history, { text: '3', tone: 'muted' });
  assert.equal(b.overview, undefined);
});

test('connect needs attention until observation succeeds or discovery completes', () => {
  assert.equal(serviceTabBadges(base, true).connect?.text, '필요');
  assert.equal(serviceTabBadges({ ...base, onboarding: { discovery: 'NOT_STARTED' } }).connect?.text, '필요');
  assert.equal(serviceTabBadges({ ...base, connectionStatus: 'DRAFT' }).connect?.tone, 'warn');
});

test('results/review/history badge edge cases', () => {
  const b = serviceTabBadges({ ...base, evidence: { empty: true, evidenceItemCount: 0 }, review: { empty: true }, activity: [] });
  assert.equal(b.results?.text, '없음');
  assert.equal(b.review, undefined);
  assert.equal(b.history, undefined);
  assert.equal(serviceTabBadges({ ...base, review: { empty: true, running: true } }).review?.text, '진행 중');
  assert.equal(serviceTabBadges({ ...base, improvement: { openCount: 2 } }).review?.text, '개선 2');
});

test('?tab= URLs unchanged', () => {
  assert.doesNotMatch(serviceTabHref('c1', 'overview'), /tab=/);
  assert.match(serviceTabHref('c1', 'screen'), /\?tab=screen$/);
});

test('tab nav keeps tablist/tab/aria-selected and scrolls active tab into view', () => {
  const src = read('service-detail-tabs.tsx');
  assert.match(src, /role="tablist"/);
  assert.match(src, /role="tab"/);
  assert.match(src, /aria-selected=\{selected\}/);
  assert.match(src, /ServiceTabScroll/);
  assert.match(read('service-tab-scroll.tsx'), /scrollLeft/);
});

test('tab bar is sticky, horizontally scrollable, button style', () => {
  const css = read('jury.module.css');
  const bar = css.slice(css.indexOf('.serviceTabBar {'));
  assert.match(bar.slice(0, 200), /position: sticky/);
  const tabs = css.slice(css.indexOf('.serviceTabs {', css.indexOf('I-070')));
  assert.match(tabs.slice(0, 250), /overflow-x: auto/);
  assert.match(tabs.slice(0, 250), /flex-wrap: nowrap/);
  const active = css.slice(css.indexOf('.serviceTabActive,'));
  // I-083/I-084: active tab uses the single accent fill.
  assert.match(active.slice(0, 250), /background: var\(--jury-accent\)/);
});

test('page: tabs outside the summary card, 다음 할 일 in 개요, no empty card on 화면 심사', () => {
  const page = read('services/[connectionId]/page.tsx');
  assert.match(page, /<ServiceSummaryHeader [^>]*\/>/);
  assert.match(page, /tab === 'overview' \? <ServiceNextActionPanel/);
  assert.match(page, /tab !== 'screen' \? <ServiceOperationDetail/);
  const ui = read('service-operations-ui.tsx');
  const header = ui.slice(ui.indexOf('export function ServiceSummaryHeader'), ui.indexOf('export function ServiceNextActionPanel'));
  assert.doesNotMatch(header, /<NextAction/);
});
