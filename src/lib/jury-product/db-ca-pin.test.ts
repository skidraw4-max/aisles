/**
 * readPinnedCaPem: the pinned Supabase root CA passes; anything else fails closed with a fixed code.
 * Run: node --import tsx --test src/lib/jury-product/db-ca-pin.test.ts
 * No network/DB. Temporary certificates live in os.tmpdir() and are removed after the run.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { PinnedCaError, readPinnedCaPem, type PinnedCaErrorCode } from './db-ca';
import { SUPABASE_CA_PIN, SUPABASE_CA_RELATIVE_PATH, type CaPin } from './supabase-ca-pin';

const OFFICIAL = path.resolve(__dirname, '../../..', SUPABASE_CA_RELATIVE_PATH);
const tmp = mkdtempSync(path.join(os.tmpdir(), 'jury-ca-pin-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const write = (name: string, data: Buffer | string) => {
  const file = path.join(tmp, name);
  writeFileSync(file, data);
  return file;
};

function expectCode(fn: () => unknown, code: PinnedCaErrorCode) {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof PinnedCaError, 'expected PinnedCaError');
  assert.equal(caught.code, code);
  assert.equal(caught.message, code);
  assert.ok(!caught.message.includes('BEGIN CERTIFICATE'));
  assert.ok(!caught.message.includes(tmp) && !caught.message.includes('certs'));
}

function findOpenssl(): string | null {
  for (const c of [process.env.OPENSSL_BIN, 'openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe']) {
    if (!c) continue;
    if (c.includes('\\') && !existsSync(c)) continue;
    const r = spawnSync(c, ['version'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  return null;
}

function makeOtherCa(): string | null {
  const openssl = findOpenssl();
  if (!openssl) return null;
  const key = path.join(tmp, 'other.key');
  const crt = path.join(tmp, 'other.crt');
  const r = spawnSync(
    openssl,
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '30', '-subj', '/CN=Other Test Root CA', '-addext', 'basicConstraints=critical,CA:TRUE'],
    { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
  );
  return r.status === 0 && existsSync(crt) ? crt : null;
}

const official = readFileSync(OFFICIAL);
const inWindow = () => Date.parse('2026-10-10T00:00:00Z');

describe('readPinnedCaPem', () => {
  it('accepts the committed official CA', () => {
    const pem = readPinnedCaPem(OFFICIAL, { now: inWindow });
    assert.ok(pem.length > 0);
  });

  it('accepts with the real clock (fails once the CA expires)', () => {
    assert.ok(readPinnedCaPem(OFFICIAL).length > 0);
  });

  it('blocks a missing file', () => {
    expectCode(() => readPinnedCaPem(path.join(tmp, 'nope.crt')), 'CA_PIN_MISSING');
  });

  it('blocks a 1-byte modification', () => {
    const b = Buffer.from(official);
    b[200] ^= 0x01;
    expectCode(() => readPinnedCaPem(write('mut.crt', b), { now: inWindow }), 'CA_PIN_FILE_HASH');
  });

  it('blocks line-ending conversion (CRLF)', () => {
    const crlf = Buffer.from(official.toString('utf8').replace(/\n/g, '\r\n'));
    expectCode(() => readPinnedCaPem(write('crlf.crt', crlf), { now: inWindow }), 'CA_PIN_FILE_HASH');
  });

  it('blocks bad PEM even when the file hash is pinned to it', () => {
    const bad = Buffer.from('not a certificate\n');
    const pin: CaPin = { ...SUPABASE_CA_PIN, fileSha256: sha(bad) };
    expectCode(() => readPinnedCaPem(write('bad.pem', bad), { pin, now: inWindow }), 'CA_PIN_PARSE');
  });

  const other = makeOtherCa();
  const skip = other ? false : 'openssl not available: NOT RUN';

  it('blocks a different CA under the default pin (file hash)', { skip }, () => {
    expectCode(() => readPinnedCaPem(other as string, { now: inWindow }), 'CA_PIN_FILE_HASH');
  });

  it('blocks a different CA by DER fingerprint when only the file hash matches', { skip }, () => {
    const pin: CaPin = { ...SUPABASE_CA_PIN, fileSha256: sha(readFileSync(other as string)) };
    expectCode(() => readPinnedCaPem(other as string, { pin, now: inWindow }), 'CA_PIN_FINGERPRINT');
  });

  it('blocks subject / issuer / validity metadata mismatches (custom pin)', () => {
    expectCode(() => readPinnedCaPem(OFFICIAL, { pin: { ...SUPABASE_CA_PIN, subject: 'CN=Other' }, now: inWindow }), 'CA_PIN_SUBJECT');
    expectCode(() => readPinnedCaPem(OFFICIAL, { pin: { ...SUPABASE_CA_PIN, issuer: 'CN=Other' }, now: inWindow }), 'CA_PIN_ISSUER');
    expectCode(
      () => readPinnedCaPem(OFFICIAL, { pin: { ...SUPABASE_CA_PIN, validTo: '2032-01-01T00:00:00.000Z' }, now: inWindow }),
      'CA_PIN_VALIDITY_MISMATCH',
    );
    expectCode(
      () => readPinnedCaPem(OFFICIAL, { pin: { ...SUPABASE_CA_PIN, fingerprint256: '00:'.repeat(31) + '00' }, now: inWindow }),
      'CA_PIN_FINGERPRINT',
    );
  });

  it('blocks before validFrom and after validTo (injected clock)', () => {
    expectCode(() => readPinnedCaPem(OFFICIAL, { now: () => Date.parse('2021-04-28T10:56:52Z') }), 'CA_PIN_NOT_YET_VALID');
    expectCode(() => readPinnedCaPem(OFFICIAL, { now: () => Date.parse('2031-04-26T10:56:54Z') }), 'CA_PIN_EXPIRED');
  });

  it('uses the injected fs and never leaks content in errors', () => {
    let calls = 0;
    const fs = { readFileSync: () => { calls += 1; return Buffer.from('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n'); } };
    expectCode(() => readPinnedCaPem('virtual.crt', { fs, now: inWindow }), 'CA_PIN_FILE_HASH');
    assert.equal(calls, 1);
  });
});