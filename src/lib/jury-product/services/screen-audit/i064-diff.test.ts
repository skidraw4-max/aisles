import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffAudits } from './view-model';

const f = (rule: string, viewport = 'MOBILE', path = '/a') => ({ rule, viewport, path, message: rule });

test('I-064: fixed / remaining / added by rule+viewport+path', () => {
  const d = diffAudits([f('CONTRAST_LOW'), f('TAP_TARGET_SMALL')], [f('TAP_TARGET_SMALL'), f('TEXT_CLIPPED', 'DESKTOP')]);
  assert.deepEqual(d.fixed.map((x) => x.rule), ['CONTRAST_LOW']);
  assert.deepEqual(d.remaining.map((x) => x.rule), ['TAP_TARGET_SMALL']);
  assert.deepEqual(d.added.map((x) => x.rule), ['TEXT_CLIPPED']);
});

test('I-064: a finding on a page not measured again is not called fixed', () => {
  const d = diffAudits([f('CONTRAST_LOW', 'MOBILE', '/b')], [], new Set(['MOBILE|/a']));
  assert.equal(d.fixed.length, 0);
});
