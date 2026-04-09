'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { MediaThumb } from '@/components/MediaThumb';
import { UPLOAD_CATEGORY_OPTIONS } from '@/lib/post-categories';
import type { Category } from '@prisma/client';
import styles from './upload.module.css';

export type UploadEditInitial = {
  id: string;
  category: Category;
  title: string;
  content: string;
  externalLink: string;
  prompt: string;
  thumbnail: string;
};

type Props = { editInitial?: UploadEditInitial | null };

export function UploadForm({ editInitial = null }: Props) {
  const router = useRouter();
  const [category, setCategory] = useState<Category>('GALLERY');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [externalLink, setExternalLink] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (editInitial != null) return;
    setCategory('GALLERY');
    setTitle('');
    setDescription('');
    setPrompt('');
    setExternalLink('');
    setFile(null);
    setUploadedUrl(null);
    setUploadError(null);
  }, [editInitial]);

  useEffect(() => {
    if (editInitial) return;
    if (category !== 'RECIPE') {
      setPrompt('');
    }
    if (category !== 'BUILD' && category !== 'LAUNCH') {
      setExternalLink('');
    }
  }, [category, editInitial]);

  useEffect(() => {
    if (!editInitial?.id) return;
    setCategory(editInitial.category);
    setTitle(editInitial.title);
    setDescription(editInitial.content);
    setPrompt(editInitial.prompt);
    setExternalLink(editInitial.externalLink);
    setFile(null);
    setUploadedUrl(editInitial.thumbnail.trim() ? editInitial.thumbnail : null);
    setUploadError(null);
  }, [editInitial?.id]);

  useEffect(() => {
    if (!file) {
      if (editInitial?.id) {
        setUploadedUrl(editInitial.thumbnail.trim() ? editInitial.thumbnail : null);
        setUploadError(null);
        return;
      }
      setUploadedUrl(null);
      setUploadError(null);
      return;
    }

    const ac = new AbortController();

    (async () => {
      setUploading(true);
      setUploadError(null);
      setUploadedUrl(null);
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error('로그인이 필요합니다.');
        const fd = new FormData();
        fd.set('file', file);
        const res = await fetch('/api/posts/upload-image', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: fd,
          signal: ac.signal,
        });
        const data = (await res.json()) as { error?: string; url?: string };
        if (!res.ok) throw new Error(data.error || 'R2 업로드에 실패했습니다.');
        if (!data.url) throw new Error('업로드 URL을 받지 못했습니다.');
        setUploadedUrl(data.url);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setUploadError(e instanceof Error ? e.message : '업로드에 실패했습니다.');
      } finally {
        if (!ac.signal.aborted) setUploading(false);
      }
    })();

    return () => ac.abort();
  }, [file, editInitial?.id, editInitial?.thumbnail]);

  const isLab = category === 'RECIPE';
  const showServiceLink = category === 'BUILD' || category === 'LAUNCH';
  const canSubmit =
    uploadedUrl &&
    title.trim() &&
    !uploading &&
    !submitting &&
    (!isLab || prompt.trim());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!uploadedUrl) {
      setFormError('미디어 업로드가 끝날 때까지 기다려 주세요.');
      return;
    }
    if (isLab && !prompt.trim()) {
      setFormError('LAB 카테고리에서는 프롬프트를 입력해 주세요.');
      return;
    }
    const linkTrim = externalLink.trim();
    if (showServiceLink && linkTrim) {
      if (!linkTrim.toLowerCase().startsWith('https://')) {
        setFormError('서비스 연결 링크는 https:// 로 시작해야 합니다.');
        return;
      }
      try {
        const u = new URL(linkTrim);
        void u;
      } catch {
        setFormError('서비스 연결 링크가 올바른 URL 형식이 아닙니다.');
        return;
      }
    }
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setFormError('로그인이 필요합니다.');
      return;
    }

    setSubmitting(true);
    try {
      if (editInitial) {
        const patchBody: Record<string, unknown> = {
          title: title.trim(),
          thumbnailUrl: uploadedUrl,
          content: description.trim() ? description.trim() : '',
        };
        if (isLab) {
          patchBody.prompt = prompt.trim();
        }
        if (showServiceLink) {
          patchBody.externalLink = linkTrim;
        }
        const res = await fetch(`/api/posts/${editInitial.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(patchBody),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error || '수정에 실패했습니다.');
        router.push('/my-aisles');
        router.refresh();
        return;
      }

      const body: Record<string, unknown> = {
        category,
        title: title.trim(),
        thumbnailUrl: uploadedUrl,
      };
      if (description.trim()) {
        body.content = description.trim();
      }
      if (isLab) {
        body.prompt = prompt.trim();
      }
      if (showServiceLink && linkTrim) {
        body.externalLink = linkTrim;
      }

      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.');
      router.push('/');
      router.refresh();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : '저장에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.card}>
      {formError && (
        <p className={styles.msgErr} role="alert">
          {formError}
        </p>
      )}

      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.label}>
          카테고리{editInitial ? ' (수정 시 변경 불가)' : ''}
          <select
            className={styles.select}
            value={category}
            onChange={(ev) => setCategory(ev.target.value as Category)}
            required
            disabled={!!editInitial}
          >
            {UPLOAD_CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.label}>
          제목 (Title)
          <input
            className={styles.input}
            type="text"
            value={title}
            onChange={(ev) => setTitle(ev.target.value)}
            maxLength={200}
            required
            placeholder="게시글 제목"
          />
        </label>

        <label className={styles.label}>
          설명 (Description)
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(ev) => setDescription(ev.target.value)}
            maxLength={20000}
            placeholder="선택 사항 — 본문·메모"
            rows={4}
          />
        </label>

        {isLab ? (
          <div className={styles.promptSection}>
            <label className={styles.label}>
              프롬프트 (LAB)
              <textarea
                className={styles.textarea}
                value={prompt}
                onChange={(ev) => setPrompt(ev.target.value)}
                maxLength={50000}
                required
                placeholder="복사·공유할 프롬프트 전문"
                rows={8}
              />
            </label>
            <p className={styles.hint}>LAB 게시글은 프롬프트가 필수입니다. 상세 페이지에서 복사할 수 있습니다.</p>
          </div>
        ) : null}

        {showServiceLink ? (
          <label className={styles.label}>
            서비스 연결 링크 (선택)
            <input
              className={styles.input}
              type="url"
              inputMode="url"
              autoComplete="url"
              value={externalLink}
              onChange={(ev) => setExternalLink(ev.target.value)}
              maxLength={2048}
              placeholder="https://example.com"
            />
            <p className={styles.hint} style={{ marginTop: '0.35rem' }}>
              BUILD·LAUNCH 게시글만 표시됩니다. 입력 시 <code className={styles.inlineCode}>https://</code> 로
              시작하는 주소여야 합니다.
            </p>
          </label>
        ) : null}

        <div className={styles.fileRow}>
          <span className={styles.label} style={{ textTransform: 'none', letterSpacing: 'normal' }}>
            이미지 / 영상
          </span>
          <label className={styles.fileLabel}>
            <span className={styles.fileBtn}>{file ? '다른 파일 선택' : '파일 선택'}</span>
            <input
              className={styles.fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
              onChange={(ev) => setFile(ev.target.files?.[0] ?? null)}
              disabled={uploading}
            />
          </label>
          {file && <p className={styles.fileName}>{file.name}</p>}
          {uploading && (
            <div className={styles.uploadLoading} role="status" aria-live="polite">
              <span className={styles.spinner} aria-hidden />
              <span>Cloudflare R2에 업로드하는 중…</span>
            </div>
          )}
          {uploadError && (
            <p className={styles.msgErr} style={{ marginTop: '0.5rem' }} role="alert">
              {uploadError}
            </p>
          )}
          {uploadedUrl && !uploading && (
            <div className={styles.previewBox}>
              <p className={styles.hint} style={{ marginBottom: '0.5rem' }}>
                {file ? '업로드 완료' : '현재 썸네일'}
              </p>
              <div className={styles.previewInner}>
                <MediaThumb url={uploadedUrl} alt="" objectFit="contain" videoControls />
              </div>
            </div>
          )}
          <p className={styles.hint}>JPEG, PNG, WebP, GIF, MP4, WebM, MOV · 최대 100MB</p>
        </div>

        <button type="submit" className={styles.primary} disabled={!canSubmit}>
          {submitting
            ? editInitial
              ? '수정 중…'
              : '저장 중…'
            : uploading
              ? '업로드 대기 중…'
              : editInitial
                ? '수정 저장'
                : '저장하기'}
        </button>
      </form>
    </div>
  );
}
