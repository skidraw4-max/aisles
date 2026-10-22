import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { DigestFrequency } from '@prisma/client';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { ensurePrismaUser } from '@/lib/ensure-user';
import { prisma } from '@/lib/prisma';

type AuthResult = { user: SupabaseUser } | { error: string };

function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anon ? { url, anon } : null;
}

async function getAuthenticatedUser(req: NextRequest): Promise<AuthResult> {
  const env = getSupabaseEnv();
  if (!env) return { error: 'Supabase env not configured' as const };

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return { error: 'Missing token' as const };

  const supabase = createClient(env.url, env.anon);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user?.email) return { error: 'Invalid session' as const };
  return { user };
}

function parseDigestFrequency(value: unknown): DigestFrequency | null {
  if (value === 'DAILY' || value === 'WEEKLY') return value;
  if (value === 'daily') return 'DAILY';
  if (value === 'weekly') return 'WEEKLY';
  return null;
}

function authStatus(error: string): number {
  return error === 'Supabase env not configured' ? 500 : 401;
}

export async function GET(req: NextRequest) {
  const auth = await getAuthenticatedUser(req);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: authStatus(auth.error) });
  }

  const row = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: { newsletterSubscribed: true, digestFrequency: true },
  });

  return NextResponse.json({
    ok: true,
    subscribed: row?.newsletterSubscribed ?? false,
    digestFrequency: row?.digestFrequency ?? 'DAILY',
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await getAuthenticatedUser(req);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: authStatus(auth.error) });
  }

  let body: { subscribed?: unknown; digestFrequency?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.subscribed !== 'boolean') {
    return NextResponse.json({ error: 'subscribed 값이 필요합니다.' }, { status: 400 });
  }

  const digestFrequency = parseDigestFrequency(body.digestFrequency) ?? 'DAILY';
  await ensurePrismaUser(auth.user);

  const row = await prisma.user.update({
    where: { id: auth.user.id },
    data: {
      newsletterSubscribed: body.subscribed,
      digestFrequency,
    },
    select: { newsletterSubscribed: true, digestFrequency: true },
  });

  return NextResponse.json({
    ok: true,
    subscribed: row.newsletterSubscribed,
    digestFrequency: row.digestFrequency,
  });
}
