/** RM-09 (I-004, I-010): period validation + multi-metric console intake. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildConsoleIntakeInput, consoleIntakeRowsFromForm } from './console-evidence-intake';
import { defaultEvidencePeriod, intakePeriodDefaults, validateEvidencePeriod } from './evidence-period';
import { buildReviewDisplayModel } from './review-display-model';
import { buildResultDetailView } from './review-result-detail';

const NOW = new Date('2026-10-22T03:00:00.000Z'); // 12:00 KST

test('default period is the shared 7-day window ending yesterday (KST)', () => {
  assert.deepEqual(defaultEvidencePeriod(NOW), { start: '2026-10-15', end: '2026-10-21', timezone: 'Asia/Seoul' });
  assert.equal(intakePeriodDefaults(NOW).today, '2026-10-22');
});

test('period validation: order, future, calendar, max 92 days', () => {
  assert.equal(validateEvidencePeriod('2026-10-01', '2026-10-21', NOW).ok, true);
  assert.equal(validateEvidencePeriod('2026-10-22', '2026-10-22', NOW).ok, true);
  for (const [s, e] of [['2026-10-21', '2026-10-01'], ['2026-10-01', '2026-10-23'], ['2026-02-30', '2026-03-01'], ['2026-07-01', '2026-10-21'], ['20261001', '2026-10-02'], ['', '']]) {
    assert.deepEqual(validateEvidencePeriod(s, e, NOW), { ok: false, reason: 'INVALID_PERIOD' }, `${s}~${e}`);
  }
  const max = validateEvidencePeriod('2026-07-22', '2026-10-21', NOW);
  assert.equal(max.ok && max.days, 92);
});

const base = { userId: 'u', memberships: [], connectionId: 'c', scopeId: 's', now: NOW.toISOString() };

test('multi-metric intake keeps every row, with user period', () => {
  const built = buildConsoleIntakeInput({
    ...base,
    metrics: [
      { metric: 'newUsersLast7d', availability: 'AVAILABLE', value: '0' },
      { metric: 'postsLast7d', availability: 'NOT_MEASURED', value: '' },
      { metric: 'userCount', availability: 'AVAILABLE', value: '12.5' },
    ],
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.intake.metrics.length, 3);
  assert.deepEqual(built.intake.metrics.map((m) => m.value), [0, null, 12.5]); // measured zero stays 0
  assert.equal(built.intake.periodStart, '2026-09-01');
  assert.equal(built.intake.periodEnd, '2026-09-30');
});

test('intake rejects duplicate metrics, empty rows, bad period; legacy single-metric still works', () => {
  assert.deepEqual(buildConsoleIntakeInput({ ...base, metrics: [] }), { ok: false, reason: 'INVALID_VALUE' });
  assert.deepEqual(buildConsoleIntakeInput({ ...base, metrics: [
    { metric: 'a', availability: 'AVAILABLE', value: '1' }, { metric: 'a', availability: 'AVAILABLE', value: '2' },
  ] }), { ok: false, reason: 'INVALID_VALUE' });
  assert.deepEqual(buildConsoleIntakeInput({ ...base, metrics: [{ metric: 'a', availability: 'AVAILABLE', value: '1' }], periodStart: '2026-10-21', periodEnd: '2026-10-01' }), { ok: false, reason: 'INVALID_PERIOD' });
  assert.deepEqual(buildConsoleIntakeInput({ ...base, metrics: [{ metric: 'a', availability: 'AVAILABLE', value: '1' }], periodStart: '2026-10-01' }), { ok: false, reason: 'INVALID_PERIOD' });
  const legacy = buildConsoleIntakeInput({ ...base, metric: 'a', availability: 'AVAILABLE', value: '3' });
  assert.equal(legacy.ok && legacy.intake.periodStart, '2026-10-15');
});

test('form rows: "포함 안 함" (empty availability) rows are skipped, not stored as zero', () => {
  const form: Record<string, string> = { 'availability:a': 'AVAILABLE', 'value:a': '4', 'availability:b': '', 'value:b': '9', 'availability:c': 'NOT_MEASURED' };
  assert.deepEqual(consoleIntakeRowsFromForm(['a', 'b', 'c'], (k) => form[k] ?? ''), [
    { metric: 'a', availability: 'AVAILABLE', value: '4' },
    { metric: 'c', availability: 'NOT_MEASURED', value: '' },
  ]);
});

test('multi-metric evidence shows scope count and lists NOT_MEASURED as 미검사, never "no problem"', () => {
  const display = buildReviewDisplayModel({
    result: { id: 'r', expectedDecision: 'VERIFY', finalSurface: { statusSummary: 's', topProblems: ['p'], expectedUserEffect: '', risk: '', dimensionEvidence: [], supportedClaims: ['x'], partiallySupportedClaims: [], hypotheses: [] } },
    request: { status: 'COMPLETED' },
    evidence: { id: 'e', metricIds: ['newUsersLast7d', 'postsLast7d', 'userCount'], metrics: [
      { metric: 'newUsersLast7d', availability: 'AVAILABLE' },
      { metric: 'postsLast7d', availability: 'NOT_MEASURED' },
      { metric: 'userCount', availability: 'AVAILABLE' },
    ] },
  });
  const v = buildResultDetailView(display);
  assert.equal(v.summary.facts.find((f) => f.label === '검사 범위')?.value, '지표 3개 · 미검사 1개');
  assert.deepEqual(v.unchecked.items, ['postsLast7d']);
});

test('no hardcoded 2026-09-01~09-07 collection period remains in jury UI', () => {
  for (const file of ['service-operations-ui.tsx', 'service-onboarding-ui.tsx', 'ui.tsx']) {
    const text = readFileSync(`src/app/(jury)/jury/${file}`, 'utf8');
    assert.equal(/value="2026-09-0[17]"/.test(text), false, file);
  }
});
