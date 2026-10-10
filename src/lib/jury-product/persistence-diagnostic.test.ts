import assert from 'node:assert/strict';
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
