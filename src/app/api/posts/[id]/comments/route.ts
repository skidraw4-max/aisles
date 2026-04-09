import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUserFromBearer } from '@/lib/auth-bearer';
import { ensurePrismaUser } from '@/lib/ensure-user';

type Ctx = { params: Promise<{ id: string }> };

const MAX_LEN = 2000;

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id: postId } = await ctx.params;

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true },
  });
  if (!post) {
    return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 });
  }

  const comments = await prisma.comment.findMany({
    where: { postId },
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { id: true, username: true, avatarUrl: true } } },
  });

  return NextResponse.json({
    comments: comments.map((c) => ({
      id: c.id,
      content: c.content,
      createdAt: c.createdAt.toISOString(),
      authorId: c.authorId,
      authorUsername: c.author.username,
      authorAvatarUrl: c.author.avatarUrl,
    })),
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await getUserFromBearer(req);
  if (!auth.ok) return auth.response;

  const { id: postId } = await ctx.params;

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true },
  });
  if (!post) {
    return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 });
  }

  let body: { content?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const raw = typeof body.content === 'string' ? body.content.trim() : '';
  if (!raw) {
    return NextResponse.json({ error: '댓글 내용을 입력해 주세요.' }, { status: 400 });
  }
  if (raw.length > MAX_LEN) {
    return NextResponse.json({ error: `댓글은 ${MAX_LEN}자 이하여야 합니다.` }, { status: 400 });
  }

  await ensurePrismaUser(auth.user);

  try {
    const c = await prisma.comment.create({
      data: {
        postId,
        authorId: auth.user.id,
        content: raw,
      },
      include: { author: { select: { id: true, username: true, avatarUrl: true } } },
    });
    return NextResponse.json({
      comment: {
        id: c.id,
        content: c.content,
        createdAt: c.createdAt.toISOString(),
        authorId: c.authorId,
        authorUsername: c.author.username,
        authorAvatarUrl: c.author.avatarUrl,
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: '댓글 저장에 실패했습니다.' }, { status: 500 });
  }
}
