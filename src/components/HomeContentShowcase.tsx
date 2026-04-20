import type { ReactNode } from 'react';
import Link from 'next/link';
import { PostThumbnail } from '@/components/post/PostThumbnail';
import { corridorLabel, getAllUiLabels } from '@/lib/ui-config';
import type { HomeFeedPost } from '@/lib/home-feed';
import styles from '@/app/(root)/page.module.css';

function excerptLine(text: string | null | undefined, max = 96) {
  const t = text?.trim() ?? '';
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

type Props = {
  toolbar?: ReactNode;
  leftPosts: HomeFeedPost[];
  rightPosts: HomeFeedPost[];
};

export async function HomeContentShowcase({ toolbar, leftPosts, rightPosts }: Props) {
  const ui = await getAllUiLabels();
  const hasAny = leftPosts.length > 0 || rightPosts.length > 0;

  return (
    <section className={styles.contentShowcase} aria-labelledby="content-showcase-heading">
      <div className={styles.contentShowcaseHead}>
        <h2 id="content-showcase-heading" className={styles.contentShowcaseTitle}>
          콘텐츠
        </h2>
        {toolbar ? <div className={styles.contentShowcaseTabsRow}>{toolbar}</div> : null}
      </div>

      {!hasAny ? (
        <p className={styles.contentShowcaseEmpty}>이 구간에 표시할 글이 아직 없습니다.</p>
      ) : (
        <div className={styles.contentShowcaseLayout}>
          <div className={styles.contentShowcaseMain}>
            {leftPosts.length === 0 ? (
              <p className={styles.contentShowcaseEmpty}>아직 표시할 글이 없습니다.</p>
            ) : (
              <ul className={styles.contentShowcaseLargeGrid}>
                {leftPosts.map((post) => (
                  <li key={post.id}>
                    <Link href={`/post/${post.id}`} className={styles.contentShowcaseLargeCard}>
                      <div className={styles.contentShowcaseLargeMedia}>
                        <PostThumbnail
                          thumbnail={post.thumbnail}
                          category={post.category}
                          alt=""
                          layout="showcaseLarge"
                          metadataParams={post.metadata?.params}
                        />
                        <span className={styles.contentShowcaseCat}>{corridorLabel(ui, post.category)}</span>
                        {post.isFeatured ? (
                          <span className={styles.contentShowcasePick}>Pick</span>
                        ) : null}
                      </div>
                      <div className={styles.contentShowcaseLargeBody}>
                        <h3 className={styles.contentShowcaseLargeTitle}>{post.title}</h3>
                        {post.content?.trim() ? (
                          <p className={styles.contentShowcaseLargeExcerpt}>
                            {excerptLine(post.content, 100)}
                          </p>
                        ) : null}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <aside className={styles.contentShowcaseAside} aria-label="추가 글 목록">
            {rightPosts.length === 0 ? (
              <p className={styles.contentShowcaseAsideEmpty}>더 많은 글을 불러오면 여기에 표시됩니다.</p>
            ) : (
              <ul className={styles.contentShowcaseList}>
                {rightPosts.map((post) => (
                  <li key={post.id}>
                    <Link href={`/post/${post.id}`} className={styles.contentShowcaseListRow}>
                      <div className={styles.contentShowcaseListThumb}>
                        <PostThumbnail
                          thumbnail={post.thumbnail}
                          category={post.category}
                          alt=""
                          layout="showcaseList"
                          metadataParams={post.metadata?.params}
                        />
                      </div>
                      <div className={styles.contentShowcaseListText}>
                        <p className={styles.contentShowcaseListTitle}>{post.title}</p>
                        {post.content?.trim() ? (
                          <p className={styles.contentShowcaseListExcerpt}>{excerptLine(post.content, 72)}</p>
                        ) : null}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
