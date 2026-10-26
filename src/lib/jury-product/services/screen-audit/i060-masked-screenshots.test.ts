import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBrowserObservationDriver, type PwContext, type PwPage } from '../readonly-account/browser-driver';
import type { ObservationDriver } from '../readonly-account/executor';
import { createAuditHook } from './audit-hook';
import { MASK_PROBE, UNMASK_PROBE } from './mask-probe';
import { createMaskedCapture, screenshotExpiry, screenshotKey, type ScreenshotSink } from './screenshot-store';
import { purgeExpiredScreenshots } from './screenshot-retention';

function fakePage(maskOk: boolean, log: string[]): PwPage {
  const page = {
    url: () => 'https://app.example.com/orders',
    async evaluate(fn: unknown) {
      if (fn === MASK_PROBE) { log.push('mask'); return { masked: 3, ok: maskOk }; }
      if (fn === UNMASK_PROBE) { log.push('unmask'); return 3; }
      return undefined;
    },
    async screenshot() { log.push('shot'); return new Uint8Array([1, 2, 3]); },
  };
  return page as unknown as PwPage;
}
function driverWith(page: PwPage) {
  const ctx = { async route() {}, async addInitScript() {}, async newPage() { return page; }, async close() {} } as unknown as PwContext;
  return createBrowserObservationDriver(async () => ctx);
}

test('browser driver masks before the screenshot and always unmasks; unverified mask = no screenshot', async () => {
  const ok: string[] = [];
  const shot = await driverWith(fakePage(true, ok)).captureMasked!();
  assert.deepEqual(ok, ['mask', 'shot', 'unmask']);
  assert.equal(shot?.maskedCount, 3);
  const bad: string[] = [];
  assert.equal(await driverWith(fakePage(false, bad)).captureMasked!(), null);
  assert.deepEqual(bad, ['mask', 'unmask']);
});

test('masked capture uploads a tenant-scoped content-addressed key; unmasked or oversized is never stored', async () => {
  const puts: string[] = [];
  const sink: ScreenshotSink = { async put(k) { puts.push(k); }, async remove() {} };
  const base = { setViewport: async () => {}, layoutMetrics: async () => ({}) as never } as unknown as ObservationDriver;
  const good = { ...base, captureMasked: async () => ({ bytes: new Uint8Array([9, 9]), masked: true as const, maskedCount: 1 }) } as ObservationDriver;
  const ref = await createMaskedCapture({ driver: good, sink, tenantId: 't1', auditId: 'a1' })({ path: '/x', viewport: { name: 'MOBILE', width: 390, height: 844 } });
  assert.match(ref!.storageKey, /^t1\/a1\/[a-f0-9]{64}\.jpg$/);
  assert.deepEqual([ref!.masked, ref!.width], [true, 390]);
  const none = { ...base, captureMasked: async () => null } as ObservationDriver;
  assert.equal(await createMaskedCapture({ driver: none, sink, tenantId: 't1', auditId: 'a1' })({ path: '/x', viewport: { name: 'DESKTOP', width: 1366, height: 768 } }), null);
  const big = { ...base, captureMasked: async () => ({ bytes: new Uint8Array(2_000_000), masked: true as const, maskedCount: 0 }) } as ObservationDriver;
  assert.equal(await createMaskedCapture({ driver: big, sink, tenantId: 't1', auditId: 'a1' })({ path: '/x', viewport: { name: 'DESKTOP', width: 1366, height: 768 } }), null);
  assert.equal(puts.length, 1);
  assert.throws(() => screenshotKey('../t', 'a', 'f'.repeat(64)));
  assert.equal(screenshotExpiry(new Date(0)).toISOString(), '1970-01-15T00:00:00.000Z');
});

test('audit hook attaches capture refs; /mypage is never captured', async () => {
  const captured: string[] = [];
  const driver = { setViewport: async () => {}, layoutMetrics: async () => ({}) as never } as unknown as ObservationDriver;
  const hook = createAuditHook({ driver, capture: async ({ path }) => { captured.push(path); return { storageKey: 'k', sha256: 's', byteSize: 1, width: 1, height: 1, masked: true, maskedCount: 0 }; } });
  await hook.onPage({ label: 'a', url: 'https://app.example.com/a' });
  await hook.onPage({ label: 'm', url: 'https://app.example.com/mypage' });
  assert.deepEqual(captured, ['/a', '/a']);
  assert.equal(hook.results.filter((r) => r.capture).length, 2);
});

test('retention removes storage objects before stamping rows; storage failure leaves rows for retry', async () => {
  const order: string[] = [];
  const store = { async listExpired() { return [{ id: 'e1', storageKey: 't/a/x.jpg' }]; }, async markDeleted() { order.push('rows'); } };
  const r = await purgeExpiredScreenshots(store, { async put() {}, async remove() { order.push('storage'); } });
  assert.deepEqual([r.deleted, order], [1, ['storage', 'rows']]);
  const f = await purgeExpiredScreenshots(store, { async put() {}, async remove() { throw new Error('x'); } });
  assert.deepEqual([f.failed, order.length], [1, 2]);
});
