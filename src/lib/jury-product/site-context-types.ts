/** Client-safe site context types (P1). Logic lives in site-context.ts. */
export const SITE_TYPES = [
  { value: 'commerce', label: '쇼핑몰·커머스' },
  { value: 'saas', label: 'SaaS·업무 도구' },
  { value: 'content', label: '콘텐츠·미디어' },
  { value: 'community', label: '커뮤니티' },
  { value: 'corporate', label: '기업·브랜드 소개' },
  { value: 'other', label: '기타' },
] as const;
export type SiteType = (typeof SITE_TYPES)[number]['value'];

export const SITE_CONTEXT_LIMITS = { text: 200, tasks: 3, task: 80, url: 300 } as const;

export type SiteContext = {
  siteType: SiteType;
  primaryUsers: string;
  coreTasks: string[];
  brandTraits: string;
  /** Stored only. Not sent to reviews and not compared against (yet). */
  referenceUrl: string | null;
  updatedAt: string;
};

