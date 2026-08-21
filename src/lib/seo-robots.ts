import type { Metadata } from 'next';

/** 프로덕션 배포·공개 도메인에서만 검색 색인 허용 */
export function shouldAllowSearchIndexing(): boolean {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv && vercelEnv !== 'production') {
    return false;
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? '';
  if (siteUrl && /\.vercel\.app/i.test(siteUrl)) {
    return false;
  }
  return true;
}

export const SEO_ROBOTS_PUBLIC: NonNullable<Metadata['robots']> = {
  index: true,
  follow: true,
  googleBot: {
    index: true,
    follow: true,
    'max-image-preview': 'large',
    'max-snippet': -1,
  },
};

export const SEO_ROBOTS_PRIVATE: NonNullable<Metadata['robots']> = {
  index: false,
  follow: false,
};

/** 검색 결과 등 thin/중복 URL — 색인 제외하되 링크는 따라감 */
export const SEO_ROBOTS_NOINDEX_FOLLOW: NonNullable<Metadata['robots']> = {
  index: false,
  follow: true,
  googleBot: {
    index: false,
    follow: true,
  },
};

export function rootLayoutRobots(): Metadata['robots'] {
  return shouldAllowSearchIndexing() ? SEO_ROBOTS_PUBLIC : SEO_ROBOTS_PRIVATE;
}
