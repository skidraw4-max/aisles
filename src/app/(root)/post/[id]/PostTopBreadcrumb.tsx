import Link from 'next/link';
import type { Category } from '@prisma/client';
import { categoryToHomeQuery } from '@/lib/post-categories';
import styles from './post.module.css';

type Props = {
  category: Category;
  /** 복도 표시명 (UI 설정/DB) */
  label: string;
};

export function PostTopBreadcrumb({ category, label: catLabel }: Props) {
  const q = categoryToHomeQuery(category);

  return (
    <nav className={styles.magazineBreadcrumb} aria-label="게시글 탐색">
      <ol className={styles.magazineBreadcrumbList}>
        <li className={styles.magazineBreadcrumbItem}>
          <Link href={`/?category=${q}`} className={styles.magazineBreadcrumbLink}>
            {catLabel}
          </Link>
        </li>
      </ol>
    </nav>
  );
}
