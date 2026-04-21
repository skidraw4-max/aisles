import Parser from 'rss-parser';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { fetchExternalArticlePlainText, htmlToPlainText } from '@/lib/geeknews/extract-article-text';
import { readGeminiApiKeyFromEnv } from '@/lib/gemini-prompt-analysis-engine';
import { loadBlockedSyndicationUrls } from '@/lib/news-sync/blocked-original-urls';
import { NEWS_SYNC_GEMINI_GAP_MS, sleepMs } from '@/lib/news-sync/gemini-request-gap';
import { summarizeMitNewsArticle } from '@/lib/mit-news/summarize-mit-article';
import { formatMitNewsPostBody } from '@/lib/mit-news/format-mit-post-body';

/** MIT News — Artificial Intelligence 토픽 RSS */
export const MIT_NEWS_AI_RSS_URL = 'https://news.mit.edu/rss/topic/artificial-intelligence2';

export const MAX_NEW_POSTS_PER_RUN = 3;
const MIN_BODY_CHARS = 120;

const FETCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export type MitNewsSyncStep =
  | 'admin_auth'
  | 'env_gemini'
  | 'author_missing'
  | 'mit_rss_fetch'
  | 'mit_rss_parse';

export type MitNewsItemResult = {
  link: string;
  status:
    | 'created'
    | 'skipped_duplicate'
    | 'skipped_short_body'
    | 'skipped_summary'
    | 'error'
    | 'skipped_invalid_link';
  detail?: string;
  postId?: string;
  step?: string;
};

export type MitNewsSyncSuccess = {
  ok: true;
  created: number;
  scanned: number;
  force: boolean;
  results: MitNewsItemResult[];
};

export type MitNewsSyncFailure = {
  ok: false;
  step: MitNewsSyncStep;
  error: string;
  message: string;
};

export type MitNewsSyncResult = MitNewsSyncSuccess | MitNewsSyncFailure;

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    return u.toString();
  } catch {
    return url.trim();
  }
}

export function isValidMitNewsArticleLink(raw: string | undefined): raw is string {
  if (!raw || typeof raw !== 'string') return false;
  const s = raw.trim();
  if (!s.startsWith('https://') && !s.startsWith('http://')) return false;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return u.hostname.toLowerCase() === 'news.mit.edu';
  } catch {
    return false;
  }
}

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

async function fetchMitRssXml(feedUrl: string): Promise<
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
    console.error('[mit-news] RSS fetch 네트워크 오류', { feedUrl, message: msg });
    return { ok: false, reason: `NETWORK:${msg}` };
  }

  if (!res.ok) {
    return { ok: false, reason: `HTTP_${res.status}`, status: res.status };
  }

  const text = await res.text();
  const preview = text.trimStart().slice(0, 240);

  if (!looksLikeRssOrAtomXml(text)) {
    return { ok: false, reason: 'NOT_XML_OR_RSS', preview };
  }

  return { ok: true, xml: text };
}

function rssPlainBody(item: Parser.Item): string {
  const raw = item as Record<string, unknown>;
  const encoded =
    typeof raw['content:encoded'] === 'string' ? (raw['content:encoded'] as string) : '';
  const html =
    (typeof item.content === 'string' && item.content) ||
    encoded ||
    (typeof item.summary === 'string' && item.summary) ||
    '';
  const fromContent = htmlToPlainText(html);
  const snippet = item.contentSnippet ? htmlToPlainText(item.contentSnippet) : '';
  const merged = [item.title ?? '', fromContent, snippet].filter(Boolean).join('\n\n');
  return htmlToPlainText(merged).trim();
}

function ensureMitTitlePrefix(title: string): string {
  const t = title.trim();
  const capped = t.slice(0, 200);
  if (capped.startsWith('[MIT 연구]')) return capped;
  const withPrefix = `[MIT 연구] ${t}`.trim();
  return withPrefix.slice(0, 200);
}

export async function runMitNewsSync(options: { force: boolean }): Promise<MitNewsSyncResult> {
  try {
    return await runMitNewsSyncInner(options);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[mit-news] runMitNewsSync 예외', e);
    return {
      ok: false,
      step: 'mit_rss_fetch',
      error: `UNHANDLED:${msg}`,
      message: `MIT News 동기화 중 예외: ${msg}`,
    };
  }
}

async function runMitNewsSyncInner(options: { force: boolean }): Promise<MitNewsSyncResult> {
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
      message: `MIT News 자동 수집용 작성자("${authorUsername}")를 찾을 수 없습니다.`,
    };
  }

  const fetched = await fetchMitRssXml(MIT_NEWS_AI_RSS_URL);
  if (!fetched.ok) {
    const detail = fetched.preview ? ` preview=${fetched.preview.slice(0, 80)}…` : '';
    return {
      ok: false,
      step: 'mit_rss_fetch',
      error: fetched.reason,
      message: `MIT News RSS를 가져오지 못했습니다: ${fetched.reason}${detail}`,
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
    console.error('[mit-news] RSS 파싱 실패', e);
    return {
      ok: false,
      step: 'mit_rss_parse',
      error: `PARSE:${msg}`,
      message: `MIT News RSS XML 파싱에 실패했습니다: ${msg}`,
    };
  }

  const rawFeed = feed.items ?? [];
  if (rawFeed.length === 0) {
    return {
      ok: false,
      step: 'mit_rss_parse',
      error: 'EMPTY_FEED',
      message: 'RSS 피드에 항목이 없습니다.',
    };
  }

  const items = rawFeed.slice(0, MAX_NEW_POSTS_PER_RUN);
  const blocked = await loadBlockedSyndicationUrls();
  const results: MitNewsItemResult[] = [];
  let created = 0;
  let geminiOrdinal = 0;

  for (const item of items) {
    const rawLink = item.link?.trim();
    if (!isValidMitNewsArticleLink(rawLink)) {
      results.push({
        link: rawLink ?? '',
        status: 'skipped_invalid_link',
        detail: 'link가 없거나 news.mit.edu URL이 아님',
      });
      continue;
    }

    const link = normalizeUrl(rawLink).slice(0, 2048);

    if (!force && blocked.has(link)) {
      results.push({ link, status: 'skipped_duplicate' });
      continue;
    }

    let plain = rssPlainBody(item);
    if (plain.length < MIN_BODY_CHARS) {
      const ext = await fetchExternalArticlePlainText(link);
      if (ext.ok && ext.text.length >= MIN_BODY_CHARS) {
        plain = ext.text;
      }
    }

    if (plain.length < MIN_BODY_CHARS) {
      results.push({
        link,
        status: 'skipped_short_body',
        detail: `plainLength=${plain.length}`,
      });
      continue;
    }

    geminiOrdinal += 1;
    if (geminiOrdinal > 1) {
      console.log('[mit-news] 3초 대기 중… (Gemini rate limit 완화)');
      await sleepMs(NEWS_SYNC_GEMINI_GAP_MS);
    }
    console.log(
      `[mit-news] ${geminiOrdinal}번 기사 요약 시작 — ${(item.title ?? '').slice(0, 72)}${(item.title ?? '').length > 72 ? '…' : ''}`,
    );

    let sum: Awaited<ReturnType<typeof summarizeMitNewsArticle>>;
    try {
      sum = await summarizeMitNewsArticle(keyRes.key, item.title ?? '(제목 없음)', plain);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[mit-news] Gemini 요약 예외 — 해당 기사만 건너뜀', { link, message: msg });
      results.push({
        link,
        status: 'skipped_summary',
        detail: msg,
        step: 'gemini_summary_throw',
      });
      continue;
    }

    if (!sum.ok) {
      console.warn('[mit-news] Gemini 요약 실패 — 해당 기사만 건너뜀', sum.error);
      results.push({
        link,
        status: 'skipped_summary',
        detail: sum.error,
        step: 'gemini_summary',
      });
      continue;
    }

    const content = formatMitNewsPostBody(link, sum.data);
    const title = ensureMitTitlePrefix(sum.data.postTitle.trim() || item.title?.trim() || 'MIT News');

    try {
      const post = await prisma.post.create({
        data: {
          /** 학술·연구 성격에 맞춰 TREND(구 테크 트렌드 복도)에 배치. RECIPE(LAB)는 프롬프트 메타데이터 없이 본문이 숨겨질 수 있음. */
          category: 'TREND',
          title,
          content,
          thumbnail: null,
          attachmentUrls: [],
          tags: ['MIT News', 'Artificial Intelligence'],
          authorId: author.id,
          externalLink: link,
          mitNewsOriginalUrl: link,
        },
      });
      blocked.add(link);
      created += 1;
      results.push({ link, status: 'created', postId: post.id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        results.push({
          link,
          status: 'error',
          step: 'db_unique',
          detail: '이미 등록된 원문 URL입니다.',
        });
      } else {
        results.push({
          link,
          status: 'error',
          step: 'db_create',
          detail: msg,
        });
      }
    }
  }

  console.log(
    `[mit-news] 동기화 종료 — 신규 ${created}건, 피드 ${rawFeed.length}건 중 처리 ${items.length}건, force=${force}`,
  );

  return {
    ok: true,
    created,
    scanned: rawFeed.length,
    force,
    results,
  };
}
