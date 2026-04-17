/**
 * GeekNews → 요약 → GOSSIP 자동 등록 (Vercel Cron)
 *
 * - 환경: `CRON_SECRET`(필수), `GOOGLE_GENERATIVE_AI_API_KEY` 또는 `GEMINI_API_KEY`, Prisma `User.username` 기본 `Nedai` (`GEEKNEWS_AUTHOR_USERNAME`으로 변경 가능)
 * - 스케줄: `vercel.json` — `0 20 * * *` (UTC) ≈ 한국 시간 새벽 5시
 * - Vercel 대시보드 Cron에 동일 경로 등록 후, 프로젝트 환경 변수에 `CRON_SECRET` 설정
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchExternalArticlePlainText } from '@/lib/geeknews/extract-article-text';
import { formatGeekNewsPostBody } from '@/lib/geeknews/format-post-body';
import { parseGeekNewsNewListHtml } from '@/lib/geeknews/parse-list';
import { summarizeGeekNewsArticle } from '@/lib/geeknews/summarize';
import { readGeminiApiKeyFromEnv } from '@/lib/gemini-prompt-analysis-engine';

export const maxDuration = 300;

const GEEKNEWS_NEW_URL = 'https://news.hada.io/new';
const MAX_NEW_POSTS_PER_RUN = 5;
const MAX_LIST_SCAN = 35;
/** 원문이 너무 짧으면 요약 품질이 떨어져 스킵 */
const MIN_BODY_CHARS = 120;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn('[cron/geeknews] CRON_SECRET unset — refusing to run');
    return false;
  }
  const auth = req.headers.get('authorization')?.trim();
  return auth === `Bearer ${secret}`;
}

/**
 * Vercel Cron: `vercel.json`에서 스케줄 등록.
 * 한국 새벽 5시 ≈ 매일 UTC 20:00 (`0 20 * * *`).
 */
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const keyRes = readGeminiApiKeyFromEnv();
  if (!keyRes.ok) {
    return NextResponse.json({ error: 'Missing GOOGLE_GENERATIVE_AI_API_KEY / GEMINI_API_KEY' }, { status: 500 });
  }

  const authorUsername = (process.env.GEEKNEWS_AUTHOR_USERNAME ?? 'Nedai').trim();
  const author = await prisma.user.findFirst({
    where: { username: authorUsername },
    select: { id: true },
  });
  if (!author) {
    return NextResponse.json(
      {
        error: `Prisma User not found for username "${authorUsername}". Create Supabase user + matching User row.`,
      },
      { status: 500 },
    );
  }

  const listRes = await fetch(GEEKNEWS_NEW_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AIsle-GeekNews/1.0)',
      Accept: 'text/html,*/*',
    },
    signal: AbortSignal.timeout(25_000),
    redirect: 'follow',
  });
  if (!listRes.ok) {
    return NextResponse.json({ error: `GeekNews list HTTP ${listRes.status}` }, { status: 502 });
  }
  const listHtml = await listRes.text();
  const parsed = parseGeekNewsNewListHtml(listHtml);

  const existingRows = await prisma.post.findMany({
    where: { geeknewsOriginalUrl: { not: null } },
    select: { geeknewsOriginalUrl: true },
  });
  const existingUrls = new Set(
    existingRows.map((r) => r.geeknewsOriginalUrl).filter((u): u is string => Boolean(u)),
  );

  const scan = parsed.slice(0, MAX_LIST_SCAN);
  const results: {
    externalUrl: string;
    status: 'created' | 'skipped_duplicate' | 'skipped_short_body' | 'skipped_summary' | 'error';
    detail?: string;
    postId?: string;
  }[] = [];

  let created = 0;

  for (const item of scan) {
    if (created >= MAX_NEW_POSTS_PER_RUN) break;

    if (existingUrls.has(item.externalUrl)) {
      results.push({ externalUrl: item.externalUrl, status: 'skipped_duplicate' });
      continue;
    }

    const plain = await fetchExternalArticlePlainText(item.externalUrl);
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
      results.push({
        externalUrl: item.externalUrl,
        status: 'skipped_summary',
        detail: sum.error,
      });
      continue;
    }

    const topicUrl = `https://news.hada.io/topic?id=${encodeURIComponent(item.topicId)}`;
    const content = formatGeekNewsPostBody(item.externalUrl, topicUrl, sum.data);
    const title = sum.data.postTitle.trim() || item.title;

    try {
      const post = await prisma.post.create({
        data: {
          category: 'GOSSIP',
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
      results.push({ externalUrl: item.externalUrl, status: 'error', detail: msg });
    }
  }

  return NextResponse.json({
    ok: true,
    created,
    scanned: scan.length,
    results,
  });
}
