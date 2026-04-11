'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { MediaThumb } from '@/components/MediaThumb';
import { UPLOAD_CATEGORY_OPTIONS, categoryAllowsOptionalThumbnail } from '@/lib/post-categories';
import { MAX_POST_MEDIA } from '@/lib/post-media-urls';
import { UPLOAD_IMAGE_MAX_BYTES, formatUploadMaxSizeLabel } from '@/lib/upload-limits';
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
  attachmentUrls: string[];
  tags: string[];
};

type Props = { editInitial?: UploadEditInitial | null };

type MediaSlot = { id: string; name: string; url: string };

function insertAtTextareaCursor(
  el: HTMLTextAreaElement,
  insert: string,
  setValue: React.Dispatch<React.SetStateAction<string>>
) {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  setValue((prev) => prev.slice(0, start) + insert + prev.slice(end));
  const pos = start + insert.length;
  queueMicrotask(() => {
    el.focus();
    el.setSelectionRange(pos, pos);
  });
}

function clipboardImageFile(e: React.ClipboardEvent): File | null {
  const items = e.clipboardData?.items;
  if (!items) return null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

export function UploadForm({ editInitial = null }: Props) {
  const router = useRouter();
  const [category, setCategory] = useState<Category>('GALLERY');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [externalLink, setExternalLink] = useState('');
  const [mediaSlots, setMediaSlots] = useState<MediaSlot[]>([]);
  const [uploadCount, setUploadCount] = useState(0);
  const [pasteMessage, setPasteMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [tags, setTags] = useState('');

  const beginUpload = useCallback(() => {
    setUploadCount((c) => c + 1);
  }, []);
  const endUpload = useCallback(() => {
    setUploadCount((c) => Math.max(0, c - 1));
  }, []);

  const uploadFileToR2 = useCallback(
    async (file: File): Promise<string> => {
      if (file.size > UPLOAD_IMAGE_MAX_BYTES) {
        throw new Error(
          `파일이 너무 큽니다. ${formatUploadMaxSizeLabel()} 이하로 줄여 주세요. (호스팅 업로드 한도)`
        );
      }
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
      });
      const text = await res.text();
      let data: { error?: string; url?: string } = {};
      if (text) {
        try {
          data = JSON.parse(text) as { error?: string; url?: string };
        } catch {
          const snippet = text.trim().slice(0, 160);
          const entityTooLarge =
            res.status === 413 ||
            /request\s+entity\s+too\s+large/i.test(text) ||
            /^request\s+en/i.test(snippet);
          if (!res.ok) {
            throw new Error(
              entityTooLarge
                ? `파일이 너무 큽니다. ${formatUploadMaxSizeLabel()} 이하로 줄여 주세요.`
                : snippet || `업로드 실패 (HTTP ${res.status})`
            );
          }
          throw new Error('서버 응답을 해석할 수 없습니다.');
        }
      }
      if (!res.ok) throw new Error(data.error || 'R2 업로드에 실패했습니다.');
      if (!data.url) throw new Error('업로드 URL을 받지 못했습니다.');
      return data.url;
    },
    []
  );

  useEffect(() => {
    if (editInitial != null) return;
    setCategory('GALLERY');
    setTitle('');
    setDescription('');
    setPrompt('');
    setExternalLink('');
    setTags('');
    setMediaSlots([]);
    setPasteMessage(null);
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
    setTags((editInitial.tags ?? []).filter(Boolean).join(', '));
    const slots: MediaSlot[] = [];
    const thumb = editInitial.thumbnail.trim();
    if (thumb) slots.push({ id: 'thumb', name: '대표 미디어', url: thumb });
    const extra = editInitial.attachmentUrls ?? [];
    extra.forEach((u, i) => {
      if (u.trim()) slots.push({ id: `att-${i}`, name: `첨부 ${i + 1}`, url: u.trim() });
    });
    setMediaSlots(slots.slice(0, MAX_POST_MEDIA));
    setPasteMessage(null);
  }, [editInitial?.id]);

  async function handleAddFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    const room = MAX_POST_MEDIA - mediaSlots.length;
    if (room <= 0) {
      setFormError(`첨부 미디어는 최대 ${MAX_POST_MEDIA}개까지입니다.`);
      return;
    }
    setFormError(null);
    const toAdd = Array.from(fileList).slice(0, room);
    for (const file of toAdd) {
      const id = crypto.randomUUID();
      setMediaSlots((s) => [...s, { id, name: file.name, url: '' }]);
      beginUpload();
      try {
        const url = await uploadFileToR2(file);
        setMediaSlots((s) => s.map((x) => (x.id === id ? { ...x, url } : x)));
      } catch (e) {
        setMediaSlots((s) => s.filter((x) => x.id !== id));
        setFormError(e instanceof Error ? e.message : '업로드에 실패했습니다.');
      } finally {
        endUpload();
      }
    }
  }

  function removeSlot(id: string) {
    setMediaSlots((s) => s.filter((x) => x.id !== id));
  }

  async function handlePasteInBody(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const file = clipboardImageFile(e);
    if (!file) return;
    e.preventDefault();
    setPasteMessage(null);
    beginUpload();
    try {
      const url = await uploadFileToR2(file);
      const md = `\n\n![이미지](${url})\n\n`;
      insertAtTextareaCursor(e.currentTarget, md, setDescription);
    } catch (err) {
      setPasteMessage(err instanceof Error ? err.message : '이미지 업로드에 실패했습니다.');
    } finally {
      endUpload();
    }
  }

  async function handlePasteInPrompt(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const file = clipboardImageFile(e);
    if (!file) return;
    e.preventDefault();
    setPasteMessage(null);
    beginUpload();
    try {
      const url = await uploadFileToR2(file);
      const md = `\n\n![이미지](${url})\n\n`;
      insertAtTextareaCursor(e.currentTarget, md, setPrompt);
    } catch (err) {
      setPasteMessage(err instanceof Error ? err.message : '이미지 업로드에 실패했습니다.');
    } finally {
      endUpload();
    }
  }

  function handleClose() {
    if (editInitial) {
      router.push('/my-aisles');
    } else {
      router.push('/');
    }
  }

  const isLab = category === 'RECIPE';
  const isLounge = category === 'LOUNGE';
  const mediaOptional = categoryAllowsOptionalThumbnail(category);
  const showServiceLink = category === 'BUILD' || category === 'LAUNCH';
  const filledSlots = mediaSlots.filter((s) => s.url);
  const hasMedia = filledSlots.length > 0;
  const uploading = uploadCount > 0;

  const canSubmit =
    title.trim() &&
    !uploading &&
    !submitting &&
    (!isLab || prompt.trim()) &&
    (mediaOptional || hasMedia);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!mediaOptional && !hasMedia) {
      setFormError('미디어를 최소 1개 등록해 주세요.');
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

    const mediaUrls = filledSlots.map((s) => s.url);

    setSubmitting(true);
    try {
      if (editInitial) {
        const patchBody: Record<string, unknown> = {
          title: title.trim(),
          content: description.trim() ? description.trim() : '',
          mediaUrls,
        };
        if (isLab) {
          patchBody.prompt = prompt.trim();
        }
        if (showServiceLink) {
          patchBody.externalLink = linkTrim;
        }
        patchBody.tags = tags;
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
        mediaUrls,
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
      if (tags.trim()) {
        body.tags = tags;
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
      <button
        type="button"
        className={styles.cardClose}
        onClick={handleClose}
        aria-label="닫기"
      >
        ×
      </button>
      {formError && (
        <p className={styles.msgErr} role="alert">
          {formError}
        </p>
      )}
      {pasteMessage && (
        <p className={styles.msgErr} role="alert">
          {pasteMessage}
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
          {isLounge ? (
            <span className={styles.optionalMark}> · LOUNGE: 본문·이미지 선택 (제목만으로도 게시)</span>
          ) : null}
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(ev) => setDescription(ev.target.value)}
            maxLength={20000}
            onPaste={handlePasteInBody}
            placeholder={
              isLounge
                ? '본문이 있으면 입력하세요. 클립보드 이미지를 붙여넣으면 자동 업로드 후 본문에 삽입됩니다.'
                : '선택 사항 — 본문·메모. 이미지를 복사해 붙여넣으면 R2에 올리고 본문에 삽입됩니다.'
            }
            rows={isLounge ? 6 : 4}
          />
          <p className={styles.pasteHint}>클립보드에서 이미지(Ctrl+V) 붙여넣기 지원</p>
        </label>

        <label className={styles.label}>
          태그 (선택)
          <input
            className={styles.input}
            type="text"
            value={tags}
            onChange={(ev) => setTags(ev.target.value)}
            placeholder="예: 프롬프트, 한복, SDXL — 쉼표·공백으로 구분"
          />
          <p className={styles.hint} style={{ marginTop: '0.35rem' }}>
            상세 페이지 본문 하단에 #태그 형태로 표시됩니다.
          </p>
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
                onPaste={handlePasteInPrompt}
                required
                placeholder="복사·공유할 프롬프트 전문 (이미지 붙여넣기 가능)"
                rows={8}
              />
              <p className={styles.pasteHint}>프롬프트 입력란에도 이미지 붙여넣기 가능</p>
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
            대표·첨부 미디어 (최대 {MAX_POST_MEDIA}개)
            {mediaOptional ? <span className={styles.optionalMark}> · LOUNGE는 생략 가능</span> : null}
          </span>
          <label className={styles.fileLabel}>
            <span className={styles.fileBtn}>
              {mediaSlots.length >= MAX_POST_MEDIA ? '개수 한도 도달' : '파일 추가'}
            </span>
            <input
              className={styles.fileInput}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
              onChange={(ev) => {
                void handleAddFiles(ev.target.files);
                ev.target.value = '';
              }}
              disabled={uploading || mediaSlots.length >= MAX_POST_MEDIA}
            />
          </label>
          {uploading && (
            <div className={styles.uploadLoading} role="status" aria-live="polite">
              <span className={styles.spinner} aria-hidden />
              <span>Cloudflare R2에 업로드하는 중…</span>
            </div>
          )}
          {mediaSlots.length > 0 ? (
            <ul className={styles.mediaSlotList}>
              {mediaSlots.map((slot) => (
                <li key={slot.id} className={styles.mediaSlotItem}>
                  {!slot.url ? (
                    <div className={styles.mediaSlotPending}>업로드 중… {slot.name}</div>
                  ) : (
                    <>
                      <div className={styles.mediaSlotPreview}>
                        <MediaThumb url={slot.url} alt="" objectFit="cover" videoControls />
                      </div>
                      <div className={styles.mediaSlotMeta}>
                        <span className={styles.mediaSlotName} title={slot.name}>
                          {slot.name}
                        </span>
                        <button
                          type="button"
                          className={styles.mediaSlotRemove}
                          onClick={() => removeSlot(slot.id)}
                          disabled={uploading}
                        >
                          제거
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <p className={styles.hint}>
            첫 번째 파일이 목록·상세의 대표 미디어로 쓰입니다. JPEG, PNG, WebP, GIF, MP4, WebM, MOV · 파일당 최대{' '}
            {formatUploadMaxSizeLabel()} (Vercel 등 서버리스 업로드 한도)
          </p>
        </div>

        <div className={styles.formActions}>
          <button type="button" className={styles.cancel} onClick={handleClose}>
            취소
          </button>
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
        </div>
      </form>
    </div>
  );
}
