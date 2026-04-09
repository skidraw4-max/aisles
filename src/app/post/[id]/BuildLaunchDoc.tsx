import type { Category } from '@prisma/client';
import {
  extractFirstHttpUrl,
  parseProductDocContent,
  stripStandaloneUrlFromOverview,
} from '@/lib/build-launch-content';
import styles from './post.module.css';

type Props = {
  category: Category;
  content: string | null;
  serviceUrl: string | null | undefined;
  status: string | null | undefined;
};

function isBodyOnlyUrl(text: string | null | undefined): boolean {
  const t = text?.trim();
  if (!t) return false;
  const u = extractFirstHttpUrl(t);
  if (!u) return false;
  return t.replace(u, '').trim().length === 0;
}

export function BuildLaunchDoc({ category, content, serviceUrl, status }: Props) {
  const isLaunch = category === 'LAUNCH';
  const { features, overview: overviewRaw } = parseProductDocContent(content);
  const urlFromContent = extractFirstHttpUrl(content);
  const primaryUrl = (serviceUrl?.trim() || urlFromContent || '').trim() || null;
  const overview = stripStandaloneUrlFromOverview(overviewRaw, primaryUrl);
  const contentTrim = content?.trim() ?? '';
  const showPlainFallback =
    !overview && features.length === 0 && Boolean(contentTrim) && !isBodyOnlyUrl(content);

  const ctaLabel = isLaunch ? 'Visit Site' : 'Try it out';

  return (
    <section className={styles.productDoc} aria-label="제품·서비스 정보">
      <div className={styles.productDocToolbar}>
        <div className={styles.productDocToolbarLeft}>
          {status ? (
            <span className={styles.productStatusBadge} data-launch={isLaunch ? '1' : '0'}>
              {status}
            </span>
          ) : null}
          <span className={styles.productDocKicker}>{isLaunch ? 'Launch' : 'Build'}</span>
        </div>
        {primaryUrl ? (
          <a
            className={styles.productCta}
            href={primaryUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {ctaLabel}
            <span className={styles.productCtaArrow} aria-hidden>
              ↗
            </span>
          </a>
        ) : (
          <p className={styles.productCtaMissing}>
            데모·배포 URL이 아직 없습니다. 본문에 링크를 넣거나(LAUNCH) 서비스 URL을 등록하면 버튼이
            표시됩니다.
          </p>
        )}
      </div>

      {overview ? (
        <div className={styles.productDocBlock}>
          <h2 className={styles.productDocHeading}>개요</h2>
          <div className={styles.productDocProse}>
            {overview.split(/\n\n+/).map((para, i) => (
              <p key={i} className={styles.productDocParagraph}>
                {para}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {features.length > 0 ? (
        <div className={styles.productDocBlock}>
          <h2 className={styles.productDocHeading}>주요 특징</h2>
          <ul className={styles.productFeatureList}>
            {features.map((item, i) => (
              <li key={i} className={styles.productFeatureItem}>
                <span className={styles.productFeatureMark} aria-hidden>
                  ▸
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showPlainFallback ? (
        <div className={styles.productDocBlock}>
          <h2 className={styles.productDocHeading}>개요</h2>
          <div className={styles.productDocProse}>
            <p className={styles.productDocParagraph}>{contentTrim}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
