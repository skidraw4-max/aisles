'use client';

import Link from 'next/link';
import type { Category } from '@prisma/client';
import { PostThumbnail } from '@/components/post/PostThumbnail';
import { sendGAEvent } from '@/lib/ga4';
import styles from './post.module.css';

export type RelatedPostCardItem = {
  id: string;
  title: string;
  thumbnail: string | null;
  category: Category;
  authorUsername: string;
  metadataParams?: unknown;
};

type Props = {
  fromPostId: string;
  posts: RelatedPostCardItem[];
};

export function PostRelatedPosts({ fromPostId, posts }: Props) {
  if (posts.length === 0) return null;

  return (
    <section className={styles.relatedSection} aria-labelledby="post-related-title">
      <div className={styles.relatedPanel}>
        <h2 id="post-related-title" className={styles.relatedHeading}>
          이어서 읽기
        </h2>
        <ul className={styles.relatedList}>
          {posts.map((p) => (
            <li key={p.id} className={styles.relatedListItem}>
              <Link
                href={`/post/${p.id}`}
                className={styles.relatedCard}
                onClick={() =>
                  sendGAEvent('related_post_click', {
                    from_post_id: fromPostId,
                    to_post_id: p.id,
                  })
                }
              >
                <div className={styles.relatedCardThumb}>
                  <PostThumbnail
                    thumbnail={p.thumbnail}
                    category={p.category}
                    alt=""
                    layout="compact"
                    metadataParams={p.metadataParams}
                  />
                  <span className={styles.relatedCardThumbOverlay} aria-hidden />
                </div>
                <div className={styles.relatedCardBody}>
                  <p className={styles.relatedCardTitle}>{p.title}</p>
                  <p className={styles.relatedCardAuthor}>{p.authorUsername}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
