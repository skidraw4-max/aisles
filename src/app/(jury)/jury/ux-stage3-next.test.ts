import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homeNextAction } from '@/lib/jury-product/home-next-action';

// UX Stage 3: one state-based primary next action, pointing only at implemented screens.
const base = { services: '2', connectedServices: '2', inFlightReviews: '0', reviews: '3', openImprovements: '0' };

test('home next action follows the current state', () => {
  assert.equal(homeNextAction({ ...base, services: '0' }).href, '/services/new');
  assert.equal(homeNextAction({ ...base, connectedServices: '0' }).href, '/services');
  assert.equal(homeNextAction({ ...base, inFlightReviews: '1' }).href, '/reviews');
  assert.equal(homeNextAction({ ...base, reviews: '0' }).label, '새로 심사하기');
  assert.equal(homeNextAction({ ...base, openImprovements: '4' }).href, '/improvements');
  assert.equal(homeNextAction(base).label, '결과 보기');
  assert.equal(homeNextAction({ ...base, services: '집계 불가' }).label, '결과 보기');
});

test('home has one primary button, source stats are collapsed, and no Mock re-review is a next action', () => {
  const ui = readFileSync('src/app/(jury)/jury/ui.tsx', 'utf8');
  const home = ui.slice(ui.indexOf('export function DashboardBody('), ui.indexOf('export function DiscoveryBody('));
  assert.equal((home.match(/variant="primary"/g) ?? []).length, 1);
  assert.match(home, /<summary>결과 출처 자세히 보기<\/summary>/);
  const detail = ui.slice(ui.indexOf('export function ReviewDetailBody('), ui.indexOf('export function ReReviewAgentHandoffBody('));
  assert.ok(!detail.includes('(Mock)'));
  assert.match(detail, /primaryNext === 'improvement' \? 'primary'/);
  assert.match(ui, /서비스에서 새로 심사하기/);
});
