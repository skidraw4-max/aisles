import Parser from 'rss-parser';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { fetchExternalArticlePlainText } from '@/lib/geeknews/extract-article-text';
import { readGeminiApiKeyFromEnv } from '@/lib/gemini-prompt-analysis-engine';
import { formatTechmemePostBody } from '@/lib/techmeme/format-techmeme-post-body';
import { rankTechmemeFeedItemsForSync } from '@/lib/techmeme/rank-techmeme-feed';
import { summarizeTechmemeArticle } from '@/lib/techmeme/summarize-techmeme-article';
import { TECHMEME_RSS_URL } from '@/lib/news-sync/external-tech-link-sources';
import { loadBlockedSyndicationUrls } from '@/lib/news-sync/blocked-original-urls';
import { NEWS_SYNC_GEMINI_GAP_MS, sleepMs } from '@/lib/news-sync/gemini-request-gap';

export const MAX_NEW_POSTS_PER_RUN = 5;
const MIN_BODY_CHARS = 120;

const FETCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export type TechmemeSyncStep =
  | 'admin_auth'
  | 'env_gemini'
  | 'author_missing'
  | 'techmeme_rss_fetch'
  | 'techmeme_rss_parse'
  | 'techmeme_candidates';

export type TechmemeItemResult = {
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

export type TechmemeSyncSuccess = {
  ok: true;
  created: number;
  scanned: number;
  force: boolean;
  results: TechmemeItemResult[];
};

export type TechmemeSyncFailure = {
  ok: false;
  step: TechmemeSyncStep;
  error: string;
  message: string;
};

export type TechmemeSyncResult = TechmemeSyncSuccess | TechmemeSyncFailure;

function looksLikeRssOrAtomXml(body: string): boolean {
  const t = body.trimStart().slice(0, 4000).toLowerCase();
  if (t.startsWith('<!doctype html') || (t.includes('<html') && t.indexOf('<html') < 200)) {
    return false;
  }
  return (
    t.includes('<rss') ||
    t.includes('<feed') ||
    t.includes('<rdf:rdf') ||
    (t.startsWith('<?xml') && (t.includes('<rss') || t.includes('<feed') || t.includes('<channel')))
  );
}

async function fetchTechmemeRssXml(feedUrl: string): Promise<
  { ok: true; xml: string } | { ok: false; reason: string; status?: number; preview?: string }
> {
  let res: Response;
  try {
    res = await fetch(feedUrl, {
      headers: {
        'User-Agent': FETCH_USER_AGENT,
        Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(28_000),
      cache: 'no-store',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[techmeme] RSS fetch 네트워크 오류', { feedUrl, message: msg, err: e });
    return { ok: false, reason: `NETWORK:${msg}` };
  }

  if (!res.ok) {
    console.error('[techmeme] RSS HTTP 오류', { feedUrl, status: res.status, statusText: res.statusText });
    return { ok: false, reason: `HTTP_${res.status}`, status: res.status };
  }

  const text = await res.text();
  const preview = text.trimStart().slice(0, 240);

  if (!looksLikeRssOrAtomXml(text)) {
    console.error('[techmeme] RSS 응답이 XML/RSS 형식이 아님', { feedUrl, preview });
    return { ok: false, reason: 'NOT_XML_OR_RSS', preview };
  }

  return { ok: true, xml: text };
}

export async function runTechmemeSync(options: { force: boolean }): Promise<TechmemeSyncResult> {
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
      message: `Techmeme 자동 수집용 작성자("${authorUsername}")를 찾을 수 없습니다.`,
    };
  }

  const fetched = await fetchTechmemeRssXml(TECHMEME_RSS_URL);
  if (!fetched.ok) {
    const detail = fetched.preview ? ` preview=${fetched.preview.slice(0, 80)}…` : '';
    return {
      ok: false,
      step: 'techmeme_rss_fetch',
      error: fetched.reason,
      message: `Techmeme RSS를 가져오지 못했습니다: ${fetched.reason}${detail}`,
    };
  }

  let feed: Parser.Output<{ [key: string]: unknown }>;
  try {
    const parser = new Parser({
      timeout: 25_000,
      headers: {
        'User-Agent': FETCH_USER_AGENT,
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
    });
    feed = await parser.parseString(fetched.xml);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[techmeme] RSS 파싱 실패', e);
    return {
      ok: false,
      step: 'techmeme_rss_parse',
      error: `PARSE:${msg}`,
      message: `Techmeme RSS XML 파싱에 실패했습니다: ${msg}`,
    };
  }

  const rawItems = feed.items ?? [];
  if (rawItems.length === 0) {
    return {
      ok: false,
      step: 'techmeme_rss_parse',
      error: 'EMPTY_FEED',
      message: 'Techmeme RSS 피드에 항목이 없습니다.',
    };
  }

  const ranked = rankTechmemeFeedItemsForSync(rawItems);
  if (ranked.length === 0) {
    return {
      ok: false,
      step: 'techmeme_candidates',
      error: 'NO_STORIES',
      message: '원문 URL이 추출되는 Techmeme 항목이 없습니다.',
    };
  }

  const aiRanked = ranked.filter((s) => s.aiPriority);
  console.log(
    `[techmeme] 후보 ${ranked.length}건 중 AI 제목 ${aiRanked.length}건, 최대 ${MAX_NEW_POSTS_PER_RUN}건 등록`,
  );

  if (aiRanked.length === 0) {
    console.warn('[techmeme] AI 키워드 제목 항목 없음 — 등록 생략', { rankedTotal: ranked.length });
    return {
      ok: true,
      created: 0,
      scanned: ranked.length,
      force,
      results: [],
    };
  }

  const blockedUrls = await loadBlockedSyndicationUrls();
  const results: TechmemeItemResult[] = [];
  let created = 0;
  let geminiOrdinal = 0;

  for (const story of aiRanked) {
    if (created >= MAX_NEW_POSTS_PER_RUN) break;

    const externalUrl = story.articleUrl.slice(0, 2048);
    if (!force && blockedUrls.has(externalUrl)) {
      results.push({ externalUrl, status: 'skipped_duplicate' });
      continue;
    }

    const fetchRes = await fetchExternalArticlePlainText(story.articleUrl);
    if (!fetchRes.ok) {
      console.warn(
        `[techmeme] 원문 접속 불가: ${story.articleUrl} → ${fetchRes.message} (${fetchRes.code})`,
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
    console.log(`[techmeme] 원문 본문 길이: ${plain.length}자 (${story.title.slice(0, 40)}…)`);

    if (plain.length < MIN_BODY_CHARS) {
      results.push({
        externalUrl,
        status: 'skipped_short_body',
        detail: `plainLength=${plain.length}`,
      });
      continue;
    }

    geminiOrdinal += 1;
    if (geminiOrdinal > 1) {
      console.log('[techmeme] 3초 대기 중... (Gemini rate limit 완화)');
      await sleepMs(NEWS_SYNC_GEMINI_GAP_MS);
    }
    console.log(
      `[techmeme] ${geminiOrdinal}번 기사 요약 시작 — ${story.title.slice(0, 72)}${story.title.length > 72 ? '…' : ''}`,
    );

    let sum: Awaited<ReturnType<typeof summarizeTechmemeArticle>>;
    try {
      console.log(`[techmeme] ${geminiOrdinal}번 기사 요약 중... (Gemini 호출)`);
      sum = await summarizeTechmemeArticle(keyRes.key, story.title, plain);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[techmeme] Gemini 요약 예외 — 해당 기사만 건너뜀', {
        externalUrl,
        message: msg,
      });
      results.push({
        externalUrl,
        status: 'skipped_summary',
        detail: msg,
        step: 'gemini_summary_throw',
      });
      continue;
    }

    if (!sum.ok) {
      console.warn('[techmeme] Gemini 요약 실패 — 해당 기사만 건너뜀', sum.error);
      results.push({
        externalUrl,
        status: 'skipped_summary',
        detail: sum.error,
        step: 'gemini_summary',
      });
      continue;
    }

    const content = formatTechmemePostBody(story.articleUrl, story.riverPermalink, sum.data);
    const title = sum.data.postTitle.trim() || story.title;

    try {
      const post = await prisma.post.create({
        data: {
          category: 'LOUNGE',
          title,
          content,
          thumbnail: null,
          attachmentUrls: [],
          tags: ['Techmeme'],
          authorId: author.id,
          techmemeOriginalUrl: externalUrl,
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
          detail:
            '이미 등록된 원문 URL입니다(geeknewsOriginalUrl·hackerNewsOriginalUrl·vergeOriginalUrl·lobstersOriginalUrl·techmemeOriginalUrl 등 중복).',
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

  console.log(`[techmeme] 동기화 종료 — 신규 ${created}건, force=${force}`);

  return {
    ok: true,
    created,
    scanned: ranked.length,
    force,
    results,
  };
}
