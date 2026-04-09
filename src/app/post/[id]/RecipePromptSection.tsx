'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './post.module.css';

type Props = {
  postId: string;
  /** SSR 표시용(서버에서 DB와 동일 규칙으로 계산) */
  promptText: string;
};

export function RecipePromptSection({ postId, promptText }: Props) {
  const [toast, setToast] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  async function copyRecipe() {
    let text = '';
    try {
      const res = await fetch(`/api/posts/${postId}/prompt`, { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { prompt?: unknown };
        if (typeof data.prompt === 'string') text = data.prompt;
      }
    } catch {
      /* API 실패 시 아래에서 promptText 사용 */
    }
    if (!text) text = promptText;
    if (!text.trim()) {
      setToast('복사할 프롬프트가 없습니다.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setToast('프롬프트가 클립보드에 복사되었습니다!');
    } catch {
      setToast('복사에 실패했습니다. 브라우저 권한을 확인해 주세요.');
    }
  }

  function handleEditorClick() {
    const sel = typeof window !== 'undefined' ? window.getSelection()?.toString() ?? '' : '';
    if (sel.length > 0) return;
    void copyRecipe();
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

  if (!promptText) {
    return (
      <>
        {toastNode}
        <section
          className={`${styles.recipeMagazineCard} ${styles.magazineCard}`}
          aria-labelledby="recipe-heading"
        >
          <div className={styles.recipeMagazineHead}>
            <div>
              <p className={styles.recipeMagazineKicker}>오늘의 추천 프롬프트 레시피</p>
              <h2 id="recipe-heading" className={styles.recipeMagazineTitle}>
                PROMPT RECIPE #01
              </h2>
            </div>
            <button type="button" className={styles.recipeMagazineCopy} onClick={() => void copyRecipe()}>
              Copy
            </button>
          </div>
          <div className={styles.recipeMagazineBody}>
            <p className={styles.promptEmpty}>표시할 프롬프트가 없습니다.</p>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      {toastNode}
      <section
        className={`${styles.recipeMagazineCard} ${styles.magazineCard}`}
        aria-labelledby="recipe-heading"
      >
        <div className={styles.recipeMagazineHead}>
          <div>
            <p className={styles.recipeMagazineKicker}>오늘의 추천 프롬프트 레시피</p>
            <h2 id="recipe-heading" className={styles.recipeMagazineTitle}>
              PROMPT RECIPE #01
            </h2>
          </div>
          <button type="button" className={styles.recipeMagazineCopy} onClick={() => void copyRecipe()}>
            Copy
          </button>
        </div>
        <div className={styles.recipeMagazineBody}>
          <pre
            className={styles.recipeMagazinePre}
            tabIndex={0}
            role="region"
            aria-label="프롬프트 레시피 본문. 텍스트를 드래그하지 않고 클릭하면 전체가 복사됩니다."
            title="텍스트 선택 없이 클릭 시 전체 레시피 복사"
            onClick={handleEditorClick}
          >
            {promptText}
          </pre>
        </div>
      </section>
    </>
  );
}
