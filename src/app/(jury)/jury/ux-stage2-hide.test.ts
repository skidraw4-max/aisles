import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { juryDevUi } from '@/lib/jury-product/dev-ui';

// UX Stage 2: Mock and not-yet-implemented controls are hidden from normal users.
const dir = 'src/app/(jury)/jury';
const read = (f: string) => readFileSync(`${dir}/${f}`, 'utf8');

test('dev UI flag is off unless NEXT_PUBLIC_JURY_DEV_UI is 1', () => {
  const prev = process.env.NEXT_PUBLIC_JURY_DEV_UI;
  delete process.env.NEXT_PUBLIC_JURY_DEV_UI;
  assert.equal(juryDevUi(), false);
  process.env.NEXT_PUBLIC_JURY_DEV_UI = '1';
  assert.equal(juryDevUi(), true);
  if (prev === undefined) delete process.env.NEXT_PUBLIC_JURY_DEV_UI; else process.env.NEXT_PUBLIC_JURY_DEV_UI = prev;
});

test('Mock buttons, (준비 중) controls and dev links are gated by juryDevUi', () => {
  const ui = read('ui.tsx');
  const gated = ui.match(/\{juryDevUi\(\) \? \(<><Button variant="secondary" icon=\{Play\} type="submit">재심사 실행 \(Mock\)<\/Button>/g) ?? [];
  assert.equal(gated.length, (ui.match(/재심사 실행 \(Mock\)/g) ?? []).length);
  assert.match(ui, /\{juryDevUi\(\) \? <Button variant="secondary" icon=\{Play\} type="submit">에이전트 실행 \(Mock\)/);
  assert.match(ui, /if \(disabledHint !== undefined\) \{\n\s+if \(!juryDevUi\(\)\) return null;/);
  assert.match(ui, /\{juryDevUi\(\) \? <p><Link className=\{styles\.inline\} href=\{juryHref\('\/discovery'\)\}>/);
  assert.match(ui, /\{juryDevUi\(\) \? <p><Link className=\{styles\.inline\} href=\{juryHref\('\/agents'\)\}>/);
  for (const page of ['discovery/page.tsx', 'agents/page.tsx']) assert.match(read(page), /if \(!juryDevUi\(\)\) notFound\(\);/);
});

test('onboarding hides the mock connection reference and single-choice step, and shows examples', () => {
  const ui = read('service-onboarding-ui.tsx');
  assert.ok(!ui.includes('mock-connection-001'));
  assert.ok(!ui.includes('서비스 선택'));
  assert.match(ui, /<input type="hidden" name="credentialRef" value="manual-entry" \/>/);
  assert.match(ui, /placeholder="예: 우리 쇼핑몰 웹"/);
  assert.match(ui, /placeholder="예: shop-web 또는 https:\/\/shop\.example\.com"/);
});
