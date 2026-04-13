import Link from 'next/link';
import { homeHrefForCategory } from '@/lib/post-categories';
import type { Category } from '@prisma/client';
import styles from './post.module.css';

export type PostCategoryBoardItem = {
  id: string;
  title: string;
  views: number;
  authorUsername: string;
  commentCount: number;
};

type Props = {
  category: Category;
  categoryLabel: string;
  currentPostId: string;
  posts: PostCategoryBoardItem[];
};

/** 상세 하단 — 동일 복도 전체 글 퀘이사존식 리스트 */
export function PostCategoryBoardList({
  category,
  categoryLabel,
  currentPostId,
  posts,
}: Props) {
  if (posts.length === 0) {
    return null;
  }

  const gossip = category === 'GOSSIP';

  return (
    <section
      className={`${styles.postCategoryBoard} ${gossip ? styles.postCategoryBoardGossip : ''}`}
      aria-labelledby="post-category-board-title"
    >
      <div className={styles.postCategoryBoardToolbar}>
        <h2 id="post-category-board-title" className={styles.postCategoryBoardHeading}>
          {categoryLabel} 글 목록
        </h2>
        <Link href={homeHrefForCategory(category)} className={styles.postCategoryBoardMore}>
          복도로 이동 →
        </Link>
      </div>
      <div className={styles.postCategoryBoardSurface}>
        <div className={styles.postCategoryBoardHead} role="row">
          <span className={styles.postCategoryBoardHeadMain} role="columnheader">
            제목
          </span>
          <span className={styles.postCategoryBoardHeadMeta} role="presentation">
            <span role="columnheader">글쓴이</span>
            <span role="columnheader">조회</span>
          </span>
        </div>
        <div className={styles.postCategoryBoardScroll}>
          <ul className={styles.postCategoryBoardList} role="list">
            {posts.map((p) => {
              const isCurrent = p.id === currentPostId;
              const cc = p.commentCount;
              return (
                <li key={p.id} className={styles.postCategoryBoardRow}>
                  <Link
                    href={`/post/${p.id}`}
                    className={
                      isCurrent
                        ? `${styles.postCategoryBoardLink} ${styles.postCategoryBoardLinkCurrent}`
                        : styles.postCategoryBoardLink
                    }
                    aria-current={isCurrent ? 'page' : undefined}
                  >
                    <span className={styles.postCategoryBoardMain}>
                      <span className={styles.postCategoryBoardTitleLine}>
                        <span className={styles.postCategoryBoardTitleStr}>{p.title}</span>
                        <span className={styles.postCategoryBoardComments} title={`댓글 ${cc}개`}>
                          [{cc}]
                        </span>
                      </span>
                    </span>
                    <span className={styles.postCategoryBoardMeta}>
                      <span className={styles.postCategoryBoardAuthor} title={p.authorUsername}>
                        {p.authorUsername}
                      </span>
                      <span className={styles.postCategoryBoardViews} title="조회수">
                        {p.views.toLocaleString('ko-KR')}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
