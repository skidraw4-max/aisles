import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { pinnedLookup } from './safe-fetch';

test('I-095: pinned lookup answers both the single and the { all: true } contract with only the pinned address', () => {
  const lookup = pinnedLookup('203.0.113.7', 4);
  let single: unknown[] = [];
  lookup('example.com', { family: 0 }, (...a) => { single = a; });
  assert.deepEqual(single, [null, '203.0.113.7', 4]);
  let all: unknown[] = [];
  lookup('example.com', { all: true }, (...a) => { all = a; });
  assert.deepEqual(all, [null, [{ address: '203.0.113.7', family: 4 }]]);
  let bare: unknown[] = [];
  lookup('example.com', ((...a: unknown[]) => { bare = a; }) as never);
  assert.deepEqual(bare, [null, '203.0.113.7', 4]);
});

test('I-095: a real Node socket connects through the pinned lookup (autoSelectFamily path, no external network)', async () => {
  const server = net.createServer((s) => s.end());
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as net.AddressInfo).port;
  try {
    for (const autoSelectFamily of [true, false]) {
      await new Promise<void>((resolve, reject) => {
        const sock = net.connect({ host: 'pinned.invalid', port, lookup: pinnedLookup('127.0.0.1', 4) as never, autoSelectFamily });
        sock.on('connect', () => { assert.equal(sock.remoteAddress, '127.0.0.1'); sock.destroy(); resolve(); });
        sock.on('error', reject);
      });
    }
  } finally {
    server.close();
  }
});

test('I-095: defaultPinnedGet uses pinnedLookup and keeps the SSRF guards', () => {
  const src = readFileSync('src/lib/jury-product/services/ownership/safe-fetch.ts', 'utf8');
  assert.match(src, /lookup: pinnedLookup\(address, family\)/);
  assert.match(src, /isNonPublicAddress\(a\.address\)/);
  assert.match(src, /port: 443/);
});
