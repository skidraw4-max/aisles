import styles from './jury.module.css';

export type TabItem = { id: string; label: string; href: string };

/** Server-safe tab strip: plain links, the active tab is chosen by the caller. Not mounted yet (phase 1). */
export function Tabs({ items, activeId, label }: { items: readonly TabItem[]; activeId: string; label: string }) {
  return (
    <nav className={styles.tabs} aria-label={label}>
      {items.map((item) => (
        <a
          key={item.id}
          href={item.href}
          className={item.id === activeId ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          aria-current={item.id === activeId ? 'page' : undefined}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
