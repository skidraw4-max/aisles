import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { fetchExternalArticlePlainText } from '@/lib/geeknews/extract-article-text';
import { formatGeekNewsPostBody } from '@/lib/geeknews/format-post-body';
import { parseGeekNewsNewListHtml } from '@/lib/geeknews/parse-list';
import { summarizeGeekNewsArticle } from '@/lib/geeknews/summarize';
import { readGeminiApiKeyFromEnv } from '@/lib/gemini-prompt-analysis-engine';

const GEEKNEWS_NEW_URL = 'https://news.hada.io/new';
export const MAX_NEW_POSTS_PER_RUN = 5;
export const MAX_LIST_SCAN = 35;
const MIN_BODY_CHARS = 120;

export type GeekNewsSyncStep =
  | 'admin_auth'
  | 'env_gemini'
  | 'author_missing'
  | 'geeknews_list_fetch'
  | 'geeknews_parse';

export type GeekNewsItemResult = {
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

export type GeekNewsSyncSuccess = {
  ok: true;
  created: number;
  scanned: number;
  force: boolean;
  results: GeekNewsItemResult[];
};

export type GeekNewsSyncFailure = {
  ok: false;
  step: GeekNewsSyncStep;
  error: string;
  /** 사람이 읽기 쉬운 한글 설명 */
  message: string;
};

export type GeekNewsSyncResult = GeekNewsSyncSuccess | GeekNewsSyncFailure;

export async function runGeekNewsSync(options: { force: boolean }): Promise<GeekNewsSyncResult> {
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

  const authorUsername = (process.env.GEEKNEWS_AUTHOR_USERNAME ?? 'Nedai').trim();
  const author = await prisma.user.findFirst({
    where: { username: authorUsername },
    select: { id: true },
  });
  if (!author) {
    return {
      ok: false,
      step: 'author_missing',
      error: `USER_NOT_FOUND:${authorUsername}`,
      message: `GeekNews 전용 작성자 사용자("${authorUsername}")를 찾을 수 없습니다.`,
    };
  }

  let listRes: Response;
  try {
    listRes = await fetch(GEEKNEWS_NEW_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AIsle-GeekNews/1.0)',
        Accept: 'text/html,*/*',
      },
      signal: AbortSignal.timeout(25_000),
      redirect: 'follow',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[geeknews] GeekNews 목록 요청 실패', e);
    return {
      ok: false,
      step: 'geeknews_list_fetch',
      error: `NETWORK:${msg}`,
      message: `GeekNews(${GEEKNEWS_NEW_URL})에 연결하지 못했습니다: ${msg}`,
    };
  }

  if (!listRes.ok) {
    console.error('[geeknews] GeekNews 목록 HTTP 오류', listRes.status);
    return {
      ok: false,
      step: 'geeknews_list_fetch',
      error: `HTTP_${listRes.status}`,
      message: `GeekNews 목록 페이지 응답 오류(HTTP ${listRes.status}).`,
    };
  }

  console.log('[geeknews] GeekNews 접속 성공');

  const listHtml = await listRes.text();
  const parsed = parseGeekNewsNewListHtml(listHtml);

  if (parsed.length === 0) {
    console.warn('[geeknews] 파싱 결과 0건 — 셀렉터·HTML 구조 확인 필요');
    return {
      ok: false,
      step: 'geeknews_parse',
      error: 'EMPTY_PARSE',
      message: 'GeekNews 셀렉터 오류 또는 목록이 비어 있습니다. HTML 구조가 바뀌었을 수 있습니다.',
    };
  }

  console.log(`[geeknews] 링크 ${parsed.length}개 추출 완료 (스캔 상한 ${MAX_LIST_SCAN}까지 사용)`);

  const existingRows = await prisma.post.findMany({
    where: {
      OR: [{ geeknewsOriginalUrl: { not: null } }, { hackerNewsOriginalUrl: { not: null } }],
    },
    select: { geeknewsOriginalUrl: true, hackerNewsOriginalUrl: true },
  });
  const existingUrls = new Set<string>();
  for (const r of existingRows) {
    if (r.geeknewsOriginalUrl) existingUrls.add(r.geeknewsOriginalUrl);
    if (r.hackerNewsOriginalUrl) existingUrls.add(r.hackerNewsOriginalUrl);
  }

  const scan = parsed.slice(0, MAX_LIST_SCAN);
  const results: GeekNewsItemResult[] = [];
  let created = 0;

  for (const item of scan) {
    if (created >= MAX_NEW_POSTS_PER_RUN) break;

    if (!force && existingUrls.has(item.externalUrl)) {
      results.push({ externalUrl: item.externalUrl, status: 'skipped_duplicate' });
      continue;
    }

    const fetchRes = await fetchExternalArticlePlainText(item.externalUrl);
    if (!fetchRes.ok) {
      console.warn(
        `[geeknews] 원문 접속 불가: ${item.externalUrl} → ${fetchRes.message} (${fetchRes.code})`,
      );
      results.push({
        externalUrl: item.externalUrl,
        status: 'skipped_fetch',
        step: '원문_fetch',
        detail: fetchRes.message,
      });
      continue;
    }

    const plain = fetchRes.text;
    console.log(`[geeknews] 원문 본문 길이: ${plain.length}자 (${item.title.slice(0, 40)}…)`);

    if (plain.length < MIN_BODY_CHARS) {
      results.push({
        externalUrl: item.externalUrl,
        status: 'skipped_short_body',
        detail: `plainLength=${plain.length}`,
      });
      continue;
    }

    const sum = await summarizeGeekNewsArticle(keyRes.key, item.title, plain);
    if (!sum.ok) {
      console.warn('[geeknews] Gemini 요약 실패', sum.error);
      results.push({
        externalUrl: item.externalUrl,
        status: 'skipped_summary',
        detail: sum.error,
        step: 'gemini_summary',
      });
      continue;
    }

    const topicUrl = `https://news.hada.io/topic?id=${encodeURIComponent(item.topicId)}`;
    const content = formatGeekNewsPostBody(item.externalUrl, topicUrl, sum.data);
    const title = sum.data.postTitle.trim() || item.title;

    try {
      const post = await prisma.post.create({
        data: {
          category: 'LOUNGE',
          title,
          content,
          thumbnail: null,
          attachmentUrls: [],
          tags: ['GeekNews'],
          authorId: author.id,
          geeknewsOriginalUrl: item.externalUrl.slice(0, 2048),
        },
      });
      existingUrls.add(item.externalUrl);
      created += 1;
      results.push({ externalUrl: item.externalUrl, status: 'created', postId: post.id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        results.push({
          externalUrl: item.externalUrl,
          status: 'error',
          step: 'db_unique',
          detail: '이미 등록된 GeekNews 원문 URL입니다(geeknewsOriginalUrl 중복).',
        });
      } else {
        results.push({
          externalUrl: item.externalUrl,
          status: 'error',
          step: 'db_create',
          detail: msg,
        });
      }
    }
  }

  console.log(`[geeknews] 동기화 종료 — 신규 ${created}건, 처리 항목 ${results.length}건, force=${force}`);

  return {
    ok: true,
    created,
    scanned: scan.length,
    force,
    results,
  };
}
