import { Prisma } from '@prisma/client';
import type { Category } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { readGeminiApiKeyFromEnv } from '@/lib/gemini-prompt-analysis-engine';
import {
  YOUTUBE_DEEPMIND_CHANNEL_ID,
  YOUTUBE_FEED_SCAN_PER_CHANNEL,
  YOUTUBE_MAX_NEW_PER_CHANNEL_PER_RUN,
  YOUTUBE_MIT_OCW_CHANNEL_ID,
  YOUTUBE_THUMBNAIL_HQ,
  YOUTUBE_WATCH_URL,
} from '@/lib/youtube-sync/constants';
import { fetchLatestFeedEntries } from '@/lib/youtube-sync/fetch-channel-feed';
import { fetchYoutubeTranscriptPreferKorean } from '@/lib/youtube-sync/fetch-transcript';
import { formatYoutubePostBody } from '@/lib/youtube-sync/format-youtube-body';
import { summarizeYoutubeWithGemini, type YoutubeSyndicationSource } from '@/lib/youtube-sync/summarize-youtube';
import { YOUTUBE_SYNC_GAP_MS, sleepMs } from '@/lib/youtube-sync/youtube-request-gap';

export type YoutubeSyncStep =
  | 'admin_auth'
  | 'env_gemini'
  | 'author_missing'
  | 'feed_fetch';

export type YoutubeItemResult = {
  videoId: string;
  channel: YoutubeSyndicationSource;
  status:
    | 'created'
    | 'skipped_duplicate'
    | 'skipped_no_transcript'
    | 'skipped_summary'
    | 'error';
  detail?: string;
  postId?: string;
};

export type YoutubeSyncSuccess = {
  ok: true;
  created: number;
  force: boolean;
  results: YoutubeItemResult[];
};

export type YoutubeSyncFailure = {
  ok: false;
  step: YoutubeSyncStep;
  error: string;
  message: string;
};

export type YoutubeSyncResult = YoutubeSyncSuccess | YoutubeSyncFailure;

async function loadYoutubeVideoIdSet(): Promise<Set<string>> {
  const rows = await prisma.post.findMany({
    where: { youtubeVideoId: { not: null } },
    select: { youtubeVideoId: true },
  });
  const s = new Set<string>();
  for (const r of rows) {
    if (r.youtubeVideoId) s.add(r.youtubeVideoId);
  }
  return s;
}

function categoryForSource(source: YoutubeSyndicationSource): Category {
  /** MIT OCW → LAB(RECIPE), DeepMind → TREND (요청 사양) */
  return source === 'MIT_OCW' ? 'RECIPE' : 'TREND';
}

function tagsForSource(source: YoutubeSyndicationSource): string[] {
  if (source === 'MIT_OCW') {
    return ['YouTube', 'MIT OpenCourseWare', 'MIT OCW'];
  }
  return ['YouTube', 'DeepMind', 'Google DeepMind'];
}

export async function runYoutubeSync(options: { force: boolean }): Promise<YoutubeSyncResult> {
  try {
    return await runYoutubeSyncInner(options);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[youtube-sync] 예외', e);
    return {
      ok: false,
      step: 'feed_fetch',
      error: `UNHANDLED:${msg}`,
      message: `YouTube 동기화 중 예외: ${msg}`,
    };
  }
}

async function runYoutubeSyncInner(options: { force: boolean }): Promise<YoutubeSyncResult> {
  const { force } = options;

  const keyRes = readGeminiApiKeyFromEnv();
  if (!keyRes.ok) {
    return {
      ok: false,
      step: 'env_gemini',
      error: 'MISSING_GEMINI_KEY',
      message: 'GOOGLE_GENERATIVE_AI_API_KEY 또는 GEMINI_API_KEY가 설정되어 있지 않습니다.',
    };
  }

  const authorUsername = (
    process.env.HACKERNEWS_AUTHOR_USERNAME ??
    process.env.GEEKNEWS_AUTHOR_USERNAME ??
    'Nedai'
  ).trim();
  const author = await prisma.user.findFirst({
    where: { username: authorUsername },
    select: { id: true },
  });
  if (!author) {
    return {
      ok: false,
      step: 'author_missing',
      error: `USER_NOT_FOUND:${authorUsername}`,
      message: `YouTube 자동 수집용 작성자("${authorUsername}")를 찾을 수 없습니다.`,
    };
  }

  let existing = await loadYoutubeVideoIdSet();
  const results: YoutubeItemResult[] = [];
  let created = 0;

  let videoAttempt = 0;

  const channels: { source: YoutubeSyndicationSource; channelId: string }[] = [
    { source: 'MIT_OCW', channelId: YOUTUBE_MIT_OCW_CHANNEL_ID },
    { source: 'DEEPMIND', channelId: YOUTUBE_DEEPMIND_CHANNEL_ID },
  ];

  for (const { source, channelId } of channels) {
    let newPostsThisChannel = 0;
    const feed = await fetchLatestFeedEntries(channelId, YOUTUBE_FEED_SCAN_PER_CHANNEL);
    if (!feed.ok) {
      results.push({
        videoId: '',
        channel: source,
        status: 'error',
        detail: `피드 실패: ${feed.message}`,
      });
      continue;
    }

    for (const entry of feed.entries) {
      if (newPostsThisChannel >= YOUTUBE_MAX_NEW_PER_CHANNEL_PER_RUN) break;

      if (!force && existing.has(entry.videoId)) {
        results.push({ videoId: entry.videoId, channel: source, status: 'skipped_duplicate' });
        continue;
      }

      if (videoAttempt > 0) {
        console.log(`[youtube-sync] ${YOUTUBE_SYNC_GAP_MS}ms 대기 (다음 영상 처리 전)`);
        await sleepMs(YOUTUBE_SYNC_GAP_MS);
      }
      videoAttempt += 1;

      console.log(`[youtube-sync] 자막 요청 — ${source} ${entry.videoId}`);
      const tr = await fetchYoutubeTranscriptPreferKorean(entry.videoId);
      if (!tr) {
        results.push({
          videoId: entry.videoId,
          channel: source,
          status: 'skipped_no_transcript',
          detail: '자막 없음 또는 추출 실패',
        });
        continue;
      }

      console.log(`[youtube-sync] Gemini 요약 — ${source} ${entry.videoId}`);
      const sum = await summarizeYoutubeWithGemini(keyRes.key, source, entry.title, tr);
      if (!sum.ok) {
        results.push({
          videoId: entry.videoId,
          channel: source,
          status: 'skipped_summary',
          detail: sum.error,
        });
        continue;
      }

      const content = formatYoutubePostBody(source, sum.data.summaryBody);
      const title = sum.data.postTitle.trim().slice(0, 200);
      const watchUrl = YOUTUBE_WATCH_URL(entry.videoId);
      const thumb = YOUTUBE_THUMBNAIL_HQ(entry.videoId);

      try {
        const post = await prisma.post.create({
          data: {
            category: categoryForSource(source),
            title,
            content,
            thumbnail: thumb.slice(0, 2048),
            attachmentUrls: [],
            tags: tagsForSource(source),
            authorId: author.id,
            externalLink: watchUrl.slice(0, 2048),
            youtubeVideoId: entry.videoId,
            youtubeSyndicationSource: source,
          },
        });
        existing.add(entry.videoId);
        created += 1;
        newPostsThisChannel += 1;
        results.push({ videoId: entry.videoId, channel: source, status: 'created', postId: post.id });
        console.log(`[youtube-sync] 등록 완료 ${post.id} (${source})`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          results.push({
            videoId: entry.videoId,
            channel: source,
            status: 'error',
            detail: '이미 등록된 영상 ID입니다.',
          });
        } else {
          results.push({
            videoId: entry.videoId,
            channel: source,
            status: 'error',
            detail: msg,
          });
        }
      }
    }
  }

  console.log(`[youtube-sync] 종료 — 신규 ${created}건, force=${force}`);

  return { ok: true, created, force, results };
}
