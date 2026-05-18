import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '@/lib/prisma';
import { parseMbtiType } from '@/lib/ai-fortune/mbti';

export async function GET(req: NextRequest) {
  const user = await resolveUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { mbti: true },
  });
  return NextResponse.json({ mbti: row?.mbti ?? null });
}

/** MBTI 최초 1회만 설정 */
export async function PATCH(req: NextRequest) {
  const user = await resolveUser(req);
  if (!user?.email) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }

  let body: { mbti?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const mbti = parseMbtiType(body.mbti);
  if (!mbti) {
    return NextResponse.json(
      { error: '유효한 MBTI 16유형(예: INTJ)을 입력해 주세요.' },
      { status: 400 },
    );
  }

  const existing = await prisma.user.findUnique({
    where: { id: user.id },
    select: { mbti: true, username: true },
  });

  if (existing?.mbti) {
    return NextResponse.json(
      { error: 'MBTI는 최초 1회만 등록할 수 있습니다.', mbti: existing.mbti },
      { status: 409 },
    );
  }

  const emailLocal = user.email.split('@')[0] ?? 'user';
  const username = existing?.username ?? emailLocal;

  try {
    await prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: user.email,
        username,
        mbti,
        role: 'USER',
      },
      update: { mbti },
    });
    return NextResponse.json({ ok: true, mbti });
  } catch (e) {
    console.error('[profile/mbti]', e);
    return NextResponse.json({ error: 'MBTI 저장에 실패했습니다.' }, { status: 500 });
  }
}

async function resolveUser(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  const supabase = createClient(url, anon);
  const {
    data: { user },
  } = await supabase.auth.getUser(token);
  return user;
}
