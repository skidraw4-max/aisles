import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';
import { prisma } from '@/lib/prisma';
import { ensurePrismaUser } from '@/lib/ensure-user';
import { MEDIA_STORAGE_NOT_CONFIGURED, uploadPublicObject } from '@/lib/r2';
import { isTrustedMediaUrl } from '@/lib/r2-url';
import type { Category } from '@prisma/client';
import { parsePostCategory } from '@/lib/post-categories';

const MEDIA_EXT = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
  ['video/quicktime', 'mov'],
]);

const MAX_BYTES = 100 * 1024 * 1024;
const EXTERNAL_LINK_MAX = 2048;

export const maxDuration = 120;

function normalizeExternalLink(
  category: Category,
  raw: unknown
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (category !== 'BUILD' && category !== 'LAUNCH') {
    return { ok: true, value: null };
  }
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: null };
  }
  if (typeof raw !== 'string') {
    return { ok: false, message: '서비스 연결 링크 형식이 올바르지 않습니다.' };
  }
  const t = raw.trim();
  if (!t) {
    return { ok: true, value: null };
  }
  if (t.length > EXTERNAL_LINK_MAX) {
    return { ok: false, message: `서비스 연결 링크는 ${EXTERNAL_LINK_MAX}자 이하여야 합니다.` };
  }
  if (!t.toLowerCase().startsWith('https://')) {
    return { ok: false, message: '서비스 연결 링크는 https:// 로 시작해야 합니다.' };
  }
  try {
    const parsed = new URL(t);
    void parsed;
  } catch {
    return { ok: false, message: '유효한 URL 형식이 아닙니다.' };
  }
  return { ok: true, value: t };
}

async function requireAuthUser(req: NextRequest): Promise<User | NextResponse> {
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
    error: authErr,
  } = await supabase.auth.getUser(token);
  if (authErr || !user?.email) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }
  return user;
}

export async function POST(req: NextRequest) {
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return postFromJson(req);
  }
  return postFromMultipart(req);
}

/** 글쓰기(2단계): R2 업로드 후 받은 URL로 Post 생성 */
async function postFromJson(req: NextRequest) {
  const auth = await requireAuthUser(req);
  if (auth instanceof NextResponse) return auth;
  const user = auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const category = parsePostCategory(typeof b.category === 'string' ? b.category : null);
  if (!category) {
    return NextResponse.json({ error: '유효한 카테고리를 선택해 주세요.' }, { status: 400 });
  }

  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (!title) {
    return NextResponse.json({ error: '제목을 입력해 주세요.' }, { status: 400 });
  }
  if (title.length > 200) {
    return NextResponse.json({ error: '제목은 200자 이하여야 합니다.' }, { status: 400 });
  }

  const contentRaw = typeof b.content === 'string' ? b.content.trim() : '';
  const content = contentRaw ? contentRaw.slice(0, 20000) : null;

  const promptRaw = typeof b.prompt === 'string' ? b.prompt.trim() : '';
  if (category === 'RECIPE') {
    if (!promptRaw) {
      return NextResponse.json(
        { error: 'LAB 카테고리는 프롬프트를 입력해야 합니다.' },
        { status: 400 }
      );
    }
    if (promptRaw.length > 50000) {
      return NextResponse.json({ error: '프롬프트는 5만 자 이하여야 합니다.' }, { status: 400 });
    }
  }

  const thumbnailUrl = typeof b.thumbnailUrl === 'string' ? b.thumbnailUrl.trim() : '';
  if (!thumbnailUrl || !isTrustedMediaUrl(thumbnailUrl)) {
    return NextResponse.json(
      { error: '허용된 저장소에서 업로드된 썸네일 URL이 필요합니다. 미디어 업로드를 먼저 완료해 주세요.' },
      { status: 400 }
    );
  }

  const linkResult = normalizeExternalLink(category, b.externalLink);
  if (!linkResult.ok) {
    return NextResponse.json({ error: linkResult.message }, { status: 400 });
  }
  const externalLink = linkResult.value;

  try {
    await ensurePrismaUser(user);
    const post = await prisma.post.create({
      data: {
        category,
        title,
        content,
        thumbnail: thumbnailUrl,
        authorId: user.id,
        ...(externalLink != null ? { externalLink } : {}),
        ...(category === 'RECIPE'
          ? {
              metadata: {
                create: {
                  prompt: promptRaw.slice(0, 50000),
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
        category: true,
        title: true,
        content: true,
        thumbnail: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ ok: true, post });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: '게시글 저장에 실패했습니다.' }, { status: 500 });
  }
}

/** 멀티파트: 파일을 R2에 올리고 한 번에 Post 생성 (기존 업로드 폼) */
async function postFromMultipart(req: NextRequest) {
  const auth = await requireAuthUser(req);
  if (auth instanceof NextResponse) return auth;
  const user = auth;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const category = parsePostCategory(form.get('category') as string | null);
  if (!category) {
    return NextResponse.json({ error: '유효한 카테고리를 선택해 주세요.' }, { status: 400 });
  }

  const titleRaw = form.get('title');
  const title = typeof titleRaw === 'string' ? titleRaw.trim() : '';
  if (!title) {
    return NextResponse.json({ error: '제목을 입력해 주세요.' }, { status: 400 });
  }
  if (title.length > 200) {
    return NextResponse.json({ error: '제목은 200자 이하여야 합니다.' }, { status: 400 });
  }

  const contentRaw = form.get('content');
  const content =
    typeof contentRaw === 'string' && contentRaw.trim() ? contentRaw.trim().slice(0, 20000) : null;

  const linkResult = normalizeExternalLink(category, form.get('externalLink'));
  if (!linkResult.ok) {
    return NextResponse.json({ error: linkResult.message }, { status: 400 });
  }
  const externalLink = linkResult.value;

  const file = form.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: '이미지 또는 영상 파일을 선택해 주세요.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: '파일 크기는 100MB 이하여야 합니다.' }, { status: 400 });
  }

  const ext = MEDIA_EXT.get(file.type);
  if (!ext) {
    return NextResponse.json(
      { error: '지원 형식: JPEG, PNG, WebP, GIF, MP4, WebM, QuickTime(MOV).' },
      { status: 400 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const key = `posts/${user.id}/${randomUUID()}.${ext}`;
  const uploaded = await uploadPublicObject(key, buf, file.type);
  if ('error' in uploaded) {
    return NextResponse.json(
      {
        error:
          uploaded.error === MEDIA_STORAGE_NOT_CONFIGURED
            ? '파일 저장소가 준비되지 않았습니다. R2 환경 변수를 설정하거나, Supabase Storage 버킷과 SUPABASE_SERVICE_ROLE_KEY 를 설정해 주세요.'
            : uploaded.error,
      },
      { status: 503 }
    );
  }

  try {
    await ensurePrismaUser(user);
    const post = await prisma.post.create({
      data: {
        category,
        title,
        content,
        thumbnail: uploaded.publicUrl,
        authorId: user.id,
        ...(externalLink != null ? { externalLink } : {}),
      },
      select: {
        id: true,
        category: true,
        title: true,
        content: true,
        thumbnail: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ ok: true, post });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: '게시글 저장에 실패했습니다.' }, { status: 500 });
  }
}
