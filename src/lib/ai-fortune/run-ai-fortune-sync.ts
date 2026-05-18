import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { readGeminiApiKeyFromEnv } from '@/lib/gemini-prompt-analysis-engine';
import { loadAiFortuneAggregateContext } from '@/lib/ai-fortune/aggregate-context';
import { formatAiFortunePostBody } from '@/lib/ai-fortune/format-fortune-body';
import { generateAiFortuneWeeklyContent } from '@/lib/ai-fortune/generate-weekly-fortune';
import {
  aiFortuneWeekKey,
  getKstParts,
  isScheduledAiFortuneCronWindow,
  weekOfMonthKst,
} from '@/lib/ai-fortune/kst-week';
import { resolveAiFortuneThumbnailUrl } from '@/lib/ai-fortune/thumbnail';

export type AiFortuneSyncStep =
  | 'env_gemini'
  | 'author_missing'
  | 'gemini_generate'
  | 'db_create'
  | 'skipped_window'
  | 'skipped_exists';

export type AiFortuneSyncSuccess = {
  ok: true;
  status: 'created' | 'skipped_exists' | 'skipped_window';
  weekKey: string;
  postId?: string;
  force: boolean;
  bootstrap: boolean;
};

export type AiFortuneSyncFailure = {
  ok: false;
  step: AiFortuneSyncStep;
  error: string;
  message: string;
};

export type AiFortuneSyncResult = AiFortuneSyncSuccess | AiFortuneSyncFailure;

export type RunAiFortuneSyncOptions = {
  /** true면 동일 주차 글이 있어도 재생성 시도하지 않음 — 현재는 스킵만 (재생성은 force+삭제 별도) */
  force?: boolean;
  /** true면 월요일 05:00 KST 윈도우 검사 생략 (배포 직후·수동 부트스트랩) */
  bootstrap?: boolean;
};

function weekLabelFromDate(date: Date): string {
  const { year, month } = getKstParts(date);
  return `${year}년 ${month}월 ${weekOfMonthKst(date)}주차`;
}

export async function runAiFortuneSync(
  options: RunAiFortuneSyncOptions = {},
): Promise<AiFortuneSyncResult> {
  const force = Boolean(options.force);
  const bootstrap = Boolean(options.bootstrap);
  const now = new Date();
  const weekKey = aiFortuneWeekKey(now);
  const weekLabel = weekLabelFromDate(now);

  if (!bootstrap && !force && !isScheduledAiFortuneCronWindow(now)) {
    console.log('[ai-fortune] 스케줄 윈도우 밖 — 월요일 05:00 KST만 자동 실행');
    return {
      ok: true,
      status: 'skipped_window',
      weekKey,
      force,
      bootstrap,
    };
  }

  const existing = await prisma.post.findUnique({
    where: { aiFortuneWeekKey: weekKey },
    select: { id: true },
  });
  if (existing && !force) {
    console.log('[ai-fortune] 이미 이번 주 게시됨', { weekKey, postId: existing.id });
    return {
      ok: true,
      status: 'skipped_exists',
      weekKey,
      postId: existing.id,
      force,
      bootstrap,
    };
  }

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
    process.env.AI_FORTUNE_AUTHOR_USERNAME ??
    process.env.HACKERNEWS_AUTHOR_USERNAME ??
    process.env.GEEKNEWS_AUTHOR_USERNAME ??
    'Nedai'
  ).trim();

  const author = await prisma.user.findUnique({
    where: { username: authorUsername },
    select: { id: true },
  });
  if (!author) {
    return {
      ok: false,
      step: 'author_missing',
      error: 'AUTHOR_NOT_FOUND',
      message: `AI FORTUNE 작성자("${authorUsername}")를 찾을 수 없습니다.`,
    };
  }

  const aggregate = await loadAiFortuneAggregateContext();
  const generated = await generateAiFortuneWeeklyContent(keyRes.key, aggregate, weekLabel);
  if (!generated.ok) {
    return {
      ok: false,
      step: 'gemini_generate',
      error: 'GEMINI_FAILED',
      message: generated.error,
    };
  }

  const content = formatAiFortunePostBody(generated.data, weekLabel);
  const thumbnail = resolveAiFortuneThumbnailUrl();

  try {
    const post = await prisma.post.create({
      data: {
        category: 'AI_FORTUNE',
        title: generated.title,
        content,
        thumbnail,
        attachmentUrls: [],
        tags: ['AI FORTUNE', '주간 운세', '커리어'],
        authorId: author.id,
        aiFortuneWeekKey: weekKey,
      },
    });
    console.log('[ai-fortune] 주간 게시 완료', { weekKey, postId: post.id, bootstrap });
    return {
      ok: true,
      status: 'created',
      weekKey,
      postId: post.id,
      force,
      bootstrap,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const dup = await prisma.post.findUnique({
        where: { aiFortuneWeekKey: weekKey },
        select: { id: true },
      });
      if (dup) {
        return {
          ok: true,
          status: 'skipped_exists',
          weekKey,
          postId: dup.id,
          force,
          bootstrap,
        };
      }
    }
    console.error('[ai-fortune] DB 생성 실패', e);
    return {
      ok: false,
      step: 'db_create',
      error: 'DB_CREATE_FAILED',
      message: msg,
    };
  }
}
