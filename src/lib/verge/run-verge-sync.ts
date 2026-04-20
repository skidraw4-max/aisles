import Parser from 'rss-parser';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { htmlToPlainText } from '@/lib/geeknews/extract-article-text';
import { readGeminiApiKeyFromEnv } from '@/lib/gemini-prompt-analysis-engine';
import { summarizeVergeArticle } from '@/lib/verge/summarize-verge';
import { formatVergePostBody } from '@/lib/verge/format-verge-body';

export const VERGE_TECH_RSS = 'https://www.theverge.com/tech/rss/index.xml';
export const MAX_NEW_POSTS_PER_RUN = 5;
const MIN_BODY_CHARS = 120;

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

function extractThumbnail(item: Parser.Item): string | null {
  const enc = item.enclosure;
  if (enc?.url && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(enc.url)) {
    return enc.url.trim();
  }
  const raw = item as Record<string, unknown>;
  const thumb = raw['media:thumbnail'] as { $?: { url?: string } } | undefined;
  if (thumb?.$?.url) return String(thumb.$.url).trim();
  const content = item.content ?? item.summary ?? '';
  if (typeof content === 'string') {
    const m = content.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m?.[1]) return m[1].trim();
  }
  return null;
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

  const authorUsername = (process.env.VERGE_AUTHOR_USERNAME ?? 'admin').trim();
  const author = await prisma.user.findFirst({
    where: { username: authorUsername },
    select: { id: true },
  });
  if (!author) {
    return {
      ok: false,
      step: 'author_missing',
      error: `USER_NOT_FOUND:${authorUsername}`,
      message: `The Verge 전용 작성자 사용자("${authorUsername}")를 찾을 수 없습니다.`,
    };
  }

  let feed: Parser.Output<{ [key: string]: unknown }>;
  try {
    const parser = new Parser({
      timeout: 25_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AIsle-VergeRSS/1.0; +https://github.com/skidraw4-max/aisles)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
    });
    feed = await parser.parseURL(VERGE_TECH_RSS);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[verge] RSS 요청 실패', e);
    return {
      ok: false,
      step: 'verge_rss_fetch',
      error: `NETWORK:${msg}`,
      message: `The Verge RSS에 연결하지 못했습니다: ${msg}`,
    };
  }

  const items = (feed.items ?? []).slice(0, MAX_NEW_POSTS_PER_RUN);
  if (items.length === 0) {
    return {
      ok: false,
      step: 'verge_rss_parse',
      error: 'EMPTY_FEED',
      message: 'RSS 피드에 항목이 없습니다.',
    };
  }

  const blocked = await loadBlockedOriginalUrls();
  const results: VergeItemResult[] = [];
  let created = 0;

  for (const item of items) {
    if (created >= MAX_NEW_POSTS_PER_RUN) break;

    const rawLink = item.link?.trim();
    if (!rawLink || (!rawLink.startsWith('http://') && !rawLink.startsWith('https://'))) {
      results.push({ link: rawLink ?? '', status: 'skipped_invalid_link' });
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
    const thumb = extractThumbnail(item);

    try {
      const post = await prisma.post.create({
        data: {
          category: 'TREND',
          title: title.slice(0, 200),
          content,
          thumbnail: thumb ? thumb.slice(0, 2048) : null,
          attachmentUrls: [],
          tags: ['The Verge', 'Tech'],
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

  console.log(`[verge] 동기화 종료 — 신규 ${created}건, 스캔 ${items.length}건, force=${force}`);

  return {
    ok: true,
    created,
    scanned: items.length,
    force,
    results,
  };
}
