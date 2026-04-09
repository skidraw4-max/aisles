import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '@/lib/prisma';
import { sanitizeUsername } from '@/lib/username';

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json({ error: 'Supabase env not configured' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '');
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

  const metaName = user.user_metadata?.username as string | undefined;
  const emailLocal = user.email.split('@')[0] ?? 'user';
  let username = sanitizeUsername(metaName ?? '', emailLocal);

  const taken = await prisma.user.findFirst({
    where: { username, NOT: { id: user.id } },
    select: { id: true },
  });
  if (taken) {
    username = sanitizeUsername(`${metaName ?? emailLocal}_${user.id.slice(0, 8)}`, user.id.slice(0, 8));
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
      update: {
        email: user.email,
        ...(metaName?.trim() ? { username } : {}),
      },
    });
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { username: true },
    });
    return NextResponse.json({ ok: true, username: row?.username ?? username });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Profile sync failed' }, { status: 500 });
  }
}
