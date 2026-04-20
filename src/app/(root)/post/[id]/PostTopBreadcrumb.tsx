import Link from 'next/link';
import type { Category } from '@prisma/client';
import { categoryToHomeQuery, POST_CATEGORY_OPTIONS } from '@/lib/post-categories';
import styles from './post.module.css';

type Props = {
  category: Category;
};

export function PostTopBreadcrumb({ category }: Props) {
  const catLabel = POST_CATEGORY_OPTIONS.find((o) => o.value === category)?.label ?? category;
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
