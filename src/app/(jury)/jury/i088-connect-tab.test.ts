import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const read = (f: string) => readFileSync(join(dir, f), 'utf8');
const css = read('jury.module.css');
const rule = (sel: string) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `${sel} defined`);
  return m![1];
};

test('1-1: inputs match other fields (44px, 10px 12px, 16px); width scoped to connectForm', () => {
  const wrapInput = css.match(/\.wrap input:not\([^{]*\{([^}]*)\}/)![1];
  assert.match(wrapInput, /min-height: 44px/);
  assert.match(wrapInput, /padding: 10px 12px/);
  assert.match(wrapInput, /font-size: 16px/);
  assert.doesNotMatch(wrapInput, /max-width/);
  assert.match(css, /\.connectForm input:not[^{]*\{[^}]*width: 100%; max-width: 28rem/);
});

test('1-2/2-1/2-4/2-5: phase1 forms use Button, grid forms, resultList, issueResult', () => {
  const f = read('phase1-forms.tsx');
  assert.doesNotMatch(f, /<button/);
  assert.match(f, /variant="primary"[^>]*>\{pending \? '발급 중…' : '확인 값 발급'\}/);
  assert.match(f, /variant="primary"[^>]*>\{pending \? '확인 중…' : '권한 확인 후 연결'\}/);
  assert.match(f, /variant="secondary"[^>]*>\{pending \? '확인 중…' : '지금 확인'\}/);
  assert.equal(f.match(/className=\{styles\.connectForm\}/g)?.length, 2);
  assert.equal(f.match(/<ul className=\{styles\.resultList\}/g)?.length, 2);
  assert.match(f, /className=\{styles\.issueResult\}/);
  assert.match(rule('.connectForm'), /display: grid; gap: 16px/);
  assert.match(css, /\.connectForm fieldset \{ display: grid; gap: 8px; margin: 0; padding: 12px 16px/);
  assert.match(css, /\.connectForm fieldset label, \.connectCheck \{[^}]*min-height: 44px/);
  assert.match(rule('.issueResult'), /gap: 8px; padding: 12px 16px/);
});

test('2-2/2-7/2-9/2-10/2-11: spacing tokens', () => {
  assert.match(css, /\.wrap label:has\(> input[^{]*\{ display: grid; gap: 8px;/);
  const panel = rule('.panel');
  assert.match(panel, /padding: 24px;/);
  assert.match(panel, /margin-bottom: 16px;/);
  assert.match(rule('.panel h2'), /margin: 0 0 16px;/);
  const h3 = rule('.panel h3');
  assert.match(h3, /margin: 24px 0 8px;/);
  assert.match(h3, /padding-top: 16px;/);
  assert.match(h3, /border-top: 1px solid var\(--jury-border\)/);
  assert.match(css, /\.panel h2 \+ h3, \.panel > h3:first-child \{ margin-top: 0; padding-top: 0; border-top: 0; \}/);
  assert.match(rule('.stepCard'), /padding: 16px;[\s\S]*margin: 0 0 12px;/);
  assert.match(rule('.fieldHelp'), /margin: 4px 0 16px;/);
  assert.match(rule('.technicalDetails'), /margin-top: 16px;[\s\S]*padding-top: 12px;/);
});

test('3-1/3-4: InfoTable 항목 | 값 | 상태 with faint AA dash + srOnly when empty', () => {
  const t = read('info-table.tsx');
  for (const h of ['항목', '값', '상태']) assert.match(t, new RegExp(`<th scope="col">${h}</th>`));
  assert.match(t, /<th scope="row">/);
  assert.match(t, /<span aria-hidden="true" className=\{styles\.noStatus\}>—<\/span>/);
  assert.match(t, /<span className=\{styles\.srOnly\}>\{label\}<\/span>/);
  assert.match(t, /label = '상태 없음'/);
  const ns = rule('.noStatus');
  assert.match(ns, /var\(--jury-text-muted, #a8b5c9\)/);
  assert.doesNotMatch(ns, /opacity/);
  assert.doesNotMatch(t, /useState|useEffect|'use client'/);
  assert.match(css, /@media \(max-width: 600px\) \{[\s\S]*\.infoTable tr \{ display: grid; grid-template-columns: 1fr auto;/);
  assert.match(css, /\.infoTable tbody th, \.infoTable td \{[^}]*height: 40px|\.infoTable td \{ height: 40px/);
});

test('3-1/3-3/3-5: connect settings table, 연결 준비 list, label rename', () => {
  const ops = read('service-operations-ui.tsx');
  assert.match(ops, /<InfoTable caption="연결 설정">/);
  for (const l of ['제공자', '연결 방식', '접근 방식', '자격 증명 상태', '연결 상태', '수명 주기', '준비 상태', '연결 점검', '기능']) {
    assert.match(ops, new RegExp(`<InfoRow label="${l}"`), l);
  }
  assert.doesNotMatch(ops, /연결 상태 점검/);
  assert.match(ops, /<InfoList label="연결 준비">/);
  for (const l of ['서비스 확인', '범위', '연결']) assert.match(ops, new RegExp(`<InfoItem term="${l}"><StatusBadge`), l);
  const onb = read('service-onboarding-ui.tsx');
  assert.match(onb, /<InfoTable caption="서비스 확인">/);
  assert.match(onb, /<InfoRow key=\{item\.metric\} label=\{metricLabel\(item\.metric\)\} value=\{reasonDisplay\(item\.reason\)\}/);
});

test('3-2: ownership records render as 도메인 | 상태 | 마지막 확인 | 동작 table', () => {
  const s = read('phase1-sections.tsx');
  for (const h of ['도메인', '상태', '마지막 확인', '동작']) assert.match(s, new RegExp(`<th scope="col">${h}</th>`));
  assert.match(s, /<td>\s*\{r\.status === 'PENDING'[\s\S]*<OwnershipVerifyButton/);
  assert.match(s, /<StatusBadge status=\{r\.status\}/);
  assert.doesNotMatch(s, /습니다|십시오/);
});
