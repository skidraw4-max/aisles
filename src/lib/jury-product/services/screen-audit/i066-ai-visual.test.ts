import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateVisual, SCREEN_AUDIT_AI_ENABLED } from './ai-visual';

const key = `t1/a1/${'a'.repeat(64)}.jpg`;
const input = { shots: [{ storageKey: key, viewport: 'MOBILE', path: '/a' }, { storageKey: '../etc/passwd', viewport: 'MOBILE', path: '/x' }], metrics: [] };

test('I-066: AI visual evaluation is OFF by default and never calls an evaluator', async () => {
  assert.equal(SCREEN_AUDIT_AI_ENABLED, false);
  let called = 0;
  const r = await evaluateVisual(input, { evaluator: async () => { called++; return []; } });
  assert.deepEqual(r, { state: 'OFF' });
  assert.equal(called, 0);
});

test('I-066: enabled without an evaluator is NOT_CONFIGURED (no default paid client)', async () => {
  assert.deepEqual(await evaluateVisual(input, { enabled: true }), { state: 'NOT_CONFIGURED' });
});

test('I-066: fake evaluator gets only valid masked keys; errors are contained', async () => {
  let seen: string[] = [];
  const r = await evaluateVisual(input, { enabled: true, evaluator: async (i) => { seen = i.shots.map((s) => s.storageKey); return [{ viewport: 'MOBILE', path: '/a', note: 'x'.repeat(500) }]; } });
  assert.deepEqual(seen, [key]);
  assert.equal(r.state, 'DONE');
  if (r.state === 'DONE') assert.equal(r.notes[0].note.length, 300);
  assert.deepEqual(await evaluateVisual(input, { enabled: true, evaluator: async () => { throw new Error('boom'); } }), { state: 'ERROR' });
});
