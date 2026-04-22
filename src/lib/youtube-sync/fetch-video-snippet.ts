/**
 * 자막이 없을 때 폴백: YouTube Data API v3 `videos.list` 의 snippet(제목·설명).
 */
export type YoutubeVideoSnippet = {
  title: string;
  description: string;
  channelTitle: string;
  publishedAt?: string;
};

export async function fetchYoutubeVideoSnippet(
  videoId: string,
  apiKey: string,
): Promise<YoutubeVideoSnippet | null> {
  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('id', videoId);
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(25_000),
      headers: { Accept: 'application/json' },
    });
    const text = await res.text();
    if (!res.ok) {
      console.warn('[youtube-sync] videos.list HTTP', res.status, text.slice(0, 160));
      return null;
    }
    const json = JSON.parse(text) as {
      items?: Array<{
        snippet?: {
          title?: string;
          description?: string;
          channelTitle?: string;
          publishedAt?: string;
        };
      }>;
      error?: { message?: string };
    };
    if (json.error?.message) {
      console.warn('[youtube-sync] videos.list error:', json.error.message);
      return null;
    }
    const sn = json.items?.[0]?.snippet;
    if (!sn) return null;
    const title = (sn.title ?? '').trim();
    const description = (sn.description ?? '').trim();
    const channelTitle = (sn.channelTitle ?? '').trim();
    if (!title && !description) return null;
    return {
      title,
      description,
      channelTitle,
      publishedAt: sn.publishedAt,
    };
  } catch (e) {
    console.warn('[youtube-sync] fetchYoutubeVideoSnippet 예외', e);
    return null;
  }
}
