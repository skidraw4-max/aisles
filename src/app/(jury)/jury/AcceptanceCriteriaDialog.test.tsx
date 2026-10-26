import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AcceptanceCriteriaDialog } from './AcceptanceCriteriaDialog';

const mockCriteria = ['Lighthouse 성능 점수 90 이상', '  모바일 480px에서 가로 스크롤 없음 ', '', 'CTA 버튼 대비 4.5:1 이상'];

test('acceptance criteria renders a 확인하기 button and an accessible modal list', () => {
  const html = renderToStaticMarkup(createElement(AcceptanceCriteriaDialog, { criteria: mockCriteria, classes: { button: 'btn' } }));
  assert.match(html, /<button[^>]*class="btn"[^>]*aria-haspopup="dialog"[^>]*>확인하기<\/button>/);
  assert.match(html, /<dialog[^>]*aria-modal="true"[^>]*aria-labelledby="([^"]+)"/);
  const labelledBy = html.match(/aria-labelledby="([^"]+)"/)![1];
  assert.match(html, new RegExp(`<h3 id="${labelledBy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>완료 기준</h3>`));
  const items = [...html.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1]);
  assert.deepEqual(items, ['Lighthouse 성능 점수 90 이상', '모바일 480px에서 가로 스크롤 없음', 'CTA 버튼 대비 4.5:1 이상']);
  assert.match(html, /aria-label="닫기"/);
  assert.doesNotMatch(html, /, /);
});

test('acceptance criteria with no items renders a dash and no dialog', () => {
  const html = renderToStaticMarkup(createElement(AcceptanceCriteriaDialog, { criteria: ['', ' '] }));
  assert.equal(html, '<span>—</span>');
});
