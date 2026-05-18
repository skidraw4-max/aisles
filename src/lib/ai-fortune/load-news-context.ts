import Parser from 'rss-parser';
import { prisma } from '@/lib/prisma';
import { fetchItemsBatched, fetchTopStoryIds } from '@/lib/hackernews/fetch-top-stories';
import { rankStoriesForSync } from '@/lib/hackernews/rank-stories';
import { rankTechmemeFeedItemsForSync } from '@/lib/techmeme/rank-techmeme-feed';
import { TECHMEME_RSS_URL } from '@/lib/news-sync/external-tech-link-sources';

const FETCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const RSS_PARSER = new Parser({
  customFields: { item: ['description'] },
});

export type AiFortuneNewsHeadline = {
  source: 'Techmeme' | 'Hacker News' | 'AIsle';
  title: string;
  url?: string;
};

export type AiFortuneNewsContext = {
  headlines: AiFortuneNewsHeadline[];
  promptBlock: string;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function fetchTechmemeHeadlines(sinceMs: number): Promise<AiFortuneNewsHeadline[]> {
  try {
    const res = await fetch(TECHMEME_RSS_URL, {
      headers: {
        'User-Agent': FETCH_USER_AGENT,
        Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
      },
      signal: AbortSignal.timeout(25_000),
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const feed = await RSS_PARSER.parseString(xml);
    const ranked = rankTechmemeFeedItemsForSync(feed.items ?? []);
    return ranked
      .filter((r) => r.pubMs >= sinceMs)
      .slice(0, 12)
      .map((r) => ({
        source: 'Techmeme' as const,
        title: r.title,
        url: r.articleUrl,
      }));
  } catch (e) {
    console.warn('[ai-fortune] Techmeme RSS 실패', e);
    return [];
  }
}

async function fetchHnHeadlines(sinceSec: number): Promise<AiFortuneNewsHeadline[]> {
  try {
    const ids = await fetchTopStoryIds(80);
    const items = await fetchItemsBatched(ids, 20);
    const ranked = rankStoriesForSync(items);
    return ranked
      .filter((s) => {
        const item = items.find((i) => i.id === s.id);
        const t = item?.time;
        return typeof t === 'number' && t >= sinceSec;
      })
      .slice(0, 12)
      .map((s) => ({
        source: 'Hacker News' as const,
        title: s.title,
        url: s.url,
      }));
  } catch (e) {
    console.warn('[ai-fortune] HN fetch 실패', e);
    return [];
  }
}

async function fetchAislePostTitles(since: Date): Promise<AiFortuneNewsHeadline[]> {
  const posts = await prisma.post.findMany({
    where: {
      createdAt: { gte: since },
      category: { in: ['LOUNGE', 'RECIPE', 'BUILD'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: { title: true, id: true },
  });
  return posts.map((p) => ({
    source: 'AIsle' as const,
    title: p.title,
  }));
}

/** 지난 7일 RSS·DB 헤드라인 — Gemini 트렌드 분석용 */
export async function loadAiFortuneNewsContext(): Promise<AiFortuneNewsContext> {
  const since = new Date(Date.now() - WEEK_MS);
  const sinceMs = since.getTime();
  const sinceSec = Math.floor(sinceMs / 1000);

  const [techmeme, hn, aisle] = await Promise.all([
    fetchTechmemeHeadlines(sinceMs),
    fetchHnHeadlines(sinceSec),
    fetchAislePostTitles(since),
  ]);

  const headlines = [...techmeme, ...hn, ...aisle].slice(0, 40);
  const lines =
    headlines.length > 0
      ? headlines.map((h, i) => `${i + 1}. [${h.source}] ${h.title}${h.url ? ` (${h.url})` : ''}`)
      : ['(최근 7일 RSS·DB 헤드라인이 비어 있음 — 일반적인 글로벌 AI 동향 지식으로 보완)'];

  return {
    headlines,
    promptBlock: lines.join('\n'),
  };
}
