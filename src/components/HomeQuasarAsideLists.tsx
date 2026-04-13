'use client';

import Link from 'next/link';
import { homeHrefForCategory } from '@/lib/post-categories';
import type { Category } from '@prisma/client';
import styles from '@/app/page.module.css';

export type QuasarAsidePost = {
  id: string;
  title: string;
  authorUsername: string;
  commentCount: number;
  createdAtIso: string;
};

function MoreLink({ category, label }: { category: Category; label: string }) {
  return (
    <Link href={homeHrefForCategory(category)} className={styles.compositeMoreLink}>
      {label} 더보기 <span aria-hidden>+</span>
    </Link>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function AsideListItem({ post }: { post: QuasarAsidePost }) {
  const cc = post.commentCount;
  return (
    <li className={styles.quasarAsideListItem}>
      <Link href={`/post/${post.id}`} className={styles.quasarAsideListLink}>
        <span className={styles.quasarAsideListTitle}>{post.title}</span>
        <span className={styles.quasarAsideListMeta}>
          {post.authorUsername}
          {cc > 0 ? ` · 댓글 ${cc}` : ''} · {formatDate(post.createdAtIso)}
        </span>
      </Link>
    </li>
  );
}

type Props = {
  lounge: QuasarAsidePost[];
  gossip: QuasarAsidePost[];
};

/** LOUNGE / GOSSIP 사이드 리스트 — next/dynamic + ssr:false 로 지연 로드 */
export function HomeQuasarAsideLists({ lounge, gossip }: Props) {
  return (
    <aside className={styles.quasarBoardAside} aria-label="라운지·가십 최신">
      <div className={styles.quasarAsidePanel}>
        <header className={styles.quasarAsidePanelHead}>
          <h2 className={styles.quasarAsidePanelTitle}>LOUNGE</h2>
          <MoreLink category="LOUNGE" label="LOUNGE" />
        </header>
        {lounge.length === 0 ? (
          <p className={styles.quasarAsideEmpty}>글이 없습니다.</p>
        ) : (
          <ul className={styles.quasarAsideList}>
            {lounge.map((post) => (
              <AsideListItem key={post.id} post={post} />
            ))}
          </ul>
        )}
      </div>
      <div className={styles.quasarAsidePanel}>
        <header className={styles.quasarAsidePanelHead}>
          <h2 className={styles.quasarAsidePanelTitle}>GOSSIP</h2>
          <MoreLink category="GOSSIP" label="GOSSIP" />
        </header>
        {gossip.length === 0 ? (
          <p className={styles.quasarAsideEmpty}>글이 없습니다.</p>
        ) : (
          <ul className={styles.quasarAsideList}>
            {gossip.map((post) => (
              <AsideListItem key={post.id} post={post} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
