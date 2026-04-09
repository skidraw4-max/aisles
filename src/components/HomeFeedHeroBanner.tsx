import Link from 'next/link';
import type { HeroBannerPost } from '@/lib/home-hero-banner';
import { POST_CATEGORY_OPTIONS } from '@/lib/post-categories';
import styles from '@/app/page.module.css';

function categoryLabel(c: HeroBannerPost['category']) {
  return POST_CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c;
}

function truncateTitle(title: string, max = 72) {
  const t = title.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

type Props = {
  post: HeroBannerPost | null;
};

export function HomeFeedHeroBanner({ post }: Props) {
  const hasImage = Boolean(post?.thumbnail);

  const heading =
    post?.category === 'RECIPE'
      ? '오늘의 추천 AI 레시피'
      : 'AIsleHub에 오신 것을 환영합니다';

  const subtitle = post
    ? post.category === 'RECIPE'
      ? truncateTitle(post.title)
      : `커뮤니티에서 가장 뜨거운 반응을 받는 ${categoryLabel(post.category)} 픽 — ${truncateTitle(post.title, 56)}`
    : 'Lab·Gallery·Build·Launch 네 복도에서 아이디어를 실험하고, 전시하고, 빌드하고 출시까지 이어가 보세요.';

  const ctaHref = post ? `/post/${post.id}` : '/upload';

  return (
    <section className={styles.feedHeroBanner} aria-labelledby="feed-hero-heading">
      <div className={styles.feedHeroMedia} aria-hidden>
        {hasImage ? (
          <>
            <img
              src={post!.thumbnail}
              alt=""
              className={styles.feedHeroBgImg}
              decoding="async"
              fetchPriority="high"
            />
            <div className={styles.feedHeroImageTint} />
          </>
        ) : (
          <div className={styles.feedHeroGradientFallback} />
        )}
        <div className={styles.feedHeroOverlay} />
      </div>

      <div className={styles.feedHeroInner}>
        <div className={styles.feedHeroGlass}>
          <p className={styles.feedHeroEyebrow}>
            {post ? (post.category === 'RECIPE' ? 'Featured recipe' : 'Community spotlight') : 'AIsleHub'}
          </p>
          <h2 id="feed-hero-heading" className={styles.feedHeroTitle}>
            {heading}
          </h2>
          <p className={styles.feedHeroSubtitle}>{subtitle}</p>
          <Link href={ctaHref} className={styles.feedHeroCta}>
            자세히 보기
          </Link>
        </div>
      </div>
    </section>
  );
}
