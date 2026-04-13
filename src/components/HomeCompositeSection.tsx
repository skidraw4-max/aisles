import Link from 'next/link';
import { MediaThumb } from '@/components/MediaThumb';
import {
  homeHrefForCategory,
  POST_CATEGORY_OPTIONS,
} from '@/lib/post-categories';
import type { Category } from '@prisma/client';
import type { HomeFeedPost } from '@/lib/home-feed';
import {
  fetchAiWorkShowcasePosts,
  fetchCommunityPreviewPosts,
} from '@/lib/home-composite';
import styles from '@/app/(root)/page.module.css';

function categoryUiLabel(c: Category) {
  return POST_CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c;
}

function formatDate(iso: Date) {
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

function MoreLink({ category, label }: { category: Category; label: string }) {
  return (
    <Link href={homeHrefForCategory(category)} className={styles.compositeMoreLink}>
      {label} 더보기 <span aria-hidden>+</span>
    </Link>
  );
}

function ShowcaseCard({ post }: { post: HomeFeedPost }) {
  return (
    <div className={styles.feedCardWrap}>
      <Link href={`/post/${post.id}`} className={styles.feedCard}>
        <div className={styles.feedCardMedia}>
          {post.thumbnail ? (
            <MediaThumb url={post.thumbnail} alt="" objectFit="cover" />
          ) : (
            <div className={styles.feedCardPlaceholder} aria-hidden />
          )}
          <span className={styles.feedCardBadge}>{categoryUiLabel(post.category)}</span>
        </div>
        <div className={styles.feedCardBody}>
          <h3 className={styles.feedCardTitle}>{post.title}</h3>
          {post.content ? (
            <p className={styles.feedCardSnippet}>
              {post.content.length > 120 ? `${post.content.slice(0, 120)}…` : post.content}
            </p>
          ) : null}
          <p className={styles.feedCardDate}>{formatDate(post.createdAt)}</p>
          <div className={styles.cardFooter}>
            <span className={styles.cardAuthor}>{post.author.username}</span>
            <span className={styles.likeStamp} title="좋아요">
              <span className={styles.heartIcon} aria-hidden>
                ♡
              </span>
              <span className={styles.likeNum}>{post.likeCount}</span>
            </span>
          </div>
        </div>
      </Link>
    </div>
  );
}

function CommunityListItem({ post }: { post: HomeFeedPost }) {
  const cc = post._count?.comments ?? 0;
  return (
    <li className={styles.communityListItem}>
      <Link href={`/post/${post.id}`} className={styles.communityListLink}>
        <span className={styles.communityListTitle}>{post.title}</span>
        <span className={styles.communityListMeta}>
          {post.author.username}
          {cc > 0 ? ` · 댓글 ${cc}` : ''} · {formatDate(post.createdAt)}
        </span>
      </Link>
    </li>
  );
}

export async function HomeCompositeSection() {
  const [aiWorkPosts, community] = await Promise.all([
    fetchAiWorkShowcasePosts(),
    fetchCommunityPreviewPosts(),
  ]);

  return (
    <div className={styles.compositeWrap}>
      <section className={styles.compositeBlock} aria-labelledby="composite-ai-work-heading">
        <header className={styles.compositeHead}>
          <div>
            <h2 id="composite-ai-work-heading" className={styles.compositeTitle}>
              AI Work
            </h2>
            <p className={styles.compositeSubtitle}>Lab·Gallery 인기 글</p>
          </div>
          <div className={styles.compositeMoreGroup} role="group" aria-label="복도로 이동">
            <MoreLink category="RECIPE" label="LAB" />
            <MoreLink category="GALLERY" label="GALLERY" />
          </div>
        </header>
        {aiWorkPosts.length === 0 ? (
          <p className={styles.compositeEmpty}>아직 노출할 글이 없습니다.</p>
        ) : (
          <ul className={styles.aiWorkGrid}>
            {aiWorkPosts.map((post) => (
              <li key={post.id} className={styles.aiWorkGridCell}>
                <ShowcaseCard post={post} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.compositeBlock} aria-labelledby="composite-community-heading">
        <header className={styles.compositeHead}>
          <div>
            <h2 id="composite-community-heading" className={styles.compositeTitle}>
              Community
            </h2>
            <p className={styles.compositeSubtitle}>Lounge·Gossip 최신 글</p>
          </div>
          <div className={styles.compositeMoreGroup} role="group" aria-label="복도로 이동">
            <MoreLink category="LOUNGE" label="LOUNGE" />
            <MoreLink category="GOSSIP" label="GOSSIP" />
          </div>
        </header>
        <div className={styles.communitySplit}>
          <div className={styles.communityCol}>
            <h3 className={styles.communityColLabel}>LOUNGE</h3>
            {community.lounge.length === 0 ? (
              <p className={styles.compositeEmpty}>글이 없습니다.</p>
            ) : (
              <ul className={styles.communityList}>
                {community.lounge.map((post) => (
                  <CommunityListItem key={post.id} post={post} />
                ))}
              </ul>
            )}
          </div>
          <div className={styles.communityCol}>
            <h3 className={styles.communityColLabel}>GOSSIP</h3>
            {community.gossip.length === 0 ? (
              <p className={styles.compositeEmpty}>글이 없습니다.</p>
            ) : (
              <ul className={styles.communityList}>
                {community.gossip.map((post) => (
                  <CommunityListItem key={post.id} post={post} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
