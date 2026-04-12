import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import type { Category } from '@prisma/client';
import {
  HOT_POPULARITY_LIKE_WEIGHT,
  HOT_POPULARITY_VIEW_WEIGHT,
} from '@/lib/hot-popularity';
import { prisma } from '@/lib/prisma';

const PAGE_SIZE = 10;

const QUERY_TO_CATEGORY: Record<string, Category> = {
  LAB: 'RECIPE',
  GALLERY: 'GALLERY',
  LOUNGE: 'LOUNGE',
  GOSSIP: 'GOSSIP',
  BUILD: 'BUILD',
  LAUNCH: 'LAUNCH',
};

function categoryWhere(raw: string): Prisma.Sql {
  const key = raw.trim().toUpperCase();
  const cat = QUERY_TO_CATEGORY[key];
  if (!cat) return Prisma.sql`TRUE`;
  return Prisma.sql`p.category = ${cat}::"Category"`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const categoryKey = searchParams.get('category') ?? 'ALL';
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const skip = (page - 1) * PAGE_SIZE;

  try {
    const whereSql = categoryWhere(categoryKey);

    const totalRows = await prisma.$queryRaw<[{ c: bigint }]>`
      SELECT COUNT(*)::bigint AS c FROM "Post" p WHERE ${whereSql}
    `;
    const total = Number(totalRows[0]?.c ?? BigInt(0));
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const rows = await prisma.$queryRaw<{ id: string; commentCount: bigint }[]>`
      SELECT p.id, COUNT(c.id)::bigint AS "commentCount"
      FROM "Post" p
      LEFT JOIN "Comment" c ON c."postId" = p.id
      WHERE ${whereSql}
      GROUP BY p.id
      ORDER BY COUNT(c.id) DESC, (p."likeCount" * ${HOT_POPULARITY_LIKE_WEIGHT} + p."views" * ${HOT_POPULARITY_VIEW_WEIGHT}) DESC, p."createdAt" DESC
      LIMIT ${PAGE_SIZE} OFFSET ${skip}
    `;

    const ids = rows.map((r) => r.id);
    const commentById = new Map(rows.map((r) => [r.id, Number(r.commentCount)]));

    if (ids.length === 0) {
      return NextResponse.json({
        page,
        totalPages,
        total,
        items: [] as { id: string; title: string; commentCount: number; rank: number }[],
      });
    }

    const posts = await prisma.post.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true },
    });
    const order = new Map(ids.map((id, i) => [id, i]));
    posts.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    const items = posts.map((p, i) => ({
      id: p.id,
      title: p.title,
      commentCount: commentById.get(p.id) ?? 0,
      rank: skip + i + 1,
    }));

    return NextResponse.json({ page, totalPages, total, items });
  } catch (err) {
    console.error('[api/home-best]', { categoryKey, err });
    return NextResponse.json({
      page,
      totalPages: 1,
      total: 0,
      items: [] as { id: string; title: string; commentCount: number; rank: number }[],
    });
  }
}
