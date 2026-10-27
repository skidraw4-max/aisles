import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isSelectableAccessMethod, selectableAccessMethods } from './selectable-methods';
import { JURY_ACCESS_METHODS } from '../records';

test('I-071: only implemented methods are selectable', () => {
  assert.deepEqual(selectableAccessMethods({ readonlyAccount: true }).map((m) => m.value), ['READ_ONLY_ACCOUNT']);
  assert.deepEqual(selectableAccessMethods({ readonlyAccount: false }), []);
  for (const m of ['OAUTH', 'API_KEY', 'BROWSER_SESSION', 'FILE_UPLOAD']) assert.equal(isSelectableAccessMethod(m, { readonlyAccount: true }), false);
});

test('I-071: enum values are kept for existing connections', () => {
  for (const m of ['OAUTH', 'API_KEY', 'READ_ONLY_ACCOUNT', 'BROWSER_SESSION', 'FILE_UPLOAD']) assert.ok((JURY_ACCESS_METHODS as readonly string[]).includes(m));
});

test('I-071: onboarding select no longer lists every enum value or defaults to FILE_UPLOAD', () => {
  const src = readFileSync('src/app/(jury)/jury/service-onboarding-ui.tsx', 'utf8');
  assert.ok(!src.includes('defaultValue="FILE_UPLOAD"'));
  assert.ok(!src.includes('JURY_ACCESS_METHODS.map'));
  assert.ok(src.includes('selectableAccessMethods()'));
});

test('I-071: server actions reject non-selectable methods', () => {
  const src = readFileSync('src/app/(jury)/jury/actions.ts', 'utf8');
  assert.equal(src.match(/isSelectableAccessMethod\(accessMethod\)/g)?.length, 2);
});
