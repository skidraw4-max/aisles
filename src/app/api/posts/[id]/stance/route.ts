import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUserFromBearer } from '@/lib/auth-bearer';
import { ensurePrismaUser } from '@/lib/ensure-user';
import type { StanceChoice } from '@prisma/client';

type Ctx = { params: Promise<{ id: string }> };

function isStance(v: unknown): v is StanceChoice {
  return v === 'AGREE' || v === 'DISAGREE';
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id: postId } = await ctx.params;
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
  if (!post) {
    return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 });
  }

  const [agree, disagree] = await Promise.all([
    prisma.postStance.count({ where: { postId, choice: 'AGREE' } }),
    prisma.postStance.count({ where: { postId, choice: 'DISAGREE' } }),
  ]);

  let mine: StanceChoice | null = null;
  const auth = await getUserFromBearer(req);
  if (auth.ok) {
    const row = await prisma.postStance.findUnique({
      where: { postId_userId: { postId, userId: auth.user.id } },
      select: { choice: true },
    });
    mine = row?.choice ?? null;
  }

  return NextResponse.json({ agree, disagree, mine });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await getUserFromBearer(req);
  if (!auth.ok) return auth.response;

  const { id: postId } = await ctx.params;
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
  if (!post) {
    return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 });
  }

  let body: { choice?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!isStance(body.choice)) {
    return NextResponse.json({ error: 'choice must be AGREE or DISAGREE' }, { status: 400 });
  }

  await ensurePrismaUser(auth.user);

  await prisma.postStance.upsert({
    where: { postId_userId: { postId, userId: auth.user.id } },
    create: { postId, userId: auth.user.id, choice: body.choice },
    update: { choice: body.choice },
  });

  const [agree, disagree] = await Promise.all([
    prisma.postStance.count({ where: { postId, choice: 'AGREE' } }),
    prisma.postStance.count({ where: { postId, choice: 'DISAGREE' } }),
  ]);

  return NextResponse.json({ agree, disagree, mine: body.choice });
}
