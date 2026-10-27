import styles from './jury.module.css';

export type TabItem = { id: string; label: string; href: string };

/** Server-safe tab strip: plain links, the active tab is chosen by the caller. Not mounted yet (phase 1). */
export function Tabs({ items, activeId, label }: { items: readonly TabItem[]; activeId: string; label: string }) {
  return (
    <nav className={styles.segTabs} aria-label={label}>
      {items.map((item) => (
        <a
          key={item.id}
          href={item.href}
          className={item.id === activeId ? `${styles.segTab} ${styles.segTabActive}` : styles.segTab}
          aria-current={item.id === activeId ? 'page' : undefined}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

/**
 * Display-only hint for AI-generated English review text. No translation logic or API call:
 * it only explains how to use the browser's own translation. The AI text itself is untouched.
 */
export function TranslationHint() {
  return (
    <details className={styles.technicalDetails}>
      <summary>한글 번역 보기</summary>
      <p className={styles.muted}>
        AI 심사 원문은 영어로 제공돼요. 브라우저의 번역 기능(Chrome: 마우스 오른쪽 클릭 → 한국어로 번역)을 사용하세요.
      </p>
    </details>
  );
}
