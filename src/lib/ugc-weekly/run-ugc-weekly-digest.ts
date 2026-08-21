import { prisma } from '@/lib/prisma';
import { fetchUgcWeeklyTop } from '@/lib/ugc-hub.server';
import { isoWeekKey } from '@/lib/games/ranking';
import { ugcWeeklyDigestTag } from '@/lib/ugc-weekly/week-key';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
import type { HomeFeedPost } from '@/lib/home-feed';

export type UgcWeeklySyncResult = {
  ok: boolean;
  weekKey: string;
  results: Array<{
    category: 'BUILD' | 'LAUNCH';
    status: 'created' | 'skipped_exists' | 'skipped_empty';
    postId?: string;
    error?: string;
  }>;
};

function formatWeekLabel(weekKey: string): string {
  return weekKey.replace('-W', '년 W');
}

function buildBody(
  category: 'BUILD' | 'LAUNCH',
  weekKey: string,
  posts: HomeFeedPost[],
  base: string
): string {
  const label = category === 'BUILD' ? 'BUILD 제작기' : 'LAUNCH 출시';
  const lines = [
    `이번 주(${weekKey}) ${label} 좋아요 상위 게시물을 모았습니다.`,
    '',
    ...posts.map((p, i) => {
      const url = `${base}/post/${p.id}`;
      return `${i + 1}. [${p.title}](${url}) — ❤️ ${p.likeCount} · @${p.author.username}`;
    }),
    '',
    `→ [${label} 복도 보기](${base}/?category=${category})`,
    '',
    '_AIsle 주간 베스트 (자동 발행)_',
  ];
  return lines.join('\n');
}

async function resolveAuthorId(): Promise<string | null> {
  const authorUsername = (
    process.env.UGC_WEEKLY_AUTHOR_USERNAME ??
    process.env.AI_FORTUNE_AUTHOR_USERNAME ??
    process.env.HACKERNEWS_AUTHOR_USERNAME ??
    process.env.GEEKNEWS_AUTHOR_USERNAME ??
    'Nedai'
  ).trim();
  const author = await prisma.user.findUnique({
    where: { username: authorUsername },
    select: { id: true },
  });
  return author?.id ?? null;
}

async function publishOne(
  category: 'BUILD' | 'LAUNCH',
  weekKey: string,
  authorId: string,
  base: string
): Promise<UgcWeeklySyncResult['results'][number]> {
  const digestTag = ugcWeeklyDigestTag(category, weekKey);
  const existing = await prisma.post.findFirst({
    where: { category, tags: { has: digestTag } },
    select: { id: true },
  });
  if (existing) {
    return { category, status: 'skipped_exists', postId: existing.id };
  }

  const top = await fetchUgcWeeklyTop(category, 5);
  if (top.length === 0) {
    return { category, status: 'skipped_empty' };
  }

  const title =
    category === 'BUILD'
      ? `BUILD 주간 베스트 · ${formatWeekLabel(weekKey)}`
      : `LAUNCH 주간 베스트 · ${formatWeekLabel(weekKey)}`;

  const thumbnail = top.find((p) => p.thumbnail?.trim())?.thumbnail ?? null;

  try {
    const post = await prisma.post.create({
      data: {
        category,
        title,
        content: buildBody(category, weekKey, top, base),
        thumbnail,
        authorId,
        tags: [digestTag, 'weekly-best', category.toLowerCase()],
        isFeatured: true,
      },
      select: { id: true },
    });
    return { category, status: 'created', postId: post.id };
  } catch (err) {
    return {
      category,
      status: 'skipped_empty',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Create weekly BUILD + LAUNCH digest posts (idempotent per ISO week). */
export async function runUgcWeeklyDigestSync(
  options: { weekKey?: string } = {}
): Promise<UgcWeeklySyncResult> {
  const weekKey = options.weekKey ?? isoWeekKey();
  const authorId = await resolveAuthorId();
  if (!authorId) {
    return {
      ok: false,
      weekKey,
      results: [
        { category: 'BUILD', status: 'skipped_empty', error: 'AUTHOR_NOT_FOUND' },
        { category: 'LAUNCH', status: 'skipped_empty', error: 'AUTHOR_NOT_FOUND' },
      ],
    };
  }

  const base = getCanonicalSiteUrl().replace(/\/$/, '');
  const results = [];
  for (const category of ['BUILD', 'LAUNCH'] as const) {
    results.push(await publishOne(category, weekKey, authorId, base));
  }

  const ok = !results.some((r) => Boolean(r.error));
  return { ok, weekKey, results };
}
