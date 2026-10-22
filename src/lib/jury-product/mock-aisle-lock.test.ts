import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { mockAisleAbsolute, withMockAisleLock } from './mock-aisle-lock';

test('mock aisle lock serializes holders and stays on the allowlisted path', async () => {
  const absolute = mockAisleAbsolute();
  assert.equal(path.basename(absolute), 'mock-aisle');
  assert.equal(path.basename(path.dirname(absolute)), 'workspaces');
  let entered = false;
  let releaseFirst: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const first = withMockAisleLock(async () => {
    entered = true;
    await gate;
  });
  while (!entered) await new Promise((resolve) => setTimeout(resolve, 5));
  let secondStarted = false;
  const second = withMockAisleLock(async () => {
    secondStarted = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(secondStarted, false);
  releaseFirst();
  await first;
  await second;
  assert.equal(secondStarted, true);
});
