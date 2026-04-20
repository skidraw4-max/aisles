import Parser from 'rss-parser';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { htmlToPlainText } from '@/lib/geeknews/extract-article-text';
import { readGeminiApiKeyFromEnv } from '@/lib/gemini-prompt-analysis-engine';
import { titleMatchesAiKeywords } from '@/lib/hackernews/ai-title';
import { summarizeVergeArticle } from '@/lib/verge/summarize-verge';
import { formatVergePostBody } from '@/lib/verge/format-verge-body';

/** The Verge RSS (AI / tech 뉴스 피드) */
export const VERGE_RSS_URL = 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml';

/** @deprecated VERGE_RSS_URL 사용 */
export const VERGE_TECH_RSS = VERGE_RSS_URL;

export const MAX_NEW_POSTS_PER_RUN = 5;
const MIN_BODY_CHARS = 120;

/** 브라우저와 유사한 UA (봇 차단 완화) */
export const VERGE_FETCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export type VergeSyncStep =
  | 'admin_auth'
  | 'env_gemini'
  | 'author_missing'
  | 'verge_rss_fetch'
  | 'verge_rss_parse';

export type VergeItemResult = {
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

export type VergeSyncSuccess = {
  ok: true;
  created: number;
  scanned: number;
  force: boolean;
  results: VergeItemResult[];
};

export type VergeSyncFailure = {
  ok: false;
  step: VergeSyncStep;
  error: string;
  message: string;
};

export type VergeSyncResult = VergeSyncSuccess | VergeSyncFailure;

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    return u.toString();
  } catch {
    return url.trim();
  }
}

/** item.link가 기사 원문으로 쓸 수 있는지 검사 (https/http, theverge.com 호스트) */
export function isValidVergeArticleLink(raw: string | undefined): raw is string {
  if (!raw || typeof raw !== 'string') return false;
  const s = raw.trim();
  if (!s.startsWith('https://') && !s.startsWith('http://')) return false;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    return host === 'theverge.com' || host.endsWith('.theverge.com');
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

async function fetchVergeRssXml(feedUrl: string): Promise<
  | { ok: true; xml: string }
  | { ok: false; reason: string; status?: number; preview?: string }
> {
  let res: Response;
  try {
    res = await fetch(feedUrl, {
      headers: {
        'User-Agent': VERGE_FETCH_USER_AGENT,
        Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(28_000),
      cache: 'no-store',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[verge] RSS fetch 네트워크 오류', { feedUrl, message: msg, err: e });
    return { ok: false, reason: `NETWORK:${msg}` };
  }

  if (!res.ok) {
    console.error('[verge] RSS HTTP 오류 — 응답 본문은 XML 검사 생략', {
      feedUrl,
      status: res.status,
      statusText: res.statusText,
    });
    return { ok: false, reason: `HTTP_${res.status}`, status: res.status };
  }

  const text = await res.text();
  const preview = text.trimStart().slice(0, 240);

  if (!looksLikeRssOrAtomXml(text)) {
    console.error('[verge] RSS 응답이 XML/RSS 형식이 아님(HTML·오류 페이지 가능)', {
      feedUrl,
      preview,
    });
    return { ok: false, reason: 'NOT_XML_OR_RSS', preview };
  }

  return { ok: true, xml: text };
}

async function loadBlockedOriginalUrls(): Promise<Set<string>> {
  const rows = await prisma.post.findMany({
    where: {
      OR: [
        { geeknewsOriginalUrl: { not: null } },
        { hackerNewsOriginalUrl: { not: null } },
        { vergeOriginalUrl: { not: null } },
      ],
    },
    select: {
      geeknewsOriginalUrl: true,
      hackerNewsOriginalUrl: true,
      vergeOriginalUrl: true,
    },
  });
  const set = new Set<string>();
  for (const r of rows) {
    if (r.geeknewsOriginalUrl) set.add(r.geeknewsOriginalUrl);
    if (r.hackerNewsOriginalUrl) set.add(r.hackerNewsOriginalUrl);
    if (r.vergeOriginalUrl) set.add(r.vergeOriginalUrl);
  }
  return set;
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

export async function runVergeSync(options: { force: boolean }): Promise<VergeSyncResult> {
  try {
    return await runVergeSyncInner(options);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[verge] runVergeSync 예외 — 결과 객체로 반환', e);
    return {
      ok: false,
      step: 'verge_rss_fetch',
      error: `UNHANDLED:${msg}`,
      message: `The Verge 동기화 중 예외: ${msg}`,
    };
  }
}

async function runVergeSyncInner(options: { force: boolean }): Promise<VergeSyncResult> {
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
      message: `The Verge 자동 수집용 작성자("${authorUsername}")를 찾을 수 없습니다. (HN·GeekNews와 동일: HACKERNEWS_AUTHOR_USERNAME → GEEKNEWS_AUTHOR_USERNAME → Nedai)`,
    };
  }

  const fetched = await fetchVergeRssXml(VERGE_RSS_URL);
  if (!fetched.ok) {
    const detail = fetched.preview ? ` preview=${fetched.preview.slice(0, 80)}…` : '';
    return {
      ok: false,
      step: 'verge_rss_fetch',
      error: fetched.reason,
      message: `The Verge RSS를 가져오지 못했습니다: ${fetched.reason}${detail}`,
    };
  }

  let feed: Parser.Output<{ [key: string]: unknown }>;
  try {
    const parser = new Parser({
      timeout: 25_000,
      headers: {
        'User-Agent': VERGE_FETCH_USER_AGENT,
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
    });
    feed = await parser.parseString(fetched.xml);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[verge] RSS 문자열 파싱 실패', e);
    return {
      ok: false,
      step: 'verge_rss_parse',
      error: `PARSE:${msg}`,
      message: `The Verge RSS XML 파싱에 실패했습니다: ${msg}`,
    };
  }

  const rawFeed = feed.items ?? [];
  if (rawFeed.length === 0) {
    return {
      ok: false,
      step: 'verge_rss_parse',
      error: 'EMPTY_FEED',
      message: 'RSS 피드에 항목이 없습니다.',
    };
  }

  /** Hacker News `rankStoriesForSync`와 동일 — 제목에 AI 키워드가 있는 항목만 */
  const aiItems = rawFeed.filter((it) => titleMatchesAiKeywords((it.title ?? '').trim()));
  const items = aiItems.slice(0, MAX_NEW_POSTS_PER_RUN);

  if (items.length === 0) {
    console.warn('[verge] 피드에 AI 키워드 제목 기사 없음 — 등록 생략', { feedItems: rawFeed.length });
    return {
      ok: true,
      created: 0,
      scanned: rawFeed.length,
      force,
      results: [],
    };
  }

  const blocked = await loadBlockedOriginalUrls();
  const results: VergeItemResult[] = [];
  let created = 0;

  for (const item of items) {
    const rawLink = item.link?.trim();
    if (!isValidVergeArticleLink(rawLink)) {
      results.push({
        link: rawLink ?? '',
        status: 'skipped_invalid_link',
        detail: 'link가 없거나 theverge.com URL이 아님',
      });
      continue;
    }

    const link = normalizeUrl(rawLink).slice(0, 2048);

    if (!force && blocked.has(link)) {
      results.push({ link, status: 'skipped_duplicate' });
      continue;
    }

    const plain = rssPlainBody(item);
    if (plain.length < MIN_BODY_CHARS) {
      results.push({
        link,
        status: 'skipped_short_body',
        detail: `plainLength=${plain.length}`,
      });
      continue;
    }

    const sum = await summarizeVergeArticle(keyRes.key, item.title ?? '(제목 없음)', plain);
    if (!sum.ok) {
      console.warn('[verge] Gemini 요약 실패', sum.error);
      results.push({
        link,
        status: 'skipped_summary',
        detail: sum.error,
        step: 'gemini_summary',
      });
      continue;
    }

    const content = formatVergePostBody(link, sum.data);
    const title = sum.data.postTitle.trim() || item.title?.trim() || 'The Verge';

    try {
      const post = await prisma.post.create({
        data: {
          category: 'LOUNGE',
          title: title.slice(0, 200),
          content,
          thumbnail: null,
          attachmentUrls: [],
          tags: ['The Verge'],
          authorId: author.id,
          externalLink: link,
          vergeOriginalUrl: link,
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
          detail: '이미 등록된 원문 URL입니다(verge·geeknews·hn 중복).',
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
    `[verge] 동기화 종료 — 신규 ${created}건, 피드 ${rawFeed.length}건 중 AI 제목 후보 ${items.length}건 처리, force=${force}`,
  );

  return {
    ok: true,
    created,
    scanned: rawFeed.length,
    force,
    results,
  };
}
