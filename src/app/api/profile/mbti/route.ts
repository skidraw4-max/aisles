import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '@/lib/prisma';
import { parseMbtiType } from '@/lib/ai-fortune/mbti';

export async function PATCH(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json({ error: 'Supabase env not configured' }, { status: 500 });
  }

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 401 });
  }

  const supabase = createClient(url, anon);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user?.email) {
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
      { error: '유효한 MBTI 유형(16가지)을 선택해 주세요.' },
      { status: 400 },
    );
  }

  try {
    await prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: user.email,
        username: user.email.split('@')[0] ?? 'user',
        role: 'USER',
        mbti,
      },
      update: { mbti },
    });
    return NextResponse.json({ ok: true, mbti });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'MBTI 저장에 실패했습니다.' }, { status: 500 });
  }
}
