import { prisma } from '@/lib/prisma';
import { normalizePostTagsInput } from '@/lib/post-tags';
import { corridorLabel, getAllUiLabels } from '@/lib/ui-config';
import type { Category, Prisma } from '@prisma/client';

const MAX_QUERY_LEN = 120;
const MAX_RESULTS = 50;

export type SearchPostsParams = {
  q?: string;
  /** 쿼리 `tag` — `normalizePostTagsInput` 후 첫 태그만 사용 */
  tag?: string;
};

export type SearchPostHit = {
  id: string;
  title: string;
  category: Category;
  categoryLabel: string;
  authorUsername: string;
  createdAt: Date;
  snippet: string | null;
};

function firstNormalizedTag(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const tags = normalizePostTagsInput(raw);
  return tags[0];
}

/** 제목·본문·작성자명 부분 일치(대소문자 무시) + 선택적 태그 필터(배열 정확 일치) */
export async function searchPosts(params: SearchPostsParams): Promise<SearchPostHit[]> {
  const q = (params.q ?? '').trim();
  const tag = firstNormalizedTag(params.tag);

  if (!q && !tag) return [];
  if (q.length > MAX_QUERY_LEN) return [];

  const parts: Prisma.PostWhereInput[] = [];
  if (tag) parts.push({ tags: { has: tag } });
  if (q.length > 0) {
    parts.push({
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { content: { contains: q, mode: 'insensitive' } },
        { author: { username: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }

  const where: Prisma.PostWhereInput = parts.length === 1 ? parts[0]! : { AND: parts };

  let posts;
  try {
    posts = await prisma.post.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: MAX_RESULTS,
      select: {
        id: true,
        title: true,
        category: true,
        content: true,
        createdAt: true,
        author: { select: { username: true } },
      },
    });
  } catch (err) {
    console.error('[searchPosts]', err);
    return [];
  }

  const ui = await getAllUiLabels();

  return posts.map((p) => {
    const snippet =
      p.content && p.content.length > 0
        ? p.content.length > 160
          ? `${p.content.slice(0, 160)}…`
          : p.content
        : null;
    return {
      id: p.id,
      title: p.title,
      category: p.category,
      categoryLabel: corridorLabel(ui, p.category),
      authorUsername: p.author.username,
      createdAt: p.createdAt,
      snippet,
    };
  });
}

