import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { userLabel } from '@/lib/jury-product/ui-labels';

// UX Stage 1: every Jury UI file speaks 해요체 Korean and shows labels, not raw enum values.
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });
}
const files = [...walk('src/app/(jury)'), ...walk('src/components/jury')];
const source = (f: string) => readFileSync(f, 'utf8')
  .split('\n')
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n');

test('UX-1: Jury UI files use 해요체 (no ~니다 endings)', () => {
  assert.ok(files.length > 30);
  for (const f of files) assert.doesNotMatch(source(f), /[가-힣]니다/, f);
});

test('UX-1: no English sentences in Jury UI copy (proper nouns allowed)', () => {
  const sentence = /(>|'|")[A-Z][a-z]+( [a-zA-Z,.'’-]+){3,}[.!]?(<|'|")/;
  for (const f of files) {
    const hits = source(f).split('\n').filter((line) => sentence.test(line) && !/className=|import |console\.|throw new/.test(line));
    assert.deepEqual(hits, [], f);
  }
});

test('UX-1: internal words are not shown to users', () => {
  for (const f of files) {
    const s = source(f);
    assert.doesNotMatch(s, /'Not authorized'/, f);
    assert.doesNotMatch(s, /[가-힣] ?tenant|tenant[가-힣]|>[^<{\n]*tenant[^<{\n]*</, f);
    assert.doesNotMatch(s, /Human Decision을|판정|리뷰/, f);
  }
});

test('UX-1: enum values render as Korean labels', () => {
  for (const v of ['VERIFICATION', 'HANDED_OFF', 'NEEDS_APPROVAL', 'DONE', 'STOPPED', 'MANUAL', 'BLOCK', 'LOW', 'HIGH', 'CRITICAL', 'NOT_TESTED']) {
    assert.match(userLabel(v), /[가-힣]/, v);
  }
  const ui = readFileSync('src/app/(jury)/jury/ui.tsx', 'utf8');
  for (const raw of ['{screen.agentExecution.status}', '{execution.status}', '{screen.reReview.status}', '{screen.reReview.decision}', '{task.status}</p>', '{screen.changeGate.errorCode}', '{task.taskType}</p>', '>{event.timestamp}<']) {
    assert.equal(ui.includes(raw), false, raw);
  }
  const ops = readFileSync('src/app/(jury)/jury/operations/page.tsx', 'utf8');
  assert.ok(ops.includes('{userLabel(r.reason)}'));
});
