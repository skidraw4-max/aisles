/**
 * I-084 (UI plan P3): shared page header, empty state and ghost icon button for Jury screens.
 * No hooks, so usable from server and client components.
 */
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { Inbox, type LucideIcon } from 'lucide-react';
import styles from './jury.module.css';

import { shouldShowBreadcrumb, type Crumb } from './page-layout-model';

export type { Crumb };

export function PageHeader({ crumbs, title, status, description, actions }: {
  crumbs: readonly Crumb[];
  title: ReactNode;
  status?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.pageIntro}>
      <div className={styles.pageHeaderMain}>
        {shouldShowBreadcrumb(crumbs, title) ? (
          <nav aria-label="현재 위치">
            <ol className={styles.breadcrumb}>
              {crumbs.map((c, i) => (
                <li key={`${c.label}-${i}`} aria-current={i === crumbs.length - 1 ? 'page' : undefined}>
                  {c.href ? <Link href={c.href}>{c.label}</Link> : c.label}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <div className={styles.pageHeaderTitleRow}>
          <h2 className={styles.pageTitle}>{title}</h2>
          {status}
        </div>
        {description ? <p className={styles.pageDescription}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.pageHeaderActions}>{actions}</div> : null}
    </header>
  );
}

export function EmptyState({ icon: Icon = Inbox, children, action }: { icon?: LucideIcon; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.emptyState}>
      <Icon className={styles.emptyStateIcon} aria-hidden size={28} />
      <p>{children}</p>
      {action}
    </div>
  );
}

export function IconButton({ icon: Icon, label, className, ...rest }: { icon: LucideIcon; label: string } & Omit<ComponentProps<'button'>, 'children'>) {
  return (
    <button type="button" {...rest} aria-label={label} title={label} className={[styles.iconButton, className].filter(Boolean).join(' ')}>
      <Icon aria-hidden size={16} />
    </button>
  );
}
