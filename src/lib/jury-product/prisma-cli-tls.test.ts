import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { buildPreviewPgConfig } from './preview-db-tls';
import {
  CLI_ENGINE_TLS_VERIFICATION_CONFIRMED,
  resolveCliDatasourceUrl,
  validateCliDatabaseUrl,
  type CliTlsEnv,
} from './prisma-cli-tls';

// Test-only certificates are generated per run in a temp directory outside the repo
// with the openssl binary already on this machine; the directory is removed after.
function findOpenssl(): string | null {
  for (const bin of [process.env.OPENSSL_BIN, 'openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe']) {
    if (!bin) continue;
    if (spawnSync(bin, ['version'], { encoding: 'utf8' }).status === 0) return bin;
  }
  return null;
}
const openssl = findOpenssl();
const dir = mkdtempSync(path.join(os.tmpdir(), 'jury-cli-tls-'));
after(() => rmSync(dir, { recursive: true, force: true }));
function run(args: string[]) {
  const result = spawnSync(openssl as string, args, { cwd: dir, encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' } });
  if (result.status !== 0) throw new Error('openssl failed');
}
function makeCerts() {
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '2', '-subj', '/CN=Jury CLI Test CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf.key', '-out', 'leaf.crt', '-days', '2', '-subj', '/CN=leaf', '-addext', 'basicConstraints=critical,CA:FALSE']);
  writeFileSync(path.join(dir, 'bad.pem'), '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n');
  writeFileSync(path.join(dir, 'text.txt'), 'not a certificate');
  return { ca: path.join(dir, 'ca.crt'), leaf: path.join(dir, 'leaf.crt'), bad: path.join(dir, 'bad.pem'), text: path.join(dir, 'text.txt') };
}
const certs = openssl ? makeCerts() : null;
const skip = certs ? false : 'openssl not available: NOT RUN';

const PREVIEW_REF = 'previewdummyrefaaaaa';
const PRODUCTION_REF = 'productiondummyrefbb';
const host = `postgres://postgres.${PREVIEW_REF}:secret@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`;
const cliUrl = (ca: string, extra = '') => `${host}?sslmode=require&sslcert=${encodeURIComponent(ca)}${extra}`;
const confirmed = { engineVerificationConfirmed: true };

function assertNoSecrets(error: unknown) {
  const message = String((error as Error)?.message ?? error);
  assert.match(message, /^BLOCKED_CLI_TLS:[A-Z_]+$/);
  for (const forbidden of ['postgres://', 'secret', PREVIEW_REF, dir, 'BEGIN CERTIFICATE']) assert.equal(message.includes(forbidden), false);
}
function blocked(env: CliTlsEnv, reason: string, argv: string[] = ['node', 'prisma', 'migrate', 'deploy'], deps = {}) {
  let thrown: unknown;
  try {
    resolveCliDatasourceUrl(env, argv, deps);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, `expected ${reason}`);
  assertNoSecrets(thrown);
  assert.equal((thrown as Error).message, `BLOCKED_CLI_TLS:${reason}`);
}

test('switch off and not preview keeps the previous selection', () => {
  assert.equal(resolveCliDatasourceUrl({ DIRECT_URL: 'd', DATABASE_URL: 'u' }), 'd');
  assert.equal(resolveCliDatasourceUrl({ DATABASE_URL: 'u' }), 'u');
  assert.equal(resolveCliDatasourceUrl({}), undefined);
  assert.equal(resolveCliDatasourceUrl({ JURY_DB_CLI_TLS: '', DIRECT_URL: 'd' }), 'd');
  assert.equal(resolveCliDatasourceUrl({ PRISMA_CLI_DATABASE_URL: 'c', DIRECT_URL: 'd', DATABASE_URL: 'u' }), 'c');
  assert.equal(resolveCliDatasourceUrl({ JURY_PREVIEW_DB: '0', DIRECT_URL: 'd' }), 'd');
});

test('an unknown switch value fails closed', () => {
  for (const value of ['true', '1', 'VERIFY', 'off', 'no-verify']) blocked({ JURY_DB_CLI_TLS: value, DIRECT_URL: 'd' }, 'SWITCH_INVALID');
});

test('when enforced there is no fallback to DIRECT_URL or DATABASE_URL', () => {
  blocked({ JURY_DB_CLI_TLS: 'verify', DIRECT_URL: 'd', DATABASE_URL: 'u' }, 'URL_MISSING');
  blocked({ JURY_PREVIEW_DB: '1', DIRECT_URL: 'd', DATABASE_URL: 'u' }, 'URL_MISSING');
});

test('prisma generate gets no url under the policy and never fails on it', () => {
  assert.equal(resolveCliDatasourceUrl({ JURY_DB_CLI_TLS: 'verify', DIRECT_URL: 'd' }, ['node', 'prisma', 'generate']), undefined);
  assert.equal(resolveCliDatasourceUrl({ JURY_PREVIEW_DB: '1' }, ['node', 'prisma', 'generate', '--schema', 'x']), undefined);
  blocked({ JURY_DB_CLI_TLS: 'verify', DIRECT_URL: 'd' }, 'URL_MISSING', ['node', 'prisma', 'migrate', 'generate']);
  blocked({ JURY_DB_CLI_TLS: 'verify', DIRECT_URL: 'd' }, 'URL_MISSING', ['node', 'prisma', '--schema', 'x', 'generate']);
});

test('the engine verification gap blocks even a fully valid url by default', { skip }, () => {
  assert.equal(CLI_ENGINE_TLS_VERIFICATION_CONFIRMED, false);
  const env = { JURY_DB_CLI_TLS: 'verify', JURY_DB_CA_PATH: certs!.ca, PRISMA_CLI_DATABASE_URL: cliUrl(certs!.ca) };
  blocked(env, 'UNVERIFIED_CLI_TLS');
  assert.deepEqual(validateCliDatabaseUrl(cliUrl(certs!.ca), certs!.ca), { ok: false, reason: 'UNVERIFIED_CLI_TLS' });
});

test('a valid config passes once engine verification is confirmed', { skip }, () => {
  const url = cliUrl(certs!.ca, '&schema=public&connect_timeout=5');
  assert.deepEqual(validateCliDatabaseUrl(url, certs!.ca, confirmed), { ok: true });
  assert.equal(resolveCliDatasourceUrl({ JURY_DB_CLI_TLS: 'verify', JURY_DB_CA_PATH: certs!.ca, PRISMA_CLI_DATABASE_URL: url }, ['node', 'prisma', 'migrate', 'status'], confirmed), url);
});

test('ca path problems are blocked', { skip }, () => {
  const deps = confirmed;
  const missing = path.join(dir, 'absent.crt');
  blocked({ JURY_DB_CLI_TLS: 'verify', PRISMA_CLI_DATABASE_URL: cliUrl(certs!.ca) }, 'CA_PATH', undefined, deps);
  blocked({ JURY_DB_CLI_TLS: 'verify', JURY_DB_CA_PATH: 'relative/ca.crt', PRISMA_CLI_DATABASE_URL: cliUrl('relative/ca.crt') }, 'CA_PATH', undefined, deps);
  blocked({ JURY_DB_CLI_TLS: 'verify', JURY_DB_CA_PATH: certs!.ca, PRISMA_CLI_DATABASE_URL: cliUrl(certs!.leaf) }, 'CA_PATH', undefined, deps);
  blocked({ JURY_DB_CLI_TLS: 'verify', JURY_DB_CA_PATH: certs!.ca, PRISMA_CLI_DATABASE_URL: `${host}?sslmode=require` }, 'CA_PATH', undefined, deps);
  blocked({ JURY_DB_CLI_TLS: 'verify', JURY_DB_CA_PATH: missing, PRISMA_CLI_DATABASE_URL: cliUrl(missing) }, 'CA_INVALID', undefined, deps);
  for (const file of [certs!.bad, certs!.text, certs!.leaf]) {
    blocked({ JURY_DB_CLI_TLS: 'verify', JURY_DB_CA_PATH: file, PRISMA_CLI_DATABASE_URL: cliUrl(file) }, 'CA_INVALID', undefined, deps);
  }
  const expired = { ...deps, now: () => Date.parse('2100-01-01T00:00:00Z') };
  blocked({ JURY_DB_CLI_TLS: 'verify', JURY_DB_CA_PATH: certs!.ca, PRISMA_CLI_DATABASE_URL: cliUrl(certs!.ca) }, 'CA_INVALID', undefined, expired);
  const unreadable = { ...deps, readFile: () => { throw new Error('EACCES'); } };
  blocked({ JURY_DB_CLI_TLS: 'verify', JURY_DB_CA_PATH: certs!.ca, PRISMA_CLI_DATABASE_URL: cliUrl(certs!.ca) }, 'CA_INVALID', undefined, unreadable);
});

test('tls-disabling and unknown ssl options are refused', { skip }, () => {
  const ca = certs!.ca;
  const enc = encodeURIComponent(ca);
  const cases: Array<[string, string]> = [
    [`${host}?sslmode=disable&sslcert=${enc}`, 'SSLMODE'],
    [`${host}?sslmode=prefer&sslcert=${enc}`, 'SSLMODE'],
    [`${host}?sslmode=allow&sslcert=${enc}`, 'SSLMODE'],
    [`${host}?sslmode=verify-full&sslcert=${enc}`, 'SSLMODE'],
    [`${host}?sslmode=REQUIRE&sslcert=${enc}`, 'SSLMODE'],
    [`${host}?sslcert=${enc}`, 'SSLMODE'],
    [`${cliUrl(ca)}&sslaccept=accept_invalid_certs`, 'SSL_PARAM'],
    [`${cliUrl(ca)}&sslaccept=strict`, 'SSL_PARAM'],
    [`${cliUrl(ca)}&sslidentity=x.p12`, 'SSL_PARAM'],
    [`${cliUrl(ca)}&sslpassword=x`, 'SSL_PARAM'],
    [`${cliUrl(ca)}&sslrootcert=${enc}`, 'SSL_PARAM'],
    [`${cliUrl(ca)}&ssl=false`, 'SSL_PARAM'],
    [`${cliUrl(ca)}&pgbouncer=true`, 'SSL_PARAM'],
    [`${cliUrl(ca)}&sslmode=disable`, 'SSL_PARAM'],
    ['not a url', 'URL_INVALID'],
    [`mysql://u:secret@h:3306/db?sslmode=require&sslcert=${enc}`, 'URL_INVALID'],
  ];
  for (const [url, reason] of cases) {
    assert.deepEqual(validateCliDatabaseUrl(url, ca, confirmed), { ok: false, reason }, url.replace(/\/\/.*@/, '//***@'));
    blocked({ JURY_DB_CLI_TLS: 'verify', JURY_DB_CA_PATH: ca, PRISMA_CLI_DATABASE_URL: url }, reason, undefined, confirmed);
  }
});

test('preview mode also requires the preview guard for the cli url', { skip }, () => {
  const refs = { JURY_PREVIEW_DB_PROJECT_REF: PREVIEW_REF, JURY_PRODUCTION_DB_PROJECT_REFS: PRODUCTION_REF };
  const ok = { JURY_PREVIEW_DB: '1', JURY_DB_CA_PATH: certs!.ca, PRISMA_CLI_DATABASE_URL: cliUrl(certs!.ca), ...refs };
  assert.equal(resolveCliDatasourceUrl(ok, ['node', 'prisma', 'migrate', 'status'], confirmed), cliUrl(certs!.ca));
  blocked({ ...ok, JURY_PREVIEW_DB_PROJECT_REF: undefined }, 'PREVIEW_GUARD', undefined, confirmed);
  const prod = `postgres://u:secret@db.${PRODUCTION_REF}.supabase.co:5432/postgres?sslmode=require&sslcert=${encodeURIComponent(certs!.ca)}`;
  blocked({ ...ok, PRISMA_CLI_DATABASE_URL: prod }, 'PREVIEW_GUARD', undefined, confirmed);
});

test('runtime and cli urls cannot be mixed', { skip }, () => {
  // A CLI-form url is refused by the runtime builder (sslcert means a client cert to pg).
  assert.deepEqual(buildPreviewPgConfig(cliUrl(certs!.ca), { JURY_PREVIEW_DB_CA_PATH: certs!.ca }), { ok: false, status: 'BLOCKED_PREVIEW_TLS' });
  // The runtime client never reads the CLI variable.
  for (const file of ['src/lib/prisma.ts', 'src/lib/jury-product/preview-db-tls.ts', 'prisma/seed.ts', 'scripts/run-preview-db-test.mjs']) {
    assert.equal(readFileSync(path.join(process.cwd(), file), 'utf8').includes('PRISMA_CLI_DATABASE_URL'), false, file);
  }
  // prisma.config.ts is the only consumer.
  assert.equal(readFileSync(path.join(process.cwd(), 'prisma.config.ts'), 'utf8').includes('resolveCliDatasourceUrl'), true);
});

test('cli tls code never disables certificate verification', () => {
  for (const file of ['src/lib/jury-product/prisma-cli-tls.ts', 'src/lib/jury-product/db-ca.ts', 'prisma.config.ts']) {
    const source = readFileSync(path.join(process.cwd(), file), 'utf8');
    assert.equal(/rejectUnauthorized\s*:\s*false/.test(source), false, file);
    assert.equal(/accept_invalid_certs/.test(source.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')), false, file);
  }
});
