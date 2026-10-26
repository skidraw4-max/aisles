import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostCheck, isForbiddenHostname, isNonPublicAddress } from './net-guard';
import { isSensitivePath } from './sensitive-paths';
import { normalizeObservationScope } from './consent';

test('I-057 non-public address ranges', () => {
  for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.0.1', '169.254.169.254', '127.0.0.1', '0.0.0.0', '100.64.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1'])
    assert.equal(isNonPublicAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '203.0.113.9'.replace('203.0.113', '211.0.1'), '2606:4700::1111', '::ffff:8.8.8.8'])
    assert.equal(isNonPublicAddress(ip), false, ip);
});

test('I-057 forbidden hostnames', () => {
  for (const h of ['127.0.0.1', '[::1]', '8.8.8.8', 'localhost', 'a.localhost', 'metadata.google.internal', 'router', 'x.local', 'svc.internal'])
    assert.equal(isForbiddenHostname(h), true, h);
  assert.equal(isForbiddenHostname('shop.example.com'), false);
});

test('I-057 consent scope rejects IP literal and internal origins', () => {
  for (const o of ['https://10.0.0.1', 'https://169.254.169.254', 'https://localhost', 'https://[::1]', 'https://intranet'])
    assert.equal(normalizeObservationScope({ allowedOrigins: [o], paths: [] }).ok, false, o);
  assert.equal(normalizeObservationScope({ allowedOrigins: ['https://shop.example.com'], paths: [] }).ok, true);
});

test('I-057 DNS check blocks private answers (rebinding to internal) and caches per host', async () => {
  let calls = 0;
  const table: Record<string, string[]> = { 'good.example.com': ['93.184.216.34'], 'evil.example.com': ['93.184.216.34', '10.0.0.5'], 'meta.example.com': ['169.254.169.254'] };
  const hc = createHostCheck(async (h) => {
    calls += 1;
    if (!table[h]) throw new Error('NXDOMAIN');
    return table[h].map((address) => ({ address }));
  });
  assert.equal(await hc.check('good.example.com'), true);
  assert.equal(await hc.check('good.example.com'), true);
  assert.equal(await hc.check('evil.example.com'), false);
  assert.equal(await hc.check('meta.example.com'), false);
  assert.equal(await hc.check('missing.example.com'), false);
  assert.equal(await hc.check('127.0.0.1'), false);
  assert.equal(calls, 4);
  assert.equal(hc.denied(), 4);
});

test('I-057 /mypage is sensitive by default', () => {
  for (const p of ['/mypage', '/mypage/', '/MyPage/orders?x=1', '/mypage.do']) assert.equal(isSensitivePath(p), true, p);
  for (const p of ['/', '/mypages-guide', '/shop/mypage-banner']) assert.equal(isSensitivePath(p), false, p);
});
