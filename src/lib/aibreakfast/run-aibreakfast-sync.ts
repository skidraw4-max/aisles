import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { readGeminiApiKeyFromEnv } from '@/lib/gemini-prompt-analysis-engine';
import { loadBlockedSyndicationUrls } from '@/lib/news-sync/blocked-original-urls';
import { NEWS_SYNC_GEMINI_GAP_MS, sleepMs } from '@/lib/news-sync/gemini-request-gap';
import {
  AI_BREAKFAST_HOME,
  extractLatestPostPathFromMain,
  extractNewsletterPlainText,
  extractSiteLogoUrl,
  fetchHtml,
} from '@/lib/aibreakfast/scrape-beehiiv';
import { summarizeAiBreakfastNewsletter } from '@/lib/aibreakfast/summarize-aibreakfast';
import { formatAiBreakfastPostBody } from '@/lib/aibreakfast/format-aibreakfast-body';

/** 메인에서 가져오는 최신 포스트는 1개 */
export const MAX_AIBREAKFAST_POSTS_PER_RUN = 1;
const MIN_BODY_CHARS = 120;

export type AiBreakfastSyncStep =
  | 'admin_auth'
  | 'env_gemini'
  | 'author_missing'
  | 'aibreakfast_home_fetch'
  | 'aibreakfast_parse'
  | 'aibreakfast_post_fetch';

export type AiBreakfastItemResult = {
  link: string;
  status:
    | 'created'
    | 'skipped_duplicate'
    | 'skipped_short_body'
    | 'skipped_summary'
    | 'error'
    | 'skipped_invalid_link'
    | 'skipped_no_post_link';
  detail?: string;
  postId?: string;
  step?: string;
};

export type AiBreakfastSyncSuccess = {
  ok: true;
  created: number;
  scanned: number;
  force: boolean;
  results: AiBreakfastItemResult[];
};

export type AiBreakfastSyncFailure = {
  ok: false;
  step: AiBreakfastSyncStep;
  error: string;
  message: string;
};

export type AiBreakfastSyncResult = AiBreakfastSyncSuccess | AiBreakfastSyncFailure;

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    return u.toString();
  } catch {
    return url.trim();
  }
}

export async function runAiBreakfastSync(options: { force: boolean }): Promise<AiBreakfastSyncResult> {
  try {
    return await runAiBreakfastSyncInner(options);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[aibreakfast] runAiBreakfastSync 예외 — 결과 객체로 반환', e);
    return {
      ok: false,
      step: 'aibreakfast_home_fetch',
      error: `UNHANDLED:${msg}`,
      message: `AI Breakfast 동기화 중 예외: ${msg}`,
    };
  }
}

async function runAiBreakfastSyncInner(options: { force: boolean }): Promise<AiBreakfastSyncResult> {
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
      message: `AI Breakfast 자동 수집용 작성자("${authorUsername}")를 찾을 수 없습니다.`,
    };
  }

  console.log('[aibreakfast] 메인 페이지 요청…', AI_BREAKFAST_HOME);
  const mainRes = await fetchHtml(AI_BREAKFAST_HOME);
  if (!mainRes.ok) {
    return {
      ok: false,
      step: 'aibreakfast_home_fetch',
      error: `NETWORK:${mainRes.message}`,
      message: `AI Breakfast 메인 페이지를 불러오지 못했습니다: ${mainRes.message}`,
    };
  }

  const postUrlRaw = extractLatestPostPathFromMain(mainRes.html, AI_BREAKFAST_HOME);
  if (!postUrlRaw) {
    return {
      ok: false,
      step: 'aibreakfast_parse',
      error: 'NO_POST_LINK',
      message: '메인 페이지에서 /p/ 포스트 링크를 찾지 못했습니다.',
    };
  }

  const link = normalizeUrl(postUrlRaw).slice(0, 2048);
  const logoUrl = extractSiteLogoUrl(mainRes.html, AI_BREAKFAST_HOME);
  console.log('[aibreakfast] 최신 포스트 URL:', link, logoUrl ? `(로고 ${logoUrl.slice(0, 64)}…)` : '(로고 없음)');

  const blocked = await loadBlockedSyndicationUrls();
  const results: AiBreakfastItemResult[] = [];

  if (!force && blocked.has(link)) {
    results.push({ link, status: 'skipped_duplicate' });
    return {
      ok: true,
      created: 0,
      scanned: 1,
      force,
      results,
    };
  }

  console.log('[aibreakfast] 상세 페이지 요청…');
  const postRes = await fetchHtml(link);
  if (!postRes.ok) {
    return {
      ok: false,
      step: 'aibreakfast_post_fetch',
      error: `NETWORK:${postRes.message}`,
      message: `포스트 페이지를 불러오지 못했습니다: ${postRes.message}`,
    };
  }

  const plain = extractNewsletterPlainText(postRes.html);
  if (plain.length < MIN_BODY_CHARS) {
    results.push({
      link,
      status: 'skipped_short_body',
      detail: `plainLength=${plain.length}`,
    });
    return {
      ok: true,
      created: 0,
      scanned: 1,
      force,
      results,
    };
  }

  console.log('[aibreakfast] 3초 대기 중… (Gemini rate limit 완화)');
  await sleepMs(NEWS_SYNC_GEMINI_GAP_MS);
  console.log('[aibreakfast] 1번 기사 요약 시작 (Gemini — 핵심 주제 3가지)');

  let sum: Awaited<ReturnType<typeof summarizeAiBreakfastNewsletter>>;
  try {
    console.log('[aibreakfast] 1번 기사 요약 중… (Gemini 호출)');
    sum = await summarizeAiBreakfastNewsletter(keyRes.key, plain);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[aibreakfast] Gemini 요약 예외 — 건너뜀', msg);
    results.push({
      link,
      status: 'skipped_summary',
      detail: msg,
      step: 'gemini_summary_throw',
    });
    return {
      ok: true,
      created: 0,
      scanned: 1,
      force,
      results,
    };
  }

  if (!sum.ok) {
    console.warn('[aibreakfast] Gemini 요약 실패 — 건너뜀', sum.error);
    results.push({
      link,
      status: 'skipped_summary',
      detail: sum.error,
      step: 'gemini_summary',
    });
    return {
      ok: true,
      created: 0,
      scanned: 1,
      force,
      results,
    };
  }

  const content = formatAiBreakfastPostBody(link, sum.data);
  const title = sum.data.postTitle.trim().slice(0, 200) || 'AI Breakfast';

  try {
    const post = await prisma.post.create({
      data: {
        category: 'LOUNGE',
        title,
        content,
        thumbnail: logoUrl ? logoUrl.slice(0, 2048) : null,
        attachmentUrls: [],
        tags: ['AI Breakfast', 'Newsletter'],
        authorId: author.id,
        externalLink: link,
        aiBreakfastOriginalUrl: link,
      },
    });
    blocked.add(link);
    results.push({ link, status: 'created', postId: post.id });
    console.log('[aibreakfast] 등록 완료', post.id);
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

  const created = results.some((r) => r.status === 'created') ? 1 : 0;
  console.log(`[aibreakfast] 동기화 종료 — 신규 ${created}건, force=${force}`);

  return {
    ok: true,
    created,
    scanned: 1,
    force,
    results,
  };
}
