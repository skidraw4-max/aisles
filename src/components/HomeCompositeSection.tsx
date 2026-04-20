import Link from 'next/link';
import { PostThumbnail } from '@/components/post/PostThumbnail';
import { homeHrefForCategory } from '@/lib/post-categories';
import { corridorLabel, getAllUiLabels } from '@/lib/ui-config';
import type { Category } from '@prisma/client';
import type { HomeFeedPost } from '@/lib/home-feed';
import {
  fetchAiWorkShowcasePosts,
  fetchCommunityPreviewPosts,
} from '@/lib/home-composite';
import styles from '@/app/(root)/page.module.css';

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

function ShowcaseCard({ post, ui }: { post: HomeFeedPost; ui: Record<string, string> }) {
  return (
    <div className={styles.feedCardWrap}>
      <Link href={`/post/${post.id}`} className={styles.feedCard}>
        <div className={styles.feedCardMedia}>
          <PostThumbnail
            thumbnail={post.thumbnail}
            category={post.category}
            alt=""
            layout="card"
            metadataParams={post.metadata?.params}
          />
          <span className={styles.feedCardBadge}>{corridorLabel(ui, post.category)}</span>
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
  const [ui, aiWorkPosts, community] = await Promise.all([
    getAllUiLabels(),
    fetchAiWorkShowcasePosts(),
    fetchCommunityPreviewPosts(),
  ]);

  const loungeTitle = corridorLabel(ui, 'LOUNGE');
  const gossipTitle = corridorLabel(ui, 'GOSSIP');

  return (
    <div className={styles.compositeWrap}>
      <section className={styles.compositeBlock} aria-labelledby="composite-ai-work-heading">
        <header className={styles.compositeHead}>
          <div>
            <h2 id="composite-ai-work-heading" className={styles.compositeTitle}>
              {ui['home.composite.ai_work.title']}
            </h2>
            <p className={styles.compositeSubtitle}>{ui['home.composite.ai_work.subtitle']}</p>
          </div>
          <div className={styles.compositeMoreGroup} role="group" aria-label="복도로 이동">
            <MoreLink category="RECIPE" label={ui['home.quasar.more_lab'] ?? ''} />
            <MoreLink category="GALLERY" label={ui['home.quasar.more_gallery'] ?? ''} />
          </div>
        </header>
        {aiWorkPosts.length === 0 ? (
          <p className={styles.compositeEmpty}>{ui['home.composite.empty']}</p>
        ) : (
          <ul className={styles.aiWorkGrid}>
            {aiWorkPosts.map((post) => (
              <li key={post.id} className={styles.aiWorkGridCell}>
                <ShowcaseCard post={post} ui={ui} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.compositeBlock} aria-labelledby="composite-community-heading">
        <header className={styles.compositeHead}>
          <div>
            <h2 id="composite-community-heading" className={styles.compositeTitle}>
              {ui['home.composite.community.title']}
            </h2>
            <p className={styles.compositeSubtitle}>{ui['home.composite.community.subtitle']}</p>
          </div>
          <div className={styles.compositeMoreGroup} role="group" aria-label="복도로 이동">
            <MoreLink category="LOUNGE" label={loungeTitle} />
            <MoreLink category="GOSSIP" label={gossipTitle} />
          </div>
        </header>
        <div className={styles.communitySplit}>
          <div className={styles.communityCol}>
            <h3 className={styles.communityColLabel}>{loungeTitle}</h3>
            {community.lounge.length === 0 ? (
              <p className={styles.compositeEmpty}>{ui['home.composite.empty_col']}</p>
            ) : (
              <ul className={styles.communityList}>
                {community.lounge.map((post) => (
                  <CommunityListItem key={post.id} post={post} />
                ))}
              </ul>
            )}
          </div>
          <div className={styles.communityCol}>
            <h3 className={styles.communityColLabel}>{gossipTitle}</h3>
            {community.gossip.length === 0 ? (
              <p className={styles.compositeEmpty}>{ui['home.composite.empty_col']}</p>
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
