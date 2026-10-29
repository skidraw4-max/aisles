import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DASHBOARD_STAT_HREFS, dashboardStatAriaLabel } from './dashboard-stat-hrefs';

test('dashboard stat cards link to product nav screens', () => {
  assert.equal(DASHBOARD_STAT_HREFS.connectedServices, '/services');
  assert.equal(DASHBOARD_STAT_HREFS.evidence, '/evidence');
  assert.equal(DASHBOARD_STAT_HREFS.inFlightReviews, '/reviews');
  assert.equal(DASHBOARD_STAT_HREFS.openImprovements, '/improvements');
});

test('dashboard stat aria labels describe count and destination', () => {
  assert.equal(
    dashboardStatAriaLabel('connectedServices', '2', '연결된 서비스'),
    '연결된 서비스 2개, 서비스 목록으로 이동',
  );
  assert.equal(
    dashboardStatAriaLabel('evidence', '집계 불가', '심사 근거'),
    '심사 근거 집계 불가, 심사 요청으로 이동',
  );
});

test('home dashboard uses stat card links for all four KPIs', () => {
  const ui = readFileSync('src/app/(jury)/jury/ui.tsx', 'utf8');
  const home = ui.slice(ui.indexOf('export function DashboardBody('), ui.indexOf('export function DiscoveryBody('));
  assert.match(home, /DashboardStatCard/);
  assert.match(home, /kind="connectedServices"/);
  assert.match(home, /kind="evidence"/);
  assert.match(home, /kind="inFlightReviews"/);
  assert.match(home, /kind="openImprovements"/);
  assert.match(ui, /function DashboardStatCard/);
  assert.match(ui, /styles\.statCardHit/);
});
