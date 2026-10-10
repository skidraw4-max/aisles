import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import test, { after } from 'node:test';
import pg from 'pg';
import { buildPreviewPgConfig, defaultPreviewCaPath, requirePreviewPgConfig } from './preview-db-tls';
import { SUPABASE_CA_RELATIVE_PATH, type CaPin } from './supabase-ca-pin';

// The committed, pinned Supabase CA. Local TLS handshake tests below use generated
// test CAs; they reach the same pinned-validation path through the TEST-ONLY deps.pin
// option (code-level, never env-controlled), pinned to that generated CA.
const OFFICIAL_CA = path.join(process.cwd(), SUPABASE_CA_RELATIVE_PATH);
function pinFor(file: string): CaPin {
  const bytes = readFileSync(file);
  const cert = new X509Certificate(bytes);
  return {
    fileSha256: createHash('sha256').update(bytes).digest('hex'),
    fingerprint256: cert.fingerprint256,
    subject: cert.subject,
    issuer: cert.issuer,
    validFrom: new Date(cert.validFrom).toISOString(),
    validTo: new Date(cert.validTo).toISOString(),
  };
}

// Test-only certificates are generated per run in a temp directory with the
// openssl binary already on this machine (nothing is installed or committed).
function findOpenssl(): string | null {
  const candidates = [process.env.OPENSSL_BIN, 'openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe'];
  for (const bin of candidates) {
    if (!bin) continue;
    const probe = spawnSync(bin, ['version'], { encoding: 'utf8' });
    if (probe.status === 0) return bin;
  }
  return null;
}

const openssl = findOpenssl();
const dir = mkdtempSync(path.join(os.tmpdir(), 'jury-preview-tls-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[]) {
  const result = spawnSync(openssl as string, args, {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' },
  });
  if (result.status !== 0) throw new Error('openssl failed');
}

type Pki = { ca: string; otherCa: string; leafAsCa: string; key: string; cert: string };

function makePki(): Pki {
  const caExt = ['-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'];
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '2', '-subj', '/CN=Jury Test CA', ...caExt]);
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'other.key', '-out', 'other.crt', '-days', '2', '-subj', '/CN=Jury Other CA', ...caExt]);
  run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'srv.key', '-out', 'srv.csr', '-subj', '/CN=localhost']);
  writeFileSync(path.join(dir, 'srv.ext'), 'basicConstraints=CA:FALSE\nsubjectAltName=DNS:localhost\n');
  run(['x509', '-req', '-in', 'srv.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'srv.crt', '-days', '2', '-extfile', 'srv.ext']);
  return {
    ca: path.join(dir, 'ca.crt'),
    otherCa: path.join(dir, 'other.crt'),
    leafAsCa: path.join(dir, 'srv.crt'),
    key: readFileSync(path.join(dir, 'srv.key'), 'utf8'),
    cert: readFileSync(path.join(dir, 'srv.crt'), 'utf8'),
  };
}

const pki = openssl ? makePki() : null;
const skip = pki ? false : 'openssl not available: NOT RUN';
const base = 'postgres://postgres.previewdummyrefaaaaa:secret@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';

function assertSafeStatus(value: unknown) {
  const text = JSON.stringify(value);
  assert.equal(text.includes('postgres://'), false);
  assert.equal(text.includes('secret'), false);
  assert.equal(text.includes(dir), false);
}

test('the default CA path is the pinned repo file; overrides must be absolute', () => {
  const cwd = path.join(dir, 'project');
  assert.equal(defaultPreviewCaPath({}, cwd), path.join(cwd, SUPABASE_CA_RELATIVE_PATH));
  assert.equal(defaultPreviewCaPath({ JURY_PREVIEW_DB_CA_PATH: '  ' }, cwd), path.join(cwd, SUPABASE_CA_RELATIVE_PATH));
  const abs = path.join(dir, 'ca.pem');
  assert.equal(defaultPreviewCaPath({ JURY_PREVIEW_DB_CA_PATH: abs }, cwd), abs);
  for (const rel of ['X/ca.pem', './certs/x.crt', 'ca.crt', '..\\ca.crt']) {
    assert.equal(defaultPreviewCaPath({ JURY_PREVIEW_DB_CA_PATH: rel }, cwd), null, rel);
    assert.deepEqual(buildPreviewPgConfig(base, { JURY_PREVIEW_DB_CA_PATH: rel }), { ok: false, status: 'BLOCKED_PREVIEW_TLS' });
  }
});

test('the committed official CA passes by default and via an absolute override copy', () => {
  const byDefault = buildPreviewPgConfig(base, {});
  assert.equal(byDefault.ok, true);
  const copy = path.join(dir, 'official-copy.crt');
  copyFileSync(OFFICIAL_CA, copy);
  const viaOverride = buildPreviewPgConfig(base, { JURY_PREVIEW_DB_CA_PATH: copy });
  assert.equal(viaOverride.ok, true);
  if (!viaOverride.ok || !byDefault.ok) return;
  assert.equal(viaOverride.ssl.rejectUnauthorized, true);
  assert.equal(viaOverride.ssl.servername, 'aws-0-ap-south-1.pooler.supabase.com');
  assert.equal(viaOverride.ssl.checkServerIdentity, tls.checkServerIdentity);
  assert.equal(viaOverride.ssl.ca, byDefault.ssl.ca);
});

test('a CA that does not match the pin fails closed (modified bytes, CRLF, different CA)', { skip }, () => {
  const bytes = readFileSync(OFFICIAL_CA);
  const mutated = Buffer.from(bytes);
  mutated[200] ^= 0x01;
  const crlf = Buffer.from(bytes.toString('utf8').replace(/\n/g, '\r\n'));
  for (const [name, data] of [['mut.crt', mutated], ['crlf.crt', crlf]] as const) {
    const file = path.join(dir, name);
    writeFileSync(file, data);
    const result = buildPreviewPgConfig(base, { JURY_PREVIEW_DB_CA_PATH: file });
    assert.deepEqual(result, { ok: false, status: 'BLOCKED_PREVIEW_TLS' }, name);
    assertSafeStatus(result);
  }
  // A valid but different CA is refused without the test-only pin.
  assert.deepEqual(buildPreviewPgConfig(base, { JURY_PREVIEW_DB_CA_PATH: pki!.ca }), { ok: false, status: 'BLOCKED_PREVIEW_TLS' });
  // Expired / not-yet-valid official CA via injected clock.
  assert.equal(buildPreviewPgConfig(base, {}, { now: () => Date.parse('2031-04-27T00:00:00Z') }).ok, false);
  assert.equal(buildPreviewPgConfig(base, {}, { now: () => Date.parse('2021-04-27T00:00:00Z') }).ok, false);
});

test('a missing, unreadable, or non-certificate CA fails closed', () => {
  const missing = buildPreviewPgConfig(base, { JURY_PREVIEW_DB_CA_PATH: path.join(dir, 'absent.crt') });
  assert.deepEqual(missing, { ok: false, status: 'BLOCKED_PREVIEW_TLS' });
  assertSafeStatus(missing);
  const missingDefault = buildPreviewPgConfig(base, {}, { cwd: path.join(dir, 'no-project') });
  assert.equal(missingDefault.ok, false);
  const unreadable = buildPreviewPgConfig(base, {}, { readFile: () => { throw new Error('EACCES'); } });
  assert.equal(unreadable.ok, false);
  const notPem = buildPreviewPgConfig(base, {}, { readFile: () => Buffer.from('not a certificate') });
  assert.equal(notPem.ok, false);
  const brokenPem = buildPreviewPgConfig(base, {}, { readFile: () => Buffer.from('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n') });
  assert.equal(brokenPem.ok, false);
  assert.throws(() => requirePreviewPgConfig(base, { JURY_PREVIEW_DB_CA_PATH: path.join(dir, 'absent.crt') }), /^Error: BLOCKED_PREVIEW_TLS$/);
});

test('a valid CA yields verified TLS options for the url host', { skip }, () => {
  const config = buildPreviewPgConfig(base, { JURY_PREVIEW_DB_CA_PATH: pki!.ca }, { pin: pinFor(pki!.ca) });
  assert.equal(config.ok, true);
  if (!config.ok) return;
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.servername, 'aws-0-ap-south-1.pooler.supabase.com');
  assert.equal(config.ssl.checkServerIdentity, tls.checkServerIdentity);
  assert.equal(config.ssl.ca.includes('BEGIN CERTIFICATE'), true);
  assert.equal(config.connectionString, base);
  const leaf = buildPreviewPgConfig(base, { JURY_PREVIEW_DB_CA_PATH: pki!.leafAsCa }, { pin: pinFor(pki!.leafAsCa) });
  assert.equal(leaf.ok, false);
});

test('ssl url parameters are rejected except an explicit verify-full', { skip }, () => {
  const env = { JURY_PREVIEW_DB_CA_PATH: pki!.ca };
  const testPin = { pin: pinFor(pki!.ca) };
  const strict = buildPreviewPgConfig(`${base}?sslmode=verify-full`, env, testPin);
  assert.equal(strict.ok, true);
  if (strict.ok) assert.equal(strict.connectionString.includes('sslmode'), false);
  const kept = buildPreviewPgConfig(`${base}?application_name=jury&sslmode=verify-full`, env, testPin);
  assert.equal(kept.ok, true);
  if (kept.ok) assert.equal(kept.connectionString.includes('application_name=jury'), true);
  for (const query of [
    'sslmode=disable', 'sslmode=prefer', 'sslmode=require', 'sslmode=verify-ca', 'sslmode=no-verify', 'SSLMODE=disable',
    'sslmode=verify-full&sslmode=disable', 'ssl=true', 'ssl=0', 'ssl=no-verify', 'sslrootcert=x.crt', 'sslcert=x', 'sslkey=x',
    'uselibpqcompat=true&sslmode=require',
  ]) {
    const blocked = buildPreviewPgConfig(`${base}?${query}`, env, testPin);
    assert.deepEqual(blocked, { ok: false, status: 'BLOCKED_PREVIEW_TLS' }, query);
    assertSafeStatus(blocked);
  }
  for (const bad of ['not a url', 'mysql://u:p@h:5432/db', '']) {
    assert.equal(buildPreviewPgConfig(bad, env, testPin).ok, false);
  }
});

function tlsServer(cert: string, key: string): Promise<{ port: number; close: () => void; handshakes: () => number }> {
  let count = 0;
  const server = tls.createServer({ cert, key }, (socket) => {
    count += 1;
    socket.end();
  });
  server.on('tlsClientError', () => undefined);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, close: () => server.close(), handshakes: () => count });
    });
  });
}

function tlsAttempt(port: number, ssl: tls.ConnectionOptions): Promise<{ ok: boolean; code?: string }> {
  return new Promise((resolve) => {
    const socket = tls.connect({ ...ssl, host: '127.0.0.1', port });
    socket.once('secureConnect', () => {
      resolve({ ok: socket.authorized });
      socket.destroy();
    });
    socket.once('error', (error: NodeJS.ErrnoException) => resolve({ ok: false, code: error.code }));
  });
}

test('the built options reject an untrusted chain and a hostname mismatch on a local tls server', { skip }, async () => {
  const server = await tlsServer(pki!.cert, pki!.key);
  try {
    const good = buildPreviewPgConfig('postgres://u:secret@localhost:5432/db', { JURY_PREVIEW_DB_CA_PATH: pki!.ca }, { pin: pinFor(pki!.ca) });
    assert.equal(good.ok, true);
    if (!good.ok) return;
    assert.deepEqual(await tlsAttempt(server.port, good.ssl), { ok: true });

    const untrusted = buildPreviewPgConfig('postgres://u:secret@localhost:5432/db', { JURY_PREVIEW_DB_CA_PATH: pki!.otherCa }, { pin: pinFor(pki!.otherCa) });
    assert.equal(untrusted.ok, true);
    if (!untrusted.ok) return;
    const chain = await tlsAttempt(server.port, untrusted.ssl);
    assert.equal(chain.ok, false);
    assert.match(chain.code ?? '', /UNABLE_TO_VERIFY|SELF_SIGNED|UNABLE_TO_GET_ISSUER/);

    const wrongHost = buildPreviewPgConfig('postgres://u:secret@db.wrong.example:5432/db', { JURY_PREVIEW_DB_CA_PATH: pki!.ca }, { pin: pinFor(pki!.ca) });
    assert.equal(wrongHost.ok, true);
    if (!wrongHost.ok) return;
    const mismatch = await tlsAttempt(server.port, wrongHost.ssl);
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.code, 'ERR_TLS_CERT_ALTNAME_INVALID');
  } finally {
    server.close();
  }
});

// A fake Postgres front end: answers the SSLRequest with 'S', then upgrades to TLS.
function fakePostgres(cert: string, key: string, reply: 'S' | 'N' = 'S'): Promise<{ port: number; close: () => void; secured: () => number }> {
  let secured = 0;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((raw) => {
    sockets.add(raw);
    raw.on('error', () => undefined);
    raw.once('data', () => {
      raw.write(reply);
      if (reply === 'N') return;
      const secure = new tls.TLSSocket(raw, { isServer: true, cert, key });
      secure.on('error', () => undefined);
      secure.once('secure', () => {
        secured += 1;
        secure.destroy();
      });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        secured: () => secured,
        close: () => {
          for (const socket of sockets) socket.destroy();
          server.close();
        },
      });
    });
  });
}

async function pgAttempt(port: number, host: string, caPath: string): Promise<string> {
  const config = requirePreviewPgConfig(`postgres://u:secret@${host}:${port}/db`, { JURY_PREVIEW_DB_CA_PATH: caPath }, { pin: pinFor(caPath) });
  // Route the named host to the local fake server without touching DNS.
  const client = new pg.Client({
    connectionString: config.connectionString,
    ssl: config.ssl,
    connectionTimeoutMillis: 3000,
    stream: () => {
      const socket = new net.Socket();
      const connect = socket.connect.bind(socket) as (port: number, host: string) => net.Socket;
      (socket as unknown as { connect: (port: number, host: string) => net.Socket }).connect = (target: number) => connect(target, '127.0.0.1');
      return socket;
    },
  } as unknown as pg.ClientConfig);
  client.on('error', () => undefined);
  try {
    await client.connect();
    return 'CONNECTED';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? 'ERROR';
  } finally {
    await client.end().catch(() => undefined);
  }
}

test('pg itself enforces the chain and hostname with the built config', { skip }, async () => {
  const server = await fakePostgres(pki!.cert, pki!.key);
  try {
    const before = server.secured();
    const good = await pgAttempt(server.port, 'localhost', pki!.ca);
    assert.notEqual(good, 'CONNECTED');
    assert.equal(server.secured(), before + 1);

    const untrusted = await pgAttempt(server.port, 'localhost', pki!.otherCa);
    assert.match(untrusted, /UNABLE_TO_VERIFY|SELF_SIGNED|UNABLE_TO_GET_ISSUER/);

    const mismatch = await pgAttempt(server.port, 'db.wrong.example', pki!.ca);
    assert.equal(mismatch, 'ERR_TLS_CERT_ALTNAME_INVALID');
    assert.equal(server.secured(), before + 1);
  } finally {
    server.close();
  }
});

test('pg refuses to continue in plaintext when the server declines tls', { skip }, async () => {
  const server = await fakePostgres(pki!.cert, pki!.key, 'N');
  try {
    const result = await pgAttempt(server.port, 'localhost', pki!.ca);
    assert.notEqual(result, 'CONNECTED');
    assert.equal(server.secured(), 0);
  } finally {
    server.close();
  }
});

test('changed connection code never disables certificate verification', () => {
  for (const file of ['src/lib/jury-product/preview-db-tls.ts', 'src/lib/prisma.ts', 'prisma/seed.ts', 'scripts/run-preview-db-test.mjs']) {
    const source = readFileSync(path.join(process.cwd(), file), 'utf8');
    assert.equal(/rejectUnauthorized\s*:\s*false/.test(source), false, file);
    assert.equal(/NODE_TLS_REJECT_UNAUTHORIZED/.test(source), false, file);
  }
  assert.equal(existsSync(dir), true);
});
