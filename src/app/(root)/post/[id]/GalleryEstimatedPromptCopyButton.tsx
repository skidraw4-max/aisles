'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy } from 'lucide-react';
import styles from './post.module.css';

type Props = {
  /** 복사할 원문(추정 프롬프트) */
  text: string;
};

export function GalleryEstimatedPromptCopyButton({ text }: Props) {
  const [toast, setToast] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  const canCopy = text.trim().length > 0;

  async function handleCopy() {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(text.trim());
      setToast('클립보드에 복사되었습니다!');
    } catch {
      setToast('복사에 실패했습니다. 브라우저 권한을 확인해 주세요.');
    }
  }

  const toastNode =
    mounted && toast
      ? createPortal(
          <div className={styles.toastRoot} role="status" aria-live="polite">
            <div className={styles.toastInner}>{toast}</div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      {toastNode}
      <button
        type="button"
        onClick={handleCopy}
        disabled={!canCopy}
        className={styles.galleryReverseCopyPrompt}
        aria-label="추정 프롬프트를 클립보드에 복사"
      >
        <Copy className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
        프롬프트 복사하기
      </button>
    </>
  );
}
