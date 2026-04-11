import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '@/lib/prisma';
import { isEmailVerifiedForApp, jsonEmailNotVerified } from '@/lib/auth-email-verified';

/** 로그인 세션으로 Prisma User의 닉네임 등을 조회 (헤더 표시용) */
export async function GET(req: NextRequest) {
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

  if (error || !user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }
  if (!isEmailVerifiedForApp(user)) {
    return jsonEmailNotVerified();
  }

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { username: true, email: true, avatarUrl: true },
  });

  if (!row) {
    return NextResponse.json({ username: null, email: user.email, avatarUrl: null });
  }

  return NextResponse.json({
    username: row.username,
    email: row.email,
    avatarUrl: row.avatarUrl,
  });
}
