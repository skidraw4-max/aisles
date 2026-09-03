import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { labKindFromMetadataParams, parseUserUploadCategory } from '@/lib/post-categories';
import { getLabel } from '@/lib/ui-config';
import { SEO_ROBOTS_PRIVATE } from '@/lib/seo-robots';
import { UploadForm, type UploadEditInitial } from './UploadForm';
import styles from './upload.module.css';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string | string[] }>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const editRaw = sp.edit;
  const editId = typeof editRaw === 'string' ? editRaw.trim() : Array.isArray(editRaw) ? editRaw[0]?.trim() ?? '' : '';
  if (editId) {
    return { title: '게시글 수정 — AIsle', robots: SEO_ROBOTS_PRIVATE };
  }
  const uploadTitle = await getLabel('header.upload');
  return {
    title: `${uploadTitle || '업로드'} — AIsle`,
    robots: SEO_ROBOTS_PRIVATE,
  };
}

type PageProps = { searchParams: Promise<{ edit?: string; category?: string }> };

export default async function UploadPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const sp = await searchParams;
  const editId = typeof sp.edit === 'string' ? sp.edit.trim() : '';
  const category = typeof sp.category === 'string' ? sp.category.trim() : '';

  if (!user?.email) {
    const params = new URLSearchParams();
    if (editId) params.set('edit', editId);
    if (category && !editId) params.set('category', category);
    const qs = params.toString();
    const nextPath = qs ? `/upload?${qs}` : '/upload';
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  let editInitial: UploadEditInitial | null = null;
  if (editId) {
    const p = await prisma.post.findFirst({
      where: { id: editId, authorId: user.id },
      include: { metadata: { select: { prompt: true, params: true } } },
    });
    if (!p) {
      redirect('/my-aisles');
    }
    editInitial = {
      id: p.id,
      category: p.category,
      title: p.title,
      content: p.content ?? '',
      externalLink: p.externalLink ?? '',
      prompt: p.metadata?.prompt ?? '',
      labPromptKind: labKindFromMetadataParams(p.metadata?.params),
      thumbnail: p.thumbnail ?? '',
      attachmentUrls: p.attachmentUrls ?? [],
      tags: p.tags ?? [],
    };
  }

  const isEdit = Boolean(editInitial);
  const uploadPageTitle = await getLabel('header.upload');
  const initialCategory = !editInitial ? parseUserUploadCategory(sp.category) ?? undefined : undefined;

  return (
    <>
      <main className={styles.main}>
        <div className={styles.wrap}>
          <nav className={styles.breadcrumb} aria-label="경로">
            <Link href="/">홈</Link>
            <span aria-hidden>/</span>
            {isEdit ? (
              <>
                <Link href="/my-aisles">My Aisles</Link>
                <span aria-hidden>/</span>
                <span>수정</span>
              </>
            ) : (
              <span>{uploadPageTitle || '업로드'}</span>
            )}
          </nav>
          <h1 className={styles.title}>{isEdit ? '게시글 수정' : uploadPageTitle || '업로드'}</h1>
          <p className={styles.hint} style={{ margin: '-0.5rem 0 1.25rem', maxWidth: 560 }}>
            {isEdit
              ? '내용을 바꾼 뒤 수정 저장하면 My Aisles로 돌아갑니다. 미디어를 바꾸려면 새 파일을 선택해 R2에 다시 올리면 됩니다.'
              : '나만의 작품과 아이디어를 자유롭게 공유해 보세요. 선택한 카테고리에 맞춰 글 작성이 시작됩니다.'}
          </p>
          <UploadForm editInitial={editInitial} initialCategory={initialCategory} />
        </div>
      </main>
    </>
  );
}
