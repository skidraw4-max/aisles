import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';
import { isEmailVerifiedForApp, jsonEmailNotVerified } from '@/lib/auth-email-verified';

export async function getUserFromBearer(
  req: NextRequest
): Promise<{ ok: true; user: User } | { ok: false; response: NextResponse }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Supabase env not configured' }, { status: 500 }),
    };
  }
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: 'Missing token' }, { status: 401 }) };
  }
  const supabase = createClient(url, anon);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user?.id) {
    return { ok: false, response: NextResponse.json({ error: 'Invalid session' }, { status: 401 }) };
  }
  if (!isEmailVerifiedForApp(user)) {
    return { ok: false, response: jsonEmailNotVerified() };
  }
  return { ok: true, user };
}
