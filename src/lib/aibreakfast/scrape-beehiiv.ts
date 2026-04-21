import axios from 'axios';
import * as cheerio from 'cheerio';
import { htmlToPlainText } from '@/lib/geeknews/extract-article-text';

export const AI_BREAKFAST_HOME = 'https://aibreakfast.beehiiv.com/';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

export async function fetchHtml(url: string): Promise<{ ok: true; html: string } | { ok: false; message: string }> {
  try {
    const res = await axios.get<string>(url, {
      headers: BROWSER_HEADERS,
      timeout: 28_000,
      responseType: 'text',
      validateStatus: (s) => s >= 200 && s < 400,
    });
    if (res.status >= 400) {
      return { ok: false, message: `HTTP ${res.status}` };
    }
    return { ok: true, html: res.data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}

/** 메인 페이지에서 `/p/`가 포함된 첫 번째 포스트 링크 (DOM 순서상 최상단 후보) */
export function extractLatestPostPathFromMain(html: string, baseUrl: string): string | null {
  const $ = cheerio.load(html);
  const el = $('a[href*="/p/"]').first();
  const href = el.attr('href');
  if (!href?.includes('/p/')) return null;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

/** 출처 로고·대표 이미지 URL (https만 — 썸네일·CTA용) */
export function extractSiteLogoUrl(html: string, baseUrl: string): string | null {
  const $ = cheerio.load(html);
  const candidates = [
    $('link[rel="apple-touch-icon"]').attr('href'),
    $('link[rel="icon"]').first().attr('href'),
    $('meta[property="og:image"]').attr('content'),
  ];
  for (const raw of candidates) {
    if (!raw?.trim()) continue;
    try {
      const abs = new URL(raw.trim(), baseUrl).href;
      if (abs.toLowerCase().startsWith('https://')) return abs.slice(0, 2048);
    } catch {
      /* next */
    }
  }
  return null;
}

/** 상세 페이지에서 뉴스레터 본문 텍스트 추출 */
export function extractNewsletterPlainText(html: string): string {
  const $ = cheerio.load(html);
  const postContent = $('.post-content').first();
  if (postContent.length) {
    return htmlToPlainText(postContent.html() ?? '');
  }
  const main = $('main').first();
  if (main.length) {
    return htmlToPlainText(main.html() ?? '');
  }
  const article = $('article').first();
  if (article.length) {
    return htmlToPlainText(article.html() ?? '');
  }
  return htmlToPlainText($.html());
}
