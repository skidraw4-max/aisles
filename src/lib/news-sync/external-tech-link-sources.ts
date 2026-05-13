/**
 * 외부 테크 링크(HN·Lobsters 등) 자동 수집 소스 메타데이터.
 * 크론·운영 문서에서 공식 URL을 한곳에서 참조한다.
 */

/** Lobsters 공식 RSS (RSS 2.0, channel `ttl` 120분, Content-Type: application/rss+xml) */
export const LOBSTERS_RSS_URL = 'https://lobste.rs/rss' as const;

export type ExternalTechLinkSourceId = 'hackernews' | 'lobsters';

export type ExternalTechLinkSource = {
  id: ExternalTechLinkSourceId;
  displayName: string;
  /** 브라우저·앱 구독용 공식 피드 URL. API 전용 소스는 undefined */
  officialFeedUrl?: string;
};

/** HN은 Firebase JSON API, Lobsters는 공식 RSS만 사용 */
export const EXTERNAL_TECH_LINK_SOURCES: readonly ExternalTechLinkSource[] = [
  { id: 'hackernews', displayName: 'Hacker News' },
  { id: 'lobsters', displayName: 'Lobsters', officialFeedUrl: LOBSTERS_RSS_URL },
] as const;
