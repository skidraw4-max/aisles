import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isCronRateLimited } from './cron-rate-limit';
import { clientKeyFromRequest, createRateLimiter } from './simple-rate-limit';

const here = path.dirname(fileURLToPath(import.meta.url));

test('separate limiter instances do not share counters', () => {
  const a = createRateLimiter({ limit: 2, windowMs: 60_000 });
  const b = createRateLimiter({ limit: 2, windowMs: 60_000 });
  assert.equal(a.check('k'), false);
  assert.equal(a.check('k'), false);
  assert.equal(a.check('k'), true);
  assert.equal(b.check('k'), false);
  assert.equal(b.size(), 1);
  a.reset();
  assert.equal(a.size(), 0);
  assert.equal(b.size(), 1);
});

test('allows exactly `limit` hits per key, then limits; keys independent', () => {
  const l = createRateLimiter({ limit: 3, windowMs: 60_000 });
  const results = Array.from({ length: 5 }, () => l.check('ip-1'));
  assert.deepEqual(results, [false, false, false, true, true]);
  assert.equal(l.check('ip-2'), false);
  assert.throws(() => createRateLimiter({ limit: 0, windowMs: 1 }), RangeError);
  assert.throws(() => createRateLimiter({ limit: 1, windowMs: 0 }), RangeError);
});

test('window expiry resets the key (injected clock); reset() clears state', () => {
  let t = 1_000;
  const l = createRateLimiter({ limit: 1, windowMs: 100, now: () => t });
  assert.equal(l.check('k'), false);
  assert.equal(l.check('k'), true);
  t += 99;
  assert.equal(l.check('k'), true, 'still inside window');
  t += 1;
  assert.equal(l.check('k'), false, 'window boundary (>= windowMs) starts new window');
  assert.equal(l.check('k'), true);
  l.reset();
  assert.equal(l.check('k'), false);
});

test('concurrent calls produce a consistent allowed count', async () => {
  const l = createRateLimiter({ limit: 5, windowMs: 60_000 });
  const results = await Promise.all(
    Array.from({ length: 20 }, () => Promise.resolve().then(() => l.check('same'))),
  );
  assert.equal(results.filter((r) => r === false).length, 5);
  assert.equal(results.filter((r) => r === true).length, 15);
});

test('diagnostics limiter does not mutate cron-rate-limit state', () => {
  const ip = '203.0.113.98';
  const req = () => new Request('http://localhost/api/cron/x', { headers: { 'x-forwarded-for': ip } });
  const diag = createRateLimiter({ limit: 1, windowMs: 60_000 });
  assert.equal(clientKeyFromRequest(req()), ip);
  for (let i = 0; i < 50; i++) diag.check(clientKeyFromRequest(req()));
  assert.equal(diag.check(ip), true);
  // cron limiter (10/window) must still have a fresh budget for the same IP.
  const cron = Array.from({ length: 11 }, () => isCronRateLimited(req()));
  assert.deepEqual(cron, [...Array(10).fill(false), true]);
});

test('simple-rate-limit.ts imports nothing (no prisma/supabase/pg/network/cron)', () => {
  const src = readFileSync(path.join(here, 'simple-rate-limit.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\bimport\b|\brequire\s*\(/);
  assert.doesNotMatch(code, /prisma|supabase|\bpg\b|node:(http|https|net|tls|dns)|fetch\s*\(|cron-rate-limit/i);
});
