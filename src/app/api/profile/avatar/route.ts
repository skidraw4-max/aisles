import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '@/lib/prisma';
import { MEDIA_STORAGE_NOT_CONFIGURED, uploadPublicObject } from '@/lib/r2';
import { sanitizeUsername } from '@/lib/username';

const ALLOWED = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = form.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: '이미지 파일을 선택해 주세요.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: '파일 크기는 5MB 이하여야 합니다.' }, { status: 400 });
  }

  const ext = ALLOWED.get(file.type);
  if (!ext) {
    return NextResponse.json({ error: 'JPEG, PNG, WebP, GIF만 업로드할 수 있습니다.' }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const key = `avatars/${user.id}/${randomUUID()}.${ext}`;
  const uploaded = await uploadPublicObject(key, buf, file.type);
  if ('error' in uploaded) {
    return NextResponse.json(
      {
        error:
          uploaded.error === MEDIA_STORAGE_NOT_CONFIGURED
            ? '이미지 저장소가 준비되지 않았습니다. R2 또는 Supabase Storage(service role) 설정을 확인해 주세요.'
            : uploaded.error,
      },
      { status: 503 }
    );
  }

  const emailLocal = user.email.split('@')[0] ?? 'user';
  const metaName = user.user_metadata?.username as string | undefined;
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
        avatarUrl: uploaded.publicUrl,
      },
      update: { avatarUrl: uploaded.publicUrl },
    });
    return NextResponse.json({ ok: true, avatarUrl: uploaded.publicUrl });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: '프로필 이미지 저장에 실패했습니다.' }, { status: 500 });
  }
}
