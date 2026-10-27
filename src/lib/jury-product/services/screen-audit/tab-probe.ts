/**
 * I-069: in-page probes for same-URL tabs. Run via page.evaluate (self-contained, no closures).
 * TAB_LIST_PROBE tags candidate tabs with TAB_ATTR and returns {index, name, selected}; TAB_CLICK_PROBE DOM-clicks one.
 * Candidates: [role=tab], [aria-controls], a[href^="#"] (not "#" alone with javascript side effects is still same-URL).
 * Excluded: inside <form>, input/submit/reset buttons, disabled/hidden, links to another URL, and cart/buy/pay/
 * logout/delete/save-like text. Names are short visible text only (the caller masks them again).
 */
export const TAB_ATTR = 'data-jury-tab';

export const TAB_UNSAFE_TEXT_SOURCE =
  '(장바구니|담기|구매|주문|결제|로그아웃|탈퇴|삭제|제거|저장|등록|신청|제출|전송|해지|취소|환불|cart|buy|order|checkout|pay|logout|log out|sign out|delete|remove|save|submit|send|apply)';

type El = {
  getAttribute(n: string): string | null;
  setAttribute(n: string, v: string): void;
  removeAttribute(n: string): void;
  closest(s: string): unknown;
  matches(s: string): boolean;
  tagName: string;
  textContent: string | null;
  getBoundingClientRect(): { width: number; height: number };
  click(): void;
};

export const TAB_LIST_PROBE = (arg: { attr: string; limit: number; unsafe: string }) => {
  const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<El> } }).document;
  const unsafe = new RegExp(arg.unsafe, 'i');
  for (const el of Array.from(doc.querySelectorAll(`[${arg.attr}]`))) el.removeAttribute(arg.attr);
  const out: { index: number; name: string; selected: boolean }[] = [];
  const seen = new Set<unknown>();
  for (const el of Array.from(doc.querySelectorAll('[role="tab"], [aria-controls], a[href^="#"]'))) {
    if (out.length >= arg.limit) break;
    if (seen.has(el)) continue;
    seen.add(el);
    if (el.closest('form')) continue;
    if (el.matches('input, select, textarea, [type="submit"], [type="reset"], [disabled], [aria-disabled="true"]')) continue;
    const tag = el.tagName.toLowerCase();
    const href = el.getAttribute('href');
    if (tag === 'a' && href !== null && !href.startsWith('#')) continue;
    if (el.getAttribute('onclick') && /location|submit|href|open\(/i.test(el.getAttribute('onclick') || '')) continue;
    const name = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name || unsafe.test(name)) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const index = out.length;
    el.setAttribute(arg.attr, String(index));
    out.push({ index, name, selected: el.getAttribute('aria-selected') === 'true' });
  }
  return out;
};

export const TAB_CLICK_PROBE = (arg: { attr: string; index: number }) => {
  const doc = (globalThis as unknown as { document: { querySelector(s: string): El | null } }).document;
  const el = doc.querySelector(`[${arg.attr}="${arg.index}"]`);
  if (!el) return false;
  el.click();
  return true;
};
