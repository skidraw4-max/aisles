import * as cheerio from 'cheerio';

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'a',
  'img',
  'strong',
  'em',
  'b',
  'i',
  'ul',
  'ol',
  'li',
  'h2',
  'h3',
  'span',
  'div',
]);

const IMG_ATTRS = new Set(['src', 'alt', 'width', 'height', 'title']);
const LINK_ATTRS = new Set(['href', 'target', 'rel']);

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}

function looksLikeHtml(content: string): boolean {
  return /<[a-z][\s\S]*>/i.test(content);
}

/** 공지 본문 HTML — 허용 태그만 유지하고 외부 링크에 target="_blank" 적용 */
export function sanitizeNoticeHtml(content: string): string {
  const $ = cheerio.load(content);
  const root = $.root();

  root.find('*').each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    if (!tag || !ALLOWED_TAGS.has(tag)) {
      $(el).replaceWith($(el).html() ?? '');
      return;
    }

    const attribs = { ...el.attribs };
    for (const name of Object.keys(attribs)) {
      const lower = name.toLowerCase();
      if (tag === 'img' && !IMG_ATTRS.has(lower)) {
        delete el.attribs[name];
      } else if (tag === 'a' && !LINK_ATTRS.has(lower)) {
        delete el.attribs[name];
      } else if (tag !== 'img' && tag !== 'a') {
        delete el.attribs[name];
      }
    }

    if (tag === 'a') {
      const href = (el.attribs.href ?? '').trim();
      if (!href) {
        $(el).replaceWith($(el).html() ?? '');
        return;
      }
      if (isExternalHref(href)) {
        el.attribs.target = '_blank';
        el.attribs.rel = 'noopener noreferrer';
      } else {
        delete el.attribs.target;
        delete el.attribs.rel;
      }
    }

    if (tag === 'img') {
      const src = (el.attribs.src ?? '').trim();
      if (!src) {
        $(el).remove();
      }
    }
  });

  return root.html()?.trim() ?? '';
}

export type PreparedNoticeContent =
  | { mode: 'text'; text: string }
  | { mode: 'html'; html: string };

/** 공지 본문 — 일반 텍스트 또는 제한된 HTML */
export function prepareNoticeContent(content: string): PreparedNoticeContent {
  const trimmed = content.trim();
  if (!trimmed) {
    return { mode: 'text', text: '' };
  }
  if (!looksLikeHtml(trimmed)) {
    return { mode: 'text', text: trimmed };
  }
  return { mode: 'html', html: sanitizeNoticeHtml(trimmed) };
}
