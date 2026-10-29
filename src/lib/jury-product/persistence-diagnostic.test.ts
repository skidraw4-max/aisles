import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { notePersistenceFailure } from './persistence-diagnostic';

test('persistence diagnostics keep the secret out of the record', () => {
  const secret = 'postgres://secret@db.example/app';
  const lines: string[] = [];
  const original = console.error;
  console.error = (line?: unknown) => {
    lines.push(String(line));
  };
  const previous = process.env.JURY_TEST_DIAGNOSTICS;
  process.env.JURY_TEST_DIAGNOSTICS = '1';
  try {
    const error = Object.assign(new Error(`query failed ${secret}`), { code: 'P2028' });
    notePersistenceFailure('review.persist', error);
  } finally {
    console.error = original;
    if (previous === undefined) delete process.env.JURY_TEST_DIAGNOSTICS;
    else process.env.JURY_TEST_DIAGNOSTICS = previous;
  }
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0] ?? '{}') as { operation?: string; errorClass?: string; timeout?: boolean; code?: string };
  assert.equal(record.operation, 'review.persist');
  assert.equal(record.errorClass, 'Error');
  assert.equal(record.timeout, true);
  assert.equal(record.code, 'P2028');
  assert.equal(lines[0]?.includes(secret), false);
  assert.equal(lines[0]?.includes('query failed'), false);
});

test('raw query failures record the SQLSTATE and omit the database message', () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (line?: unknown) => {
    lines.push(String(line));
  };
  const previous = process.env.JURY_TEST_DIAGNOSTICS;
  process.env.JURY_TEST_DIAGNOSTICS = '1';
  const query = 'INSERT INTO "JuryEvidence" (id) VALUES (\'secret-row\')';
  try {
    const error = Object.assign(new Error(query), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2010',
      meta: { code: '42703', message: query },
    });
    notePersistenceFailure('evidence.persist', error);
  } finally {
    console.error = original;
    if (previous === undefined) delete process.env.JURY_TEST_DIAGNOSTICS;
    else process.env.JURY_TEST_DIAGNOSTICS = previous;
  }
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0] ?? '{}') as { code?: string; sqlState?: string; timeout?: boolean };
  assert.equal(record.code, 'P2010');
  assert.equal(record.sqlState, '42703');
  assert.equal(record.timeout, false);
  assert.equal(lines[0]?.includes(query), false);
  assert.equal(lines[0]?.includes('secret-row'), false);
});

test('driver adapter failures record the SQLSTATE and kind without the driver message', () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (line?: unknown) => {
    lines.push(String(line));
  };
  const previous = process.env.JURY_TEST_DIAGNOSTICS;
  process.env.JURY_TEST_DIAGNOSTICS = '1';
  const query = 'SELECT secret FROM "JuryEvidence"';
  try {
    const error = Object.assign(new Error(query), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2010',
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: '42703',
            originalMessage: `column "contentHash" ${query}`,
            kind: 'ColumnNotFound',
            column: 'contentHash',
          },
        },
      },
    });
    notePersistenceFailure('evidence.persist', error);
  } finally {
    console.error = original;
    if (previous === undefined) delete process.env.JURY_TEST_DIAGNOSTICS;
    else process.env.JURY_TEST_DIAGNOSTICS = previous;
  }
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0] ?? '{}') as { sqlState?: string; driverKind?: string; column?: string };
  assert.equal(record.sqlState, '42703');
  assert.equal(record.driverKind, 'ColumnNotFound');
  assert.equal(record.column, 'contentHash');
  assert.equal(lines[0]?.includes(query), false);
  assert.equal(lines[0]?.includes('secret'), false);
});

test('a hash-required evidence failure names that operation without a thrown query', () => {
  const source = readFileSync(new URL('./connected-service-review.ts', import.meta.url), 'utf8');
  const at = source.indexOf("stored.reason === 'HASH_REQUIRED'");
  const branch = source.slice(at, at + 320);
  assert.match(branch, /notePersistenceFailure\('evidence\.persist\.hash'/);
  assert.match(branch, /name: 'HashRequired'/);
});
