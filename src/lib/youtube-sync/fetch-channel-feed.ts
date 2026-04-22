import Parser from 'rss-parser';
import { YOUTUBE_CHANNEL_FEED } from '@/lib/youtube-sync/constants';

export type YoutubeFeedEntry = {
  videoId: string;
  title: string;
  link: string;
  publishedAt?: string;
};

export function extractVideoIdFromYoutubeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const v = u.searchParams.get('v');
    if (v && /^[\w-]{11}$/.test(v)) return v;
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      if (id && /^[\w-]{11}$/.test(id)) return id;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function fetchLatestFeedEntries(
  channelId: string,
  limit: number,
): Promise<{ ok: true; entries: YoutubeFeedEntry[] } | { ok: false; message: string }> {
  const feedUrl = YOUTUBE_CHANNEL_FEED(channelId);
  try {
    const parser = new Parser<{ 'media:group'?: unknown }>({
      timeout: 25_000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; AIsle-YouTubeSync/1.0; +https://github.com/skidraw4-max/aisles)',
        Accept: 'application/atom+xml, application/xml, text/xml, */*',
      },
    });
    const feed = await parser.parseURL(feedUrl);
    const items = feed.items ?? [];
    const entries: YoutubeFeedEntry[] = [];
    for (const item of items.slice(0, limit)) {
      const link = item.link?.trim() ?? '';
      const videoId = extractVideoIdFromYoutubeUrl(link);
      if (!videoId) continue;
      entries.push({
        videoId,
        title: (item.title ?? '').trim() || '(제목 없음)',
        link,
        publishedAt: item.pubDate,
      });
    }
    return { ok: true, entries };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}
