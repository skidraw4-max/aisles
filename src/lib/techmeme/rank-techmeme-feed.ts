import type Parser from 'rss-parser';
import { titleMatchesAiKeywords } from '@/lib/hackernews/ai-title';
import { extractTechmemeOriginalArticleUrl } from '@/lib/techmeme/extract-original-url';

export type RankedTechmemeItem = {
  title: string;
  /** 원문 기사 URL (fetch·Prisma 중복 키) */
  articleUrl: string;
  /** Techmeme 리버 퍼머링크 */
  riverPermalink: string;
  pubMs: number;
  aiPriority: boolean;
};

function pubMs(item: Parser.Item): number {
  const raw = item.isoDate ?? item.pubDate;
  if (!raw || typeof raw !== 'string') return 0;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

function riverPermalinkFromItem(item: Parser.Item): string | null {
  const link = item.link?.trim();
  if (link && /^https?:\/\/(www\.)?techmeme\.com\//i.test(link)) return link;
  const g = typeof item.guid === 'string' ? item.guid.trim() : '';
  if (g && /^https?:\/\/(www\.)?techmeme\.com\//i.test(g)) return g;
  return null;
}

/**
 * 원문 URL이 추출되는 항목만 남기고, AI 키워드 우선 → pubDate 내림차순 (Lobsters·HN과 동일).
 */
export function rankTechmemeFeedItemsForSync(items: Parser.Item[]): RankedTechmemeItem[] {
  const rows: RankedTechmemeItem[] = [];
  for (const item of items) {
    const title = (item.title ?? '').trim();
    const riverPermalink = riverPermalinkFromItem(item);
    if (!title || !riverPermalink) continue;

    const descHtml =
      (typeof item.content === 'string' && item.content.trim().length > 0
        ? item.content
        : undefined) ??
      (typeof (item as { description?: string }).description === 'string'
        ? (item as { description: string }).description
        : undefined);

    const articleUrl = extractTechmemeOriginalArticleUrl(descHtml);
    if (!articleUrl) continue;

    const aiPriority = titleMatchesAiKeywords(title);
    rows.push({
      title,
      articleUrl,
      riverPermalink,
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
