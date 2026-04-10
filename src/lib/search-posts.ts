import { prisma } from '@/lib/prisma';
import { POST_CATEGORY_OPTIONS } from '@/lib/post-categories';
import type { Category } from '@prisma/client';

const MAX_QUERY_LEN = 120;
const MAX_RESULTS = 50;

export type SearchPostHit = {
  id: string;
  title: string;
  category: Category;
  categoryLabel: string;
  authorUsername: string;
  createdAt: Date;
  snippet: string | null;
};

function categoryLabel(c: Category): string {
  return POST_CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c;
}

/** 제목·본문·작성자명 부분 일치 (대소문자 무시) */
export async function searchPostsByQuery(raw: string): Promise<SearchPostHit[]> {
  const q = raw.trim();
  if (q.length < 1 || q.length > MAX_QUERY_LEN) {
    return [];
  }

  let posts;
  try {
    posts = await prisma.post.findMany({
      where: {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { content: { contains: q, mode: 'insensitive' } },
          { author: { username: { contains: q, mode: 'insensitive' } } },
        ],
      },
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
    console.error('[searchPostsByQuery]', err);
    return [];
  }

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
      categoryLabel: categoryLabel(p.category),
      authorUsername: p.author.username,
      createdAt: p.createdAt,
      snippet,
    };
  });
}
