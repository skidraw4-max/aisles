import type { Category } from '@prisma/client';
import { buildPostMetaDescription } from '@/lib/post-meta-description';

type PostOriginalUrlFields = {
  externalLink?: string | null;
  geeknewsOriginalUrl?: string | null;
  hackerNewsOriginalUrl?: string | null;
  lobstersOriginalUrl?: string | null;
  techmemeOriginalUrl?: string | null;
  vergeOriginalUrl?: string | null;
  aiBreakfastOriginalUrl?: string | null;
  mitNewsOriginalUrl?: string | null;
  youtubeVideoId?: string | null;
};

export type PostJsonLdInput = PostOriginalUrlFields & {
  id: string;
  title: string;
  content: string | null;
  category: Category;
  createdAt: Date;
  thumbnail: string | null;
  authorUsername: string;
  categoryLabel: string;
  siteBase: string;
  aiFortuneTrendBullets?: string[] | null;
};

function toAbsoluteMediaUrl(raw: string, siteBase: string): string {
  const u = raw.trim();
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  if (u.startsWith('//')) return `https:${u}`;
  return new URL(u.startsWith('/') ? u : `/${u}`, siteBase).href;
}

/** 자동 수집·외부 연결 원문 URL — post 상세 CTA와 동일 우선순위 */
export function resolvePostOriginalSourceUrl(post: PostOriginalUrlFields): string | null {
  const ytId = post.youtubeVideoId?.trim() ?? '';
  const href = (
    post.externalLink ??
    post.geeknewsOriginalUrl ??
    post.hackerNewsOriginalUrl ??
    post.lobstersOriginalUrl ??
    post.techmemeOriginalUrl ??
    post.vergeOriginalUrl ??
    post.aiBreakfastOriginalUrl ??
    post.mitNewsOriginalUrl ??
    (ytId ? `https://www.youtube.com/watch?v=${ytId}` : '')
  ).trim();
  return href || null;
}

type SchemaArticleType = 'NewsArticle' | 'TechArticle' | 'Article';

function schemaTypeForCategory(category: Category): SchemaArticleType | null {
  switch (category) {
    case 'LOUNGE':
    case 'GOSSIP':
    case 'TREND':
      return 'NewsArticle';
    case 'BUILD':
    case 'LAUNCH':
    case 'RECIPE':
      return 'TechArticle';
    case 'AI_FORTUNE':
      return 'TechArticle';
    case 'GALLERY':
      return 'Article';
    default:
      return null;
  }
}

/** 크론·에이전트 게시물은 JSON-LD author를 AI Agent로 통일 */
function jsonLdAuthorName(category: Category, authorUsername: string): string {
  if (category === 'LOUNGE' || category === 'GOSSIP' || category === 'AI_FORTUNE') {
    return 'AI Agent';
  }
  return authorUsername.trim() || 'AIsle';
}

function buildDescription(input: PostJsonLdInput): string {
  if (input.category === 'AI_FORTUNE' && input.aiFortuneTrendBullets?.length) {
    const trends = input.aiFortuneTrendBullets.map((b) => b.trim()).filter(Boolean).slice(0, 3);
    if (trends.length > 0) {
      return trends.join(' ');
    }
  }
  return buildPostMetaDescription({
    title: input.title,
    content: input.content,
    categoryLabel: input.categoryLabel,
  });
}

/**
 * 게시글 상세용 Schema.org JSON-LD. 해당 카테고리만 생성(null이면 스크립트 생략).
 * LOUNGE·GOSSIP → NewsArticle, BUILD·LAUNCH·RECIPE·AI_FORTUNE → TechArticle.
 */
export function buildPostArticleJsonLd(input: PostJsonLdInput): Record<string, unknown> | null {
  const schemaType = schemaTypeForCategory(input.category);
  if (!schemaType) return null;

  const postUrl = `${input.siteBase.replace(/\/$/, '')}/post/${input.id}`;
  const originalUrl = resolvePostOriginalSourceUrl(input);
  const authorName = jsonLdAuthorName(input.category, input.authorUsername);
  const description = buildDescription(input);

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': schemaType,
    headline: input.title,
    description,
    datePublished: input.createdAt.toISOString(),
    dateModified: input.createdAt.toISOString(),
    author: { '@type': 'Person', name: authorName },
    publisher: { '@type': 'Organization', name: 'AIsle', url: input.siteBase },
    mainEntityOfPage: postUrl,
    url: postUrl,
    inLanguage: 'ko-KR',
  };

  const thumb = input.thumbnail?.trim();
  if (thumb) {
    jsonLd.image = [toAbsoluteMediaUrl(thumb, input.siteBase)];
  }

  if (originalUrl) {
    jsonLd.isBasedOn = { '@type': 'WebPage', url: originalUrl };
  }

  if (input.category === 'AI_FORTUNE' && input.aiFortuneTrendBullets?.length) {
    jsonLd.about = input.aiFortuneTrendBullets.slice(0, 5).map((text) => ({
      '@type': 'Thing',
      name: text.trim().slice(0, 200),
    }));
  }

  return jsonLd;
}
