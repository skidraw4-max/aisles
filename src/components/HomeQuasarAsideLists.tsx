'use client';

import Link from 'next/link';
import { homeHrefForCategory } from '@/lib/post-categories';
import { FeedPostLink } from '@/components/FeedPostLink';
import type { Category } from '@prisma/client';
import styles from '@/app/(root)/page.module.css';

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

function AsideListItem({ post, category }: { post: QuasarAsidePost; category: Category }) {
  const cc = post.commentCount;
  return (
    <li className={styles.quasarAsideListItem}>
      <FeedPostLink
        href={`/post/${post.id}`}
        className={styles.quasarAsideListLink}
        postId={post.id}
        category={category}
        surface="quasar_sidebar"
      >
        <span className={styles.quasarAsideListTitle}>{post.title}</span>
        <span className={styles.quasarAsideListMeta}>
          {post.authorUsername}
          {cc > 0 ? ` · 댓글 ${cc}` : ''} · {formatDate(post.createdAtIso)}
        </span>
      </FeedPostLink>
    </li>
  );
}

type Props = {
  lounge: QuasarAsidePost[];
  gossip: QuasarAsidePost[];
  loungeTitle: string;
  gossipTitle: string;
  asideAriaLabel: string;
  emptyMessage: string;
};

/** LOUNGE / GOSSIP 사이드 리스트 — next/dynamic + ssr:false 로 지연 로드 */
export function HomeQuasarAsideLists({
  lounge,
  gossip,
  loungeTitle,
  gossipTitle,
  asideAriaLabel,
  emptyMessage,
}: Props) {
  return (
    <aside className={styles.quasarBoardAside} aria-label={asideAriaLabel}>
      <div className={styles.quasarAsidePanel}>
        <header className={styles.quasarAsidePanelHead}>
          <h2 className={styles.quasarAsidePanelTitle}>{loungeTitle}</h2>
          <MoreLink category="LOUNGE" label={loungeTitle} />
        </header>
        {lounge.length === 0 ? (
          <p className={styles.quasarAsideEmpty}>{emptyMessage}</p>
        ) : (
          <ul className={styles.quasarAsideList}>
            {lounge.map((post) => (
              <AsideListItem key={post.id} post={post} category="LOUNGE" />
            ))}
          </ul>
        )}
      </div>
      <div className={styles.quasarAsidePanel}>
        <header className={styles.quasarAsidePanelHead}>
          <h2 className={styles.quasarAsidePanelTitle}>{gossipTitle}</h2>
          <MoreLink category="GOSSIP" label={gossipTitle} />
        </header>
        {gossip.length === 0 ? (
          <p className={styles.quasarAsideEmpty}>{emptyMessage}</p>
        ) : (
          <ul className={styles.quasarAsideList}>
            {gossip.map((post) => (
              <AsideListItem key={post.id} post={post} category="GOSSIP" />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
