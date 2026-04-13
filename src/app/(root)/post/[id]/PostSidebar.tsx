import Link from 'next/link';
import type { Category } from '@prisma/client';
import { POST_CATEGORY_OPTIONS } from '@/lib/post-categories';
import { ExternalServiceCta } from './ExternalServiceCta';
import { LaunchVisitProjectCta } from './LaunchVisitProjectCta';
import styles from './post.module.css';

export type SidebarRelatedItem = {
  id: string;
  title: string;
  likeCount: number;
};

export type SidebarPopularItem = {
  id: string;
  title: string;
  thumbnail: string | null;
  likeCount: number;
  excerpt: string;
};

type Props = {
  category: Category;
  related: SidebarRelatedItem[];
  popular: SidebarPopularItem[];
  externalLink?: string | null;
};

export function PostSidebar({ category, related, popular, externalLink }: Props) {
  const catLabel = POST_CATEGORY_OPTIONS.find((o) => o.value === category)?.label ?? category;

  return (
    <aside className={styles.sidebar} aria-label="사이드바">
      {category === 'LAUNCH' && externalLink?.trim() ? (
        <section className={styles.sidebarProjectLink} aria-labelledby="sidebar-project-link-heading">
          <h2 id="sidebar-project-link-heading" className={styles.sidebarProjectLinkHeading}>
            Project Link
          </h2>
          <LaunchVisitProjectCta href={externalLink} size="sidebar" />
        </section>
      ) : externalLink?.trim() ? (
        <ExternalServiceCta href={externalLink} variant="sidebar" sidebarHighlight={false} />
      ) : null}
      <div className={`${styles.magazineCard} ${styles.sidebarCard} ${styles.sidebarCardTight}`}>
        <h2 className={styles.sidebarHeading}>
          More in {catLabel}
        </h2>
        {related.length === 0 ? (
          <p className={styles.sidebarEmpty}>같은 카테고리의 다른 글이 아직 없습니다.</p>
        ) : (
          <ul className={styles.sidebarRelatedList}>
            {related.map((p) => (
              <li key={p.id}>
                <Link href={`/post/${p.id}`} className={styles.sidebarRelatedRow}>
                  <span className={styles.sidebarRelatedTitle}>{p.title}</span>
                  <span className={styles.sidebarRelatedStat} title="좋아요">
                    ♥ {p.likeCount.toLocaleString('ko-KR')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.sidebarCategoryHint}>{catLabel} 카테고리</p>
      </div>

      <div className={`${styles.magazineCard} ${styles.sidebarCard} ${styles.sidebarCardTight}`}>
        <h2 className={styles.sidebarHeading}>이번 주 인기 추천</h2>
        {popular.length === 0 ? (
          <p className={styles.sidebarEmpty}>이번 주 인기 글이 아직 없습니다.</p>
        ) : (
          <ul className={styles.sidebarPopularList}>
            {popular.map((p) => (
              <li key={p.id}>
                <Link href={`/post/${p.id}`} className={styles.sidebarPopularCard}>
                  <div className={styles.sidebarPopularThumb}>
                    {p.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element -- 외부 R2 URL
                      <img src={p.thumbnail} alt="" className={styles.sidebarPopularThumbImg} />
                    ) : (
                      <div className={styles.sidebarPopularThumbPh} aria-hidden />
                    )}
                  </div>
                  <div className={styles.sidebarPopularBody}>
                    <p className={styles.sidebarPopularTitle}>{p.title}</p>
                    <p className={styles.sidebarPopularExcerpt}>{p.excerpt}</p>
                    <p className={styles.sidebarPopularMeta}>♥ {p.likeCount.toLocaleString('ko-KR')}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.premiumBanner} aria-label="AIsle 프리미엄">
        <div className={styles.premiumBannerIcon} aria-hidden>
          <span className={styles.premiumBannerRocket}>🚀</span>
        </div>
        <p className={styles.premiumBannerKicker}>AIsle 프리미엄 런칭</p>
        <p className={styles.premiumBannerText}>
          독점 레시피·빌드 인사이트·우선 지원으로 창작 워크플로를 한 단계 업그레이드하세요.
        </p>
        <Link href="/" className={styles.premiumBannerCta}>
          자세히 보기
        </Link>
      </div>
    </aside>
  );
}
