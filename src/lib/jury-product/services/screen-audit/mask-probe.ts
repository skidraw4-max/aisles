/**
 * I-060: masking before capture. Opaque overlays are placed over every form control, elements marked private, profile
 * images and any text that looks like personal data (email, phone, long digit runs, resident numbers) or sits in a
 * name/user/member/phone/email/address container. Overlays are removed right after the screenshot (DOM text untouched).
 * Runs in the page; returns counts only.
 */
export const MASK_ATTR = 'data-jury-mask';

export const MASK_PROBE = (attr: string): { masked: number; ok: boolean } => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  const doc = g.document;
  const PII = [/[\w.+-]+@[\w-]+\.[\w.]+/, /01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/, /\d{6}\s?-\s?[1-4]\d{6}/, /\d[\d\s-]{5,}\d/];
  const HINT = /(name|user|member|nick|phone|mobile|tel|email|mail|addr|account|profile|이름|회원|연락처|주소)/i;
  const targets = new Set<any>();
  const add = (el: any) => {
    const r = el.getBoundingClientRect();
    if (r.width >= 1 && r.height >= 1) targets.add(el);
  };
  for (const el of Array.from(doc.querySelectorAll('input, textarea, select, [contenteditable="true"], [data-private], [data-sensitive], img[src*="avatar" i], img[src*="profile" i], img[alt*="profile" i]'))) add(el);
  for (const el of Array.from(doc.querySelectorAll('body *')).slice(0, 5000) as any[]) {
    if (el.childElementCount > 0) continue;
    const text = (el.textContent || '').trim();
    if (!text) continue;
    const hint = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''} ${el.parentElement?.className && typeof el.parentElement.className === 'string' ? el.parentElement.className : ''}`;
    if (PII.some((re) => re.test(text)) || HINT.test(hint)) add(el);
  }
  let made = 0;
  for (const el of targets) {
    const r = el.getBoundingClientRect();
    const o = doc.createElement('div');
    o.setAttribute(attr, '1');
    o.style.cssText = `position:absolute;left:${r.left + g.scrollX - 2}px;top:${r.top + g.scrollY - 2}px;width:${r.width + 4}px;height:${r.height + 4}px;background:#111;z-index:2147483647;pointer-events:none;`;
    doc.body.appendChild(o);
    made += 1;
  }
  const present = doc.querySelectorAll(`[${attr}]`).length;
  return { masked: made, ok: present === made };
};

export const UNMASK_PROBE = (attr: string): number => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = (globalThis as any).document;
  const list = Array.from(doc.querySelectorAll(`[${attr}]`)) as any[];
  for (const el of list) el.remove();
  return list.length;
};
