import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '@/lib/prisma';
import { sanitizeUsername } from '@/lib/username';

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
  let body: { username?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const raw = typeof body.username === 'string' ? body.username : '';
  if (!raw.trim()) {
    return NextResponse.json({ error: '닉네임을 입력해 주세요.' }, { status: 400 });
  }

  const emailLocal = user.email.split('@')[0] ?? 'user';
  let username = sanitizeUsername(raw, emailLocal);

  const taken = await prisma.user.findFirst({
    where: { username, NOT: { id: user.id } },
    select: { id: true },
  });
  if (taken) {
    username = sanitizeUsername(`${raw}_${user.id.slice(0, 8)}`, user.id.slice(0, 8));
  }

  try {
    await prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: user.email,
        username,
        role: 'USER',
      },
      update: { username },
    });
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { username: true, avatarUrl: true },
    });
    return NextResponse.json({
      ok: true,
      username: row?.username ?? username,
      avatarUrl: row?.avatarUrl ?? null,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: '프로필 저장에 실패했습니다.' }, { status: 500 });
  }
}
