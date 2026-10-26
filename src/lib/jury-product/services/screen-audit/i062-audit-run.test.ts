import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JuryActor } from '../../access';
import type { ObservationDriver } from '../readonly-account/executor';
import type { ObservationRunStore } from '../readonly-account/observation-run';
import { buildAuditRows, runScreenAudit, type ScreenAuditStore } from './audit-run';
import type { LayoutMetrics } from './layout-probe';

const m = (w: number, docWidth = w): LayoutMetrics => ({ viewportWidth: w, viewportHeight: 800, docWidth, docHeight: 1000, overflowBoxes: [], clippedBoxes: [], interactive: [], lowContrast: [], textSamples: 1, navVisible: true, searchVisible: false, headings: 1 });

test('rows: one test case per area×viewport, findings linked to page and masked screenshot, 14-day expiry', () => {
  let n = 0;
  const { rows, summary } = buildAuditRows([
    { path: '/a', label: 'a', viewport: 'DESKTOP', status: 'PASS', metrics: m(1366) },
    { path: '/a', label: 'a', viewport: 'MOBILE', status: 'PASS', metrics: m(390, 500), capture: { storageKey: 't/a/x.jpg', sha256: 'x', byteSize: 1, width: 390, height: 844, masked: true, maskedCount: 2 } },
    { path: '/mypage', label: 'm', viewport: 'MOBILE', status: 'BLOCKED', reason: 'SENSITIVE_PATH' },
  ], new Date(0), () => `id${++n}`);
  assert.deepEqual(rows.testCases.map((c) => `${c.area}/${c.viewport}=${c.result.status}`), ['LAYOUT/DESKTOP=PASS', 'A11Y/DESKTOP=PASS', 'NAVIGATION/DESKTOP=PASS', 'LAYOUT/MOBILE=PASS', 'MOBILE/MOBILE=FAIL', 'A11Y/MOBILE=PASS', 'NAVIGATION/MOBILE=PASS']);
  assert.equal(rows.findings.length, 1);
  assert.equal(rows.findings[0].pageId, rows.pages[1].id);
  assert.deepEqual(rows.findings[0].evidenceIds, [rows.evidence[0].id]);
  assert.equal(rows.evidence[0].expiresAt.toISOString(), '1970-01-15T00:00:00.000Z');
  assert.deepEqual(rows.pages[2].metrics, { reason: 'SENSITIVE_PATH' });
  assert.equal(summary.status, 'FAIL');
});

const actor = { ok: true, tenantId: 't1', userId: 'u1', role: 'OWNER' } as unknown as JuryActor;
const driver = { async close() {} } as unknown as ObservationDriver;
function stores(connection: boolean) {
  const calls: string[] = [];
  const obs = {
    async findConnection() { return connection ? { id: 'c1', tenantId: 't1', serviceKey: 'readonly-account', accessMethod: 'READ_ONLY_ACCOUNT' } : null; },
    async findLatestConsent() { return null; },
    async findActiveCredential() { return null; },
    async audit() { calls.push('audit'); },
  } as ObservationRunStore;
  const audit: ScreenAuditStore = {
    async createAudit(a) { calls.push(`create:${a.aiEnabled}:${a.viewports.join(',')}`); },
    async finishAudit(a) { calls.push(`finish:${a.state}:${a.status}`); },
    async findAudit() { return null; },
  };
  return { obs, audit, calls };
}

test('unauthorized or foreign connection writes nothing; bad parent is rejected', async () => {
  const s = stores(false);
  const r = await runScreenAudit({ actor, connectionId: 'c1', observationStore: s.obs, auditStore: s.audit, keys: { ok: false } as never, createDriver: () => driver });
  assert.equal(r.ok, false);
  assert.deepEqual(s.calls, []);
  const p = stores(true);
  const r2 = await runScreenAudit({ actor, connectionId: 'c1', parentAuditId: 'other', observationStore: p.obs, auditStore: p.audit, keys: { ok: false } as never, createDriver: () => driver });
  assert.deepEqual([r2.ok, p.calls], [false, []]);
});

test('observation that cannot start finishes the audit as FAILED/ERROR, AI off, both viewports recorded', async () => {
  const s = stores(true);
  const r = await runScreenAudit({ actor, connectionId: 'c1', observationStore: s.obs, auditStore: s.audit, keys: { ok: false } as never, createDriver: () => driver });
  assert.equal(r.ok && r.status, 'ERROR');
  assert.deepEqual(s.calls, ['create:false:DESKTOP,MOBILE', 'finish:FAILED:ERROR']);
  const off = stores(true);
  assert.deepEqual(await runScreenAudit({ actor, connectionId: 'c1', observationStore: off.obs, auditStore: off.audit, keys: { ok: false } as never, createDriver: () => driver, enabled: false }), { ok: false, reason: 'NOT_IMPLEMENTED' });
});
