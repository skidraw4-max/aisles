import type Parser from 'rss-parser';
import { titleMatchesAiKeywords } from '@/lib/hackernews/ai-title';

export type RankedLobstersItem = {
  title: string;
  /** 외부 기사 URL (원문 fetch·중복 키) */
  articleUrl: string;
  /** Lobsters 토론 스레드 URL */
  discussionUrl: string;
  pubMs: number;
  aiPriority: boolean;
};

function pubMs(item: Parser.Item): number {
  const raw = item.isoDate ?? item.pubDate;
  if (!raw || typeof raw !== 'string') return 0;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

/** Lobsters `link`가 lobste.rs 자체 스토리가 아닌 외부 http(s) URL인지 */
export function isExternalArticleUrlForLobsters(raw: string | undefined): raw is string {
  if (!raw || typeof raw !== 'string') return false;
  const s = raw.trim();
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    return host !== 'lobste.rs' && host !== 'www.lobste.rs';
  } catch {
    return false;
  }
}

function discussionUrlFromItem(item: Parser.Item): string | null {
  const raw = item as Record<string, unknown>;
  const c = typeof raw.comments === 'string' ? raw.comments.trim() : '';
  if (c && /^https?:\/\/(www\.)?lobste\.rs\//i.test(c)) return c;
  const g = typeof item.guid === 'string' ? item.guid.trim() : '';
  if (g && /^https?:\/\/(www\.)?lobste\.rs\//i.test(g)) return g;
  return null;
}

/**
 * RSS 항목 중 외부 URL·토론 링크가 있는 것만 남기고,
 * HN `rankStoriesForSync`와 같이 AI 키워드 우선 → 그다음 pubDate 내림차순.
 */
export function rankLobstersFeedItemsForSync(items: Parser.Item[]): RankedLobstersItem[] {
  const rows: RankedLobstersItem[] = [];
  for (const item of items) {
    const title = (item.title ?? '').trim();
    const articleUrl = item.link?.trim();
    if (!title || !isExternalArticleUrlForLobsters(articleUrl)) continue;
    const discussionUrl = discussionUrlFromItem(item);
    if (!discussionUrl) continue;
    const aiPriority = titleMatchesAiKeywords(title);
    rows.push({
      title,
      articleUrl,
      discussionUrl,
      pubMs: pubMs(item),
      aiPriority,
    });
  }
  rows.sort((a, b) => {
    if (a.aiPriority !== b.aiPriority) return a.aiPriority ? -1 : 1;
    return b.pubMs - a.pubMs;
  });
  return rows;
}
