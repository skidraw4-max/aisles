import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { fetchExternalArticlePlainText } from '@/lib/geeknews/extract-article-text';
import { fetchItemsBatched, fetchTopStoryIds } from '@/lib/hackernews/fetch-top-stories';
import { formatHackerNewsPostBody } from '@/lib/hackernews/format-post-body';
import { rankStoriesForSync } from '@/lib/hackernews/rank-stories';
import { summarizeHackerNewsArticle } from '@/lib/hackernews/summarize';
import { readGeminiApiKeyFromEnv } from '@/lib/gemini-prompt-analysis-engine';

/** topstories.json 상위 N개 ID만 펼쳐서 점수·AI 우선순위 계산 */
export const TOP_STORIES_POOL = 200;
export const ITEM_FETCH_BATCH = 28;
export const MAX_NEW_POSTS_PER_RUN = 5;
const MIN_BODY_CHARS = 120;

export type HackerNewsSyncStep =
  | 'admin_auth'
  | 'env_gemini'
  | 'author_missing'
  | 'hackernews_list_fetch'
  | 'hackernews_candidates';

export type HackerNewsItemResult = {
  externalUrl: string;
  status:
    | 'created'
    | 'skipped_duplicate'
    | 'skipped_short_body'
    | 'skipped_summary'
    | 'error'
    | 'skipped_fetch';
  detail?: string;
  postId?: string;
  step?: string;
};

export type HackerNewsSyncSuccess = {
  ok: true;
  created: number;
  scanned: number;
  force: boolean;
  results: HackerNewsItemResult[];
};

export type HackerNewsSyncFailure = {
  ok: false;
  step: HackerNewsSyncStep;
  error: string;
  message: string;
};

export type HackerNewsSyncResult = HackerNewsSyncSuccess | HackerNewsSyncFailure;

async function loadBlockedOriginalUrls(): Promise<Set<string>> {
  const [gn, hn, vg] = await Promise.all([
    prisma.post.findMany({
      where: { geeknewsOriginalUrl: { not: null } },
      select: { geeknewsOriginalUrl: true },
    }),
    prisma.post.findMany({
      where: { hackerNewsOriginalUrl: { not: null } },
      select: { hackerNewsOriginalUrl: true },
    }),
    prisma.post.findMany({
      where: { vergeOriginalUrl: { not: null } },
      select: { vergeOriginalUrl: true },
    }),
  ]);
  const set = new Set<string>();
  for (const r of gn) {
    if (r.geeknewsOriginalUrl) set.add(r.geeknewsOriginalUrl);
  }
  for (const r of hn) {
    if (r.hackerNewsOriginalUrl) set.add(r.hackerNewsOriginalUrl);
  }
  for (const r of vg) {
    if (r.vergeOriginalUrl) set.add(r.vergeOriginalUrl);
  }
  return set;
}

export async function runHackerNewsSync(options: { force: boolean }): Promise<HackerNewsSyncResult> {
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
      message: `Hacker News 전용 작성자 사용자("${authorUsername}")를 찾을 수 없습니다.`,
    };
  }

  let ids: number[];
  try {
    ids = await fetchTopStoryIds(TOP_STORIES_POOL);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[hackernews] topstories 요청 실패', e);
    return {
      ok: false,
      step: 'hackernews_list_fetch',
      error: `NETWORK:${msg}`,
      message: `Hacker News topstories를 가져오지 못했습니다: ${msg}`,
    };
  }

  if (ids.length === 0) {
    return {
      ok: false,
      step: 'hackernews_list_fetch',
      error: 'EMPTY_IDS',
      message: 'topstories.json이 비어 있습니다.',
    };
  }

  console.log(`[hackernews] topstories ${ids.length}개 ID 로드`);

  const rawItems = await fetchItemsBatched(ids, ITEM_FETCH_BATCH);
  const ranked = rankStoriesForSync(rawItems);

  if (ranked.length === 0) {
    return {
      ok: false,
      step: 'hackernews_candidates',
      error: 'NO_STORIES',
      message: '외부 URL이 있는 story가 없습니다.',
    };
  }

  const aiRanked = ranked.filter((s) => s.aiPriority);
  console.log(
    `[hackernews] 후보 ${ranked.length}건 중 AI 제목 ${aiRanked.length}건 (score 정렬), 최대 ${MAX_NEW_POSTS_PER_RUN}건 등록`,
  );

  if (aiRanked.length === 0) {
    console.warn('[hackernews] AI 키워드 제목 story 없음 — 등록 생략', { rankedTotal: ranked.length });
    return {
      ok: true,
      created: 0,
      scanned: ranked.length,
      force,
      results: [],
    };
  }

  const blockedUrls = await loadBlockedOriginalUrls();
  const results: HackerNewsItemResult[] = [];
  let created = 0;

  for (const story of aiRanked) {
    if (created >= MAX_NEW_POSTS_PER_RUN) break;

    const externalUrl = story.url.slice(0, 2048);
    if (!force && blockedUrls.has(externalUrl)) {
      results.push({ externalUrl, status: 'skipped_duplicate' });
      continue;
    }

    const fetchRes = await fetchExternalArticlePlainText(story.url);
    if (!fetchRes.ok) {
      console.warn(
        `[hackernews] 원문 접속 불가: ${story.url} → ${fetchRes.message} (${fetchRes.code})`,
      );
      results.push({
        externalUrl,
        status: 'skipped_fetch',
        step: '원문_fetch',
        detail: fetchRes.message,
      });
      continue;
    }

    const plain = fetchRes.text;
    console.log(`[hackernews] 원문 본문 길이: ${plain.length}자 (${story.title.slice(0, 40)}…)`);

    if (plain.length < MIN_BODY_CHARS) {
      results.push({
        externalUrl,
        status: 'skipped_short_body',
        detail: `plainLength=${plain.length}`,
      });
      continue;
    }

    const sum = await summarizeHackerNewsArticle(keyRes.key, story.title, plain);
    if (!sum.ok) {
      console.warn('[hackernews] Gemini 요약 실패', sum.error);
      results.push({
        externalUrl,
        status: 'skipped_summary',
        detail: sum.error,
        step: 'gemini_summary',
      });
      continue;
    }

    const hnDiscussionUrl = `https://news.ycombinator.com/item?id=${story.id}`;
    const content = formatHackerNewsPostBody(story.url, hnDiscussionUrl, sum.data);
    const title = sum.data.postTitle.trim() || story.title;

    try {
      const post = await prisma.post.create({
        data: {
          category: 'LOUNGE',
          title,
          content,
          thumbnail: null,
          attachmentUrls: [],
          tags: ['HackerNews'],
          authorId: author.id,
          hackerNewsOriginalUrl: externalUrl,
          externalLink: externalUrl,
        },
      });
      blockedUrls.add(externalUrl);
      created += 1;
      results.push({ externalUrl, status: 'created', postId: post.id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        results.push({
          externalUrl,
          status: 'error',
          step: 'db_unique',
          detail: '이미 등록된 원문 URL입니다(geeknewsOriginalUrl 또는 hackerNewsOriginalUrl 중복).',
        });
      } else {
        results.push({
          externalUrl,
          status: 'error',
          step: 'db_create',
          detail: msg,
        });
      }
    }
  }

  console.log(`[hackernews] 동기화 종료 — 신규 ${created}건, force=${force}`);

  return {
    ok: true,
    created,
    scanned: ranked.length,
    force,
    results,
  };
}
