/**
 * Pinned Supabase root CA: fails if certs/supabase/prod-ca-2021.crt is missing, modified, or invalid.
 * Run: node --import tsx --test src/lib/jury-product/supabase-ca.test.ts
 * No network/DB; never prints certificate content.
 */
import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { readValidCaPem } from './db-ca';
import { SUPABASE_CA_PIN, SUPABASE_CA_RELATIVE_PATH } from './supabase-ca-pin';

const CA_FILE = path.resolve(__dirname, '../../..', SUPABASE_CA_RELATIVE_PATH);
const PINNED_FILE_SHA256 = SUPABASE_CA_PIN.fileSha256;
const PINNED_CERT_FP256 = SUPABASE_CA_PIN.fingerprint256;

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function readCa(): Buffer {
  assert.ok(fs.existsSync(CA_FILE), 'pinned CA file missing');
  return fs.readFileSync(CA_FILE);
}

describe('pinned Supabase root CA', () => {
  it('file bytes match the pinned SHA-256', () => {
    const buf = readCa();
    assert.equal(buf.length, 1367);
    assert.ok(sha256Hex(buf) === PINNED_FILE_SHA256, 'pinned CA file modified');
  });

  it('a 1-byte mutation changes the hash', () => {
    const buf = Buffer.from(readCa());
    buf[100] = buf[100] ^ 0x01;
    assert.ok(sha256Hex(buf) !== PINNED_FILE_SHA256);
  });

  it('parses as the expected self-signed CA', () => {
    const cert = new X509Certificate(readCa());
    assert.equal(cert.fingerprint256, PINNED_CERT_FP256);
    assert.equal(cert.subject, SUPABASE_CA_PIN.subject);
    assert.equal(cert.issuer, SUPABASE_CA_PIN.issuer);
    assert.equal(cert.ca, true);
    assert.equal(new Date(cert.validFrom).toISOString(), SUPABASE_CA_PIN.validFrom);
    assert.equal(new Date(cert.validTo).toISOString(), SUPABASE_CA_PIN.validTo);
  });

  it('is accepted by the shared db-ca helper (no content echoed)', () => {
    const pem = readValidCaPem(CA_FILE, (f) => fs.readFileSync(f, 'utf8'));
    assert.ok(pem !== null, 'db-ca helper rejected pinned CA');
    const afterExpiry = Date.parse('2031-04-27T00:00:00Z');
    assert.ok(readValidCaPem(CA_FILE, (f) => fs.readFileSync(f, 'utf8'), () => afterExpiry) === null);
    assert.ok(readValidCaPem(CA_FILE + '.missing', (f) => fs.readFileSync(f, 'utf8')) === null);
  });
});
