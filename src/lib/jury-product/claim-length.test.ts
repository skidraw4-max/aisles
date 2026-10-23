import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimLengthForServer, claimLengthState } from './claim-length';
import { JURY_CLAIM_MAX_LENGTH, normalizeReviewClaim, validateReviewRequestShape } from './records';

/** What the server receives for a textarea value (line breaks submitted as CRLF). */
const submitted = (value: string) => value.replace(/\r\n|\r|\n/g, '\r\n');

const samples: string[] = [
  '',
  '   ',
  '\n\t \n',
  '가입자가 두 배 증가했다',
  '  앞뒤 공백  ',
  'a'.repeat(JURY_CLAIM_MAX_LENGTH),
  'a'.repeat(JURY_CLAIM_MAX_LENGTH + 1),
  `  ${'가'.repeat(JURY_CLAIM_MAX_LENGTH)}  `,
  `${'a'.repeat(JURY_CLAIM_MAX_LENGTH - 1)}\nb`,
  `${'a'.repeat(JURY_CLAIM_MAX_LENGTH - 2)}\nb`,
  '😀'.repeat(250),
  '😀'.repeat(251),
];

test('I-031: client counter agrees with the server trim + 500 limit', () => {
  for (const value of samples) {
    const state = claimLengthState(value);
    const server = normalizeReviewClaim(submitted(value));
    assert.equal(state.tooLong, !server.ok, `tooLong mismatch for length ${value.length}`);
    if (server.ok) {
      assert.equal(state.blank, server.claim === undefined);
      assert.equal(state.length, server.claim?.length ?? 0);
    }
  }
});

test('I-031: whitespace-only claim still rejected for CLAIM_VALIDATION', () => {
  for (const value of ['', '   ', '\n\t']) {
    assert.equal(claimLengthState(value).blank, true);
    assert.deepEqual(validateReviewRequestShape({ reviewType: 'CLAIM_VALIDATION', claim: submitted(value) }), { ok: false, reason: 'CLAIM_REQUIRED' });
  }
});

test('I-031: a line break counts as two (CRLF), surrogate pairs as two code units', () => {
  assert.equal(claimLengthForServer('a\nb'), 4);
  assert.equal(claimLengthForServer('a\r\nb'), 4);
  assert.equal(claimLengthForServer('😀'), 2);
  assert.equal(claimLengthForServer('  x  '), 1);
});
