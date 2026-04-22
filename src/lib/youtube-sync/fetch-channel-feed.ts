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

/** 서버 전용 — 클라이언트에 노출 금지 */
function readYoutubeDataApiKey(): string | undefined {
  return (
    process.env.YOUTUBE_DATA_API_KEY?.trim() ||
    process.env.GOOGLE_YOUTUBE_API_KEY?.trim() ||
    process.env.YOUTUBE_API_KEY?.trim()
  );
}

/**
 * YouTube Data API v3 — 채널 uploads 플레이리스트에서 최신 영상 목록.
 * RSS(feeds/videos.xml)가 데이터센터에서 404를 내는 경우가 많아 프로덕션에서는 이 경로를 권장합니다.
 */
async function fetchViaDataApi(
  channelId: string,
  limit: number,
  apiKey: string,
): Promise<{ ok: true; entries: YoutubeFeedEntry[] } | { ok: false; message: string }> {
  try {
    const chUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
    chUrl.searchParams.set('part', 'contentDetails');
    chUrl.searchParams.set('id', channelId);
    chUrl.searchParams.set('key', apiKey);

    const chRes = await fetch(chUrl.toString(), {
      signal: AbortSignal.timeout(25_000),
      headers: { Accept: 'application/json' },
    });
    const chText = await chRes.text();
    if (!chRes.ok) {
      return {
        ok: false,
        message: `channels.list HTTP ${chRes.status}: ${chText.slice(0, 200)}`,
      };
    }
    const chJson = JSON.parse(chText) as {
      items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
      error?: { message?: string };
    };
    if (chJson.error?.message) {
      return { ok: false, message: chJson.error.message };
    }
    const uploads = chJson.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) {
      return { ok: false, message: 'uploads 플레이리스트 ID 없음' };
    }

    const plUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    plUrl.searchParams.set('part', 'snippet');
    plUrl.searchParams.set('playlistId', uploads);
    plUrl.searchParams.set('maxResults', String(Math.min(Math.max(limit, 1), 50)));
    plUrl.searchParams.set('key', apiKey);

    const plRes = await fetch(plUrl.toString(), {
      signal: AbortSignal.timeout(25_000),
      headers: { Accept: 'application/json' },
    });
    const plText = await plRes.text();
    if (!plRes.ok) {
      return {
        ok: false,
        message: `playlistItems HTTP ${plRes.status}: ${plText.slice(0, 200)}`,
      };
    }
    const plJson = JSON.parse(plText) as {
      items?: Array<{
        snippet?: { title?: string; publishedAt?: string; resourceId?: { videoId?: string } };
      }>;
      error?: { message?: string };
    };
    if (plJson.error?.message) {
      return { ok: false, message: plJson.error.message };
    }

    const entries: YoutubeFeedEntry[] = [];
    for (const it of plJson.items ?? []) {
      const vid = it.snippet?.resourceId?.videoId ?? '';
      if (!vid || !/^[\w-]{11}$/.test(vid)) continue;
      entries.push({
        videoId: vid,
        title: (it.snippet?.title ?? '').trim() || '(제목 없음)',
        link: `https://www.youtube.com/watch?v=${vid}`,
        publishedAt: it.snippet?.publishedAt,
      });
      if (entries.length >= limit) break;
    }
    if (entries.length === 0) {
      return { ok: false, message: 'playlist에 영상이 없습니다.' };
    }
    return { ok: true, entries };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Data API 예외: ${msg}` };
  }
}

async function fetchViaRss(
  channelId: string,
  limit: number,
): Promise<{ ok: true; entries: YoutubeFeedEntry[] } | { ok: false; message: string }> {
  const feedUrl = YOUTUBE_CHANNEL_FEED(channelId);
  try {
    const res = await fetch(feedUrl, {
      signal: AbortSignal.timeout(25_000),
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) {
      return {
        ok: false,
        message: `RSS HTTP ${res.status} — YouTube feeds/videos.xml 가 Vercel·일부 서버에서 404를 주는 경우가 많습니다. Google Cloud에서 YouTube Data API v3 를 켜고 YOUTUBE_DATA_API_KEY 를 설정하세요.`,
      };
    }
    const xml = await res.text();
    const parser = new Parser();
    const feed = await parser.parseString(xml);
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
    if (entries.length === 0) {
      return { ok: false, message: 'RSS에 파싱 가능한 영상 링크가 없습니다.' };
    }
    return { ok: true, entries };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `RSS 실패: ${msg}` };
  }
}

export async function fetchLatestFeedEntries(
  channelId: string,
  limit: number,
): Promise<{ ok: true; entries: YoutubeFeedEntry[] } | { ok: false; message: string }> {
  const apiKey = readYoutubeDataApiKey();
  if (apiKey) {
    const api = await fetchViaDataApi(channelId, limit, apiKey);
    if (api.ok) {
      console.log('[youtube-sync] 채널 목록: YouTube Data API v3 사용');
      return api;
    }
    console.warn('[youtube-sync] Data API 실패, RSS 폴백 시도:', api.message);
  } else {
    console.warn(
      '[youtube-sync] YOUTUBE_DATA_API_KEY 없음 — RSS만 시도합니다. 프로덕션에서는 404가 날 수 있습니다.',
    );
  }
  return fetchViaRss(channelId, limit);
}
