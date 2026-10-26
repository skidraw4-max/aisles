import assert from 'node:assert/strict';
import { test } from 'node:test';
import { areaRows, formatKst, STATUS_LABEL, stopText } from './view-model';

test('I-063: area rows desktop first, area order fixed, junk dropped', () => {
  const rows = areaRows({ areas: [
    { area: 'A11Y', viewport: 'MOBILE', status: 'PASS', findings: 0 },
    { area: 'MOBILE', viewport: 'MOBILE', status: 'FAIL', findings: 2 },
    { area: 'LAYOUT', viewport: 'DESKTOP', status: 'NOT_TESTED', findings: 0 },
    { bogus: 1 },
  ] });
  assert.deepEqual(rows.map((r) => `${r.viewport}/${r.area}`), ['DESKTOP/LAYOUT', 'MOBILE/MOBILE', 'MOBILE/A11Y']);
  assert.deepEqual(areaRows(null), []);
});

test('I-063: NOT_TESTED / BLOCKED never read as 통과', () => {
  assert.notEqual(STATUS_LABEL.NOT_TESTED, STATUS_LABEL.PASS);
  assert.notEqual(STATUS_LABEL.BLOCKED, STATUS_LABEL.PASS);
});

test('I-063: KST formatting and stop text', () => {
  assert.equal(formatKst(new Date('2026-10-26T14:05:00Z')), '2026-10-26 23:05 KST');
  assert.match(stopText({ stop: 'CHALLENGE_REQUIRED' }) ?? '', /2단계/);
  assert.equal(stopText({}), null);
});
