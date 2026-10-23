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

/** t449u: edge cases — client state must equal the server result for the submitted (CRLF) value. */
const MAX = JURY_CLAIM_MAX_LENGTH;
const edgeCases: Array<{ name: string; value: string; length: number; tooLong: boolean; blank: boolean }> = [
  { name: 'Korean exactly 500', value: '가'.repeat(MAX), length: 500, tooLong: false, blank: false },
  { name: 'Korean 501', value: '가'.repeat(MAX + 1), length: 501, tooLong: true, blank: false },
  { name: 'Korean jamo (decomposed) counts per code unit', value: '\u1100\u1161', length: 2, tooLong: false, blank: false },
  { name: 'ASCII exactly 500', value: 'a'.repeat(MAX), length: 500, tooLong: false, blank: false },
  { name: 'ASCII 501', value: 'a'.repeat(MAX + 1), length: 501, tooLong: true, blank: false },
  { name: 'inner spaces count, outer spaces trimmed', value: `  ${'a b'.repeat(166)}a  `, length: 499, tooLong: false, blank: false },
  { name: '500 + surrounding spaces stays 500', value: `   ${'a'.repeat(MAX)}\t `, length: 500, tooLong: false, blank: false },
  { name: 'LF in the middle = 2', value: `${'a'.repeat(MAX - 2)}\nb`, length: 501, tooLong: true, blank: false },
  { name: 'CRLF in the middle = 2', value: `${'a'.repeat(MAX - 3)}\r\nb`, length: 500, tooLong: false, blank: false },
  { name: 'lone CR = 2', value: 'a\rb', length: 4, tooLong: false, blank: false },
  { name: 'mixed LF/CRLF', value: 'a\nb\r\nc', length: 7, tooLong: false, blank: false },
  { name: 'trailing newlines trimmed', value: 'abc\n\n\r\n', length: 3, tooLong: false, blank: false },
  { name: 'emoji 250 = 500 units', value: '😀'.repeat(250), length: 500, tooLong: false, blank: false },
  { name: 'emoji 251 = 502 units', value: '😀'.repeat(251), length: 502, tooLong: true, blank: false },
  { name: 'ZWJ family emoji = 11 units', value: '👨‍👩‍👧‍👦'.slice(0, 11), length: 11, tooLong: false, blank: false },
  { name: '499 + one emoji = 501', value: `${'a'.repeat(MAX - 1)}😀`, length: 501, tooLong: true, blank: false },
  { name: 'whitespace only (spaces/tabs/newlines)', value: ' \t\n\r\n ', length: 0, tooLong: false, blank: true },
  { name: 'whitespace only (ideographic space U+3000, NBSP)', value: '\u3000\u00a0\u3000', length: 0, tooLong: false, blank: true },
  { name: 'zero-width space is NOT whitespace for trim()', value: '\u200b', length: 1, tooLong: false, blank: false },
];

for (const c of edgeCases) {
  test(`I-031 edge: ${c.name} (client == server)`, () => {
    const state = claimLengthState(c.value);
    assert.equal(state.length, c.length);
    assert.equal(state.tooLong, c.tooLong);
    assert.equal(state.blank, c.blank);
    const server = normalizeReviewClaim(submitted(c.value));
    assert.equal(server.ok, !c.tooLong);
    if (server.ok) {
      assert.equal(server.claim?.length ?? 0, state.length);
      assert.equal(server.claim === undefined, state.blank);
    } else {
      assert.equal(server.reason, 'CLAIM_TOO_LONG');
    }
    const shape = validateReviewRequestShape({ reviewType: 'CLAIM_VALIDATION', claim: submitted(c.value) });
    assert.equal(shape.ok, !c.blank);
    assert.equal(validateReviewRequestShape({ reviewType: 'FULL_REVIEW', claim: submitted(c.value) }).ok, true);
  });
}

test('I-031 edge: limit constant unchanged (500)', () => {
  assert.equal(JURY_CLAIM_MAX_LENGTH, 500);
});
