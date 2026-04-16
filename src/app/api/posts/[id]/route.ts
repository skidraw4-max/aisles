import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUserFromBearer } from '@/lib/auth-bearer';
import { ensurePrismaUser } from '@/lib/ensure-user';
import { isTrustedMediaUrl } from '@/lib/r2-url';
import { parseMediaUrlsField } from '@/lib/post-media-urls';
import { normalizePostTagsInput } from '@/lib/post-tags';
import type { Category, Prisma } from '@prisma/client';
import { validateContentMinForCategory } from '@/lib/post-description-policy';
import {
  categoryAllowsOptionalMedia,
  labKindFromMetadataParams,
  parseLabPromptKindFromBody,
} from '@/lib/post-categories';

type Ctx = { params: Promise<{ id: string }> };

const EXTERNAL_LINK_MAX = 2048;

function normalizeExternalLink(
  category: Category,
  raw: unknown
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (category !== 'BUILD' && category !== 'LAUNCH') {
    return { ok: true, value: null };
  }
  if (raw === null || raw === '') {
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

/** 작성자만: 게시글 삭제 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await getUserFromBearer(req);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;

  const post = await prisma.post.findUnique({
    where: { id },
    select: { id: true, authorId: true },
  });
  if (!post) {
    return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 });
  }
  if (post.authorId !== auth.user.id) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  await ensurePrismaUser(auth.user);

  try {
    await prisma.post.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 });
  }
}

/** 작성자만: 제목·본문·썸네일·외부 링크·(LAB) 프롬프트 수정 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await getUserFromBearer(req);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const post = await prisma.post.findUnique({
    where: { id },
    select: {
      id: true,
      authorId: true,
      category: true,
      metadata: { select: { prompt: true, params: true } },
    },
  });
  if (!post) {
    return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 });
  }
  if (post.authorId !== auth.user.id) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  await ensurePrismaUser(auth.user);

  const recipeLabKindResolved =
    post.category === 'RECIPE'
      ? (parseLabPromptKindFromBody(b.labPromptKind) ?? labKindFromMetadataParams(post.metadata?.params))
      : null;
  const optionalMedia = categoryAllowsOptionalMedia(post.category, recipeLabKindResolved);

  const data: {
    title?: string;
    content?: string | null;
    thumbnail?: string | null;
    attachmentUrls?: string[];
    externalLink?: string | null;
    tags?: string[];
  } = {};

  if (typeof b.title === 'string') {
    const t = b.title.trim();
    if (!t) {
      return NextResponse.json({ error: '제목을 입력해 주세요.' }, { status: 400 });
    }
    if (t.length > 200) {
      return NextResponse.json({ error: '제목은 200자 이하여야 합니다.' }, { status: 400 });
    }
    data.title = t;
  }

  if (typeof b.content === 'string') {
    const c = b.content.trim();
    data.content = c ? c.slice(0, 20000) : null;
    const contentErr = validateContentMinForCategory(post.category, data.content);
    if (contentErr) {
      return NextResponse.json({ error: contentErr }, { status: 400 });
    }
  }

  if ('mediaUrls' in b) {
    const parsed = parseMediaUrlsField(b);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.message }, { status: 400 });
    }
    if (parsed.urls.length === 0) {
      if (optionalMedia) {
        data.thumbnail = null;
        data.attachmentUrls = [];
      } else {
        return NextResponse.json(
          { error: '이 카테고리는 최소 1개의 대표 미디어가 필요합니다.' },
          { status: 400 }
        );
      }
    } else {
      data.thumbnail = parsed.urls[0];
      data.attachmentUrls = parsed.urls.slice(1);
    }
  } else if (typeof b.thumbnailUrl === 'string') {
    const url = b.thumbnailUrl.trim();
    if (!url) {
      if (optionalMedia) {
        data.thumbnail = null;
      } else {
        return NextResponse.json(
          { error: '허용된 저장소에서 업로드된 썸네일 URL만 사용할 수 있습니다.' },
          { status: 400 }
        );
      }
    } else if (!isTrustedMediaUrl(url)) {
      return NextResponse.json(
        { error: '허용된 저장소에서 업로드된 썸네일 URL만 사용할 수 있습니다.' },
        { status: 400 }
      );
    } else {
      data.thumbnail = url;
    }
  }

  if ('externalLink' in b && b.externalLink !== undefined) {
    const linkResult = normalizeExternalLink(post.category, b.externalLink);
    if (!linkResult.ok) {
      return NextResponse.json({ error: linkResult.message }, { status: 400 });
    }
    if (post.category === 'BUILD' || post.category === 'LAUNCH') {
      data.externalLink = linkResult.value;
    }
  }

  if ('tags' in b) {
    data.tags = normalizePostTagsInput(b.tags);
  }

  let metadataUpsert:
    | {
        create: { prompt: string; params?: Prisma.InputJsonValue };
        update: { prompt: string; params?: Prisma.InputJsonValue };
      }
    | undefined;
  const labKindInBody = 'labPromptKind' in b && typeof b.labPromptKind === 'string';
  if (post.category === 'RECIPE' && (typeof b.prompt === 'string' || labKindInBody)) {
    let nextPrompt: string;
    if (typeof b.prompt === 'string') {
      const promptRaw = b.prompt.trim();
      if (!promptRaw) {
        return NextResponse.json({ error: 'LAB 카테고리는 프롬프트가 필요합니다.' }, { status: 400 });
      }
      nextPrompt = promptRaw.slice(0, 50000);
    } else {
      const existing = post.metadata?.prompt?.trim();
      if (!existing) {
        return NextResponse.json(
          { error: 'LAB 프롬프트를 찾을 수 없습니다. 프롬프트를 함께 보내 주세요.' },
          { status: 400 }
        );
      }
      nextPrompt = existing;
    }

    const prevParams =
      post.metadata?.params &&
      typeof post.metadata.params === 'object' &&
      post.metadata.params !== null &&
      !Array.isArray(post.metadata.params)
        ? { ...(post.metadata.params as Record<string, unknown>) }
        : {};
    let nextParams = { ...prevParams };
    if (labKindInBody) {
      const k = parseLabPromptKindFromBody(b.labPromptKind) ?? 'visual';
      nextParams = { ...nextParams, labPromptKind: k };
    }

    const paramsJson = nextParams as Prisma.InputJsonValue;
    metadataUpsert = {
      create: { prompt: nextPrompt, params: paramsJson },
      update: { prompt: nextPrompt, params: paramsJson },
    };
  }

  if (Object.keys(data).length === 0 && metadataUpsert === undefined) {
    return NextResponse.json({ error: '수정할 항목이 없습니다.' }, { status: 400 });
  }

  try {
    const updated = await prisma.post.update({
      where: { id },
      data: {
        ...data,
        ...(metadataUpsert
          ? {
              metadata: {
                upsert: metadataUpsert,
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
        attachmentUrls: true,
        externalLink: true,
        tags: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ ok: true, post: updated });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: '수정에 실패했습니다.' }, { status: 500 });
  }
}
