import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { selectExactTest, planPreviewDbAccess } = await import(new URL('../src/lib/jury-product/preview-db-guard.ts', import.meta.url).href);
const { buildPreviewPgConfig } = await import(new URL('../src/lib/jury-product/preview-db-tls.ts', import.meta.url).href);

function value(text, name) {
  const line = text.split(/\r?\n/).find((item) => item.startsWith(`${name}=`));
  if (!line) return '';
  let raw = line.slice(name.length + 1).trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) raw = raw.slice(1, -1);
  return raw;
}

/**
 * Runs one exact Preview DB test. Returns the exit code instead of exiting so the
 * order (select -> guard -> TLS -> spawn) can be tested without a database or child.
 */
export async function run(argv, overrides = {}) {
  const deps = {
    env: process.env,
    cwd: process.cwd(),
    execPath: process.execPath,
    readSource: (file) => readFileSync(path.resolve(file), 'utf8'),
    readPreviewEnv: () => readFileSync(new URL('../.env.preview', import.meta.url), 'utf8'),
    selectTest: selectExactTest,
    plan: planPreviewDbAccess,
    buildTls: buildPreviewPgConfig,
    spawnTest: (command, args, options) => spawnSync(command, args, options),
    log: (message) => console.log(message),
    write: (text) => process.stdout.write(text),
    ...overrides,
  };
  const fileArg = argv.indexOf('--file');
  const nameArg = argv.indexOf('--name');
  const file = fileArg === -1 ? '' : argv[fileArg + 1] ?? '';
  const name = nameArg === -1 ? '' : argv[nameArg + 1] ?? '';
  if (!file || !name) {
    deps.log('BLOCKED_PREVIEW_DB');
    return 2;
  }
  const source = deps.readSource(file);
  const selected = deps.selectTest(source, name);
  if (!selected.ok) {
    deps.log(selected.status);
    return 2;
  }
  const previewText = deps.readPreviewEnv();
  const database = value(previewText, 'DATABASE_URL');
  const direct = value(previewText, 'DIRECT_URL');
  // Project refs are configuration, never source: take them from .env.preview, else from the process environment.
  const previewRef = value(previewText, 'JURY_PREVIEW_DB_PROJECT_REF') || deps.env.JURY_PREVIEW_DB_PROJECT_REF || '';
  const productionRefs = value(previewText, 'JURY_PRODUCTION_DB_PROJECT_REFS') || deps.env.JURY_PRODUCTION_DB_PROJECT_REFS || '';
  const refEnv = { JURY_PREVIEW_DB_PROJECT_REF: previewRef, JURY_PRODUCTION_DB_PROJECT_REFS: productionRefs };
  const plan = deps.plan({ JURY_PREVIEW_DB: '1', DATABASE_URL: database, DIRECT_URL: direct, ...refEnv });
  if (!plan.ok) {
    deps.log(plan.status);
    return 2;
  }
  // Both urls must be securable with verified TLS before any test process starts.
  for (const url of [database, direct]) {
    const tls = deps.buildTls(url, deps.env);
    if (!tls.ok) {
      deps.log(tls.status);
      return 2;
    }
  }
  const child = deps.spawnTest(deps.execPath, ['--import', 'tsx', '--test', '--test-name-pattern', selected.pattern, file], {
    cwd: deps.cwd,
    env: { ...deps.env, JURY_PREVIEW_DB: '1', DATABASE_URL: database, DIRECT_URL: direct, ...refEnv },
    encoding: 'utf8',
    shell: false,
  });
  const output = `${child.stdout ?? ''}${child.stderr ?? ''}`;
  deps.write(output.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]'));
  return child.status ?? 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exit(await run(process.argv));
}
