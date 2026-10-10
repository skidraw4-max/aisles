import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const { selectExactTest, planPreviewDbAccess } = await import(new URL('../src/lib/jury-product/preview-db-guard.ts', import.meta.url).href);

function value(text, name) {
  const line = text.split(/\r?\n/).find((item) => item.startsWith(`${name}=`));
  if (!line) return '';
  let raw = line.slice(name.length + 1).trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) raw = raw.slice(1, -1);
  return raw;
}

const fileArg = process.argv.indexOf('--file');
const nameArg = process.argv.indexOf('--name');
const file = fileArg === -1 ? '' : process.argv[fileArg + 1] ?? '';
const name = nameArg === -1 ? '' : process.argv[nameArg + 1] ?? '';
if (!file || !name) {
  console.log('BLOCKED_PREVIEW_DB');
  process.exit(2);
}
const source = readFileSync(path.resolve(file), 'utf8');
const selected = selectExactTest(source, name);
if (!selected.ok) {
  console.log(selected.status);
  process.exit(2);
}
const previewText = readFileSync(new URL('../.env.preview', import.meta.url), 'utf8');
const database = value(previewText, 'DATABASE_URL');
const direct = value(previewText, 'DIRECT_URL');
const plan = planPreviewDbAccess({ JURY_PREVIEW_DB: '1', DATABASE_URL: database, DIRECT_URL: direct });
if (!plan.ok) {
  console.log(plan.status);
  process.exit(2);
}
const child = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-name-pattern', selected.pattern, file], {
  cwd: process.cwd(),
  env: { ...process.env, JURY_PREVIEW_DB: '1', DATABASE_URL: database, DIRECT_URL: direct },
  encoding: 'utf8',
  shell: false,
});
const output = `${child.stdout ?? ''}${child.stderr ?? ''}`;
process.stdout.write(output.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]'));
process.exit(child.status ?? 1);
