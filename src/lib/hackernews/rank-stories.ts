import { titleMatchesAiKeywords } from '@/lib/hackernews/ai-title';
import type { HackerNewsItem } from '@/lib/hackernews/types';

export type RankedStory = {
  id: number;
  title: string;
  url: string;
  score: number;
  aiPriority: boolean;
};

function isStoryWithUrl(item: HackerNewsItem): item is HackerNewsItem & { title: string; url: string } {
  if (item.type !== 'story') return false;
  const title = item.title?.trim();
  const url = item.url?.trim();
  if (!title || !url) return false;
  return /^https?:\/\//i.test(url);
}

/**
 * topstories 풀에서 외부 URL이 있는 story만 남기고,
 * AI 키워드 매칭 우선 → 그다음 score 내림차순으로 정렬.
 */
export function rankStoriesForSync(items: HackerNewsItem[]): RankedStory[] {
  const stories: RankedStory[] = [];
  for (const item of items) {
    if (!isStoryWithUrl(item)) continue;
    const score = typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : 0;
    const aiPriority = titleMatchesAiKeywords(item.title);
    stories.push({
      id: item.id,
      title: item.title.trim(),
      url: item.url.trim(),
      score,
      aiPriority,
    });
  }
  stories.sort((a, b) => {
    if (a.aiPriority !== b.aiPriority) return a.aiPriority ? -1 : 1;
    return b.score - a.score;
  });
  return stories;
}
