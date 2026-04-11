import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ensurePrismaUser } from '@/lib/ensure-user';
import { MEDIA_STORAGE_NOT_CONFIGURED, uploadPublicObject } from '@/lib/r2';
import { UPLOAD_IMAGE_MAX_BYTES, formatUploadMaxSizeLabel } from '@/lib/upload-limits';
import { resolveUploadMimeType } from '@/lib/upload-media-types';
import { applyWatermarkForUpload } from '@/lib/watermark-image';

export const maxDuration = 120;

/** 이미지·영상을 R2에 올리고 퍼블릭 URL만 반환 (Post 저장은 별도 API) */
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
    error: authErr,
  } = await supabase.auth.getUser(token);

  if (authErr || !user?.email) {
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
    return NextResponse.json({ error: '파일을 선택해 주세요.' }, { status: 400 });
  }
  if (file.size > UPLOAD_IMAGE_MAX_BYTES) {
    return NextResponse.json(
      {
        error: `파일 크기는 ${formatUploadMaxSizeLabel()} 이하여야 합니다. (Vercel 등 서버리스 업로드 한도)`,
      },
      { status: 400 }
    );
  }

  let buf = Buffer.from(await file.arrayBuffer());
  const resolved = resolveUploadMimeType(file.type, buf);
  if (!resolved) {
    return NextResponse.json(
      { error: 'JPEG, PNG, WebP, GIF, MP4, WebM, QuickTime(MOV)만 업로드할 수 있습니다.' },
      { status: 400 }
    );
  }
  const { mime: inputMime, ext } = resolved;

  const watermarked = await applyWatermarkForUpload({ buffer: buf, mimeType: inputMime, ext });
  buf = Buffer.from(watermarked.buffer);
  const uploadMime = watermarked.mimeType;
  const key = `posts/${user.id}/${randomUUID()}.${ext}`;
  const uploaded = await uploadPublicObject(key, buf, uploadMime);
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
  } catch {
    /* 글 등록 단계에서 재시도 */
  }

  return NextResponse.json({ ok: true, url: uploaded.publicUrl });
}
