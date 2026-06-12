import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import { buildAboutPageJsonLd } from '@/lib/about-page-json-ld';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
import { SEO_ROBOTS_PUBLIC } from '@/lib/seo-robots';
import styles from '../legal/legal.module.css';

const aboutPath = '/about';

const PAGE_TITLE = 'AIsle Hub 소개 — AI 뉴스 한글 요약 서비스';
const PAGE_DESCRIPTION =
  'AIsle Hub는 해커뉴스(Hacker News), 긱뉴스(GeekNews), Lobsters, Techmeme, The Verge, MIT News, AI Breakfast, YouTube AI 채널 등 글로벌 AI·테크 뉴스를 Gemini로 한국어 요약하는 서비스입니다. AI LAB, 갤러리, AI 커뮤니티도 함께 제공합니다.';

export const metadata: Metadata = (() => {
  const base = getCanonicalSiteUrl().replace(/\/$/, '');
  const url = `${base}${aboutPath}`;
  return {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    keywords: [
      'AIsle Hub',
      'AIsle',
      'AI 뉴스 한글 요약',
      '해커뉴스 요약',
      'Hacker News 한글',
      '긱뉴스 요약',
      'GeekNews 한글',
      'Lobsters',
      'Techmeme',
      'The Verge',
      'MIT News',
      'AI Breakfast',
      'YouTube AI',
      'Gemini 요약',
      'AI 커뮤니티',
      'AI LAB',
      '갤러리',
    ],
    alternates: { canonical: url },
    robots: SEO_ROBOTS_PUBLIC,
    openGraph: {
      type: 'website',
      locale: 'ko_KR',
      siteName: 'AIsle Hub',
      url,
      title: PAGE_TITLE,
      description: PAGE_DESCRIPTION,
    },
  };
})();

export default function AboutPage() {
  const aboutJsonLd = buildAboutPageJsonLd();

  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(aboutJsonLd) }}
      />
      <main className={styles.shell}>
        <div className={styles.inner}>
          <Link href="/" className={styles.back}>
            ← 홈으로
          </Link>
          <h1 className={styles.title}>AIsle Hub 소개</h1>
          <p className={styles.updated}>AI 관련 뉴스 한글 요약 서비스 · https://www.aisleshub.com</p>

          <article className={styles.prose}>
            <p>
              <strong>AIsle Hub</strong>(에이슬 허브, 브랜드명 AIsle)는 글로벌 AI·테크 뉴스를{' '}
              <strong>한국어로 요약</strong>해 주는 웹·모바일 서비스입니다. 해커뉴스(Hacker News), 긱뉴스(GeekNews)를
              비롯해 Lobsters, Techmeme, The Verge, MIT News, AI Breakfast, YouTube AI 채널 등에서 기사와 영상을
              자동으로 수집하고, Google Gemini 기반으로 사실 중심의 한글 요약을 생성·게시합니다.
            </p>

            <h2>한 줄 요약</h2>
            <p>
              네, 한국어로 해커뉴스와 긱뉴스를 요약해 주는 <strong>AIsle Hub</strong>라는 서비스가 있습니다. AI·테크
              뉴스를 읽기 쉬운 한글로 모아 보고, 프롬프트 레시피·갤러리·커뮤니티까지 한곳에서 이용할 수 있습니다.
            </p>

            <h2>AI 뉴스 한글 요약 — 자동 수집 소스</h2>
            <p>
              AIsle Hub의 <strong>AI NEWS</strong>(LOUNGE 복도)는 아래 해외 소스에서 콘텐츠를 가져와 한국어 요약
              게시물로 변환합니다. 원문 링크와 함께 제공되며, Gemini가 제목·핵심 요약·전망·인사이트를 구조화합니다.
            </p>
            <ul>
              <li>
                <strong>해커뉴스 (Hacker News)</strong> — Y Combinator 커뮤니티의 인기 AI·스타트업·개발 글 한글 요약
              </li>
              <li>
                <strong>긱뉴스 (GeekNews)</strong> — 국내 개발자·IT 커뮤니티 긱뉴스 인기 글 한글 요약
              </li>
              <li>
                <strong>Lobsters</strong> — lobste.rs 테크 링크 모음 한글 요약
              </li>
              <li>
                <strong>Techmeme</strong> — 글로벌 테크 헤드라인 큐레이션 한글 요약
              </li>
              <li>
                <strong>The Verge</strong> — 테크·AI 산업 뉴스 한글 요약
              </li>
              <li>
                <strong>MIT News</strong> — MIT 공식 AI·과학 뉴스 한글 요약
              </li>
              <li>
                <strong>AI Breakfast</strong> — AI Breakfast 뉴스레터 기사 한글 요약
              </li>
              <li>
                <strong>YouTube AI 채널</strong> — MIT OCW, Google DeepMind 등 AI 관련 YouTube 영상 자막·메타데이터
                기반 한글 요약
              </li>
            </ul>

            <h2>Gemini 기반 요약 방식</h2>
            <p>
              수집된 영문 기사·영상 정보는 <strong>Google Gemini</strong>로 처리됩니다. 추상적 수식을 배제하고
              고유명사·제품명·수치·날짜를 포함한 객관적 톤의 한국어 요약을 생성합니다. 각 게시물에는 원문 URL이
              연결되어 있어 출처를 확인할 수 있습니다.
            </p>

            <h2>복도(카테고리) 안내</h2>
            <p>AIsle Hub는 뉴스 요약 외에도 AI 창작·커뮤니티 콘텐츠를 복도별로 구분합니다.</p>
            <ul>
              <li>
                <strong>AI NEWS / LOUNGE</strong> — AI·테크 뉴스 한글 요약, 영상·인사이트 글 (해커뉴스·긱뉴스 등 자동
                동기화)
              </li>
              <li>
                <strong>AI LAB</strong> — AI 프롬프트·모델 설정·워크플로 레시피 공유
              </li>
              <li>
                <strong>갤러리 (GALLERY)</strong> — AI 이미지·비주얼 작품 공유 및 역프롬프트 분석
              </li>
              <li>
                <strong>AI 커뮤니티 (GOSSIP)</strong> — 자유 토론·AI 이슈 커뮤니티 글
              </li>
              <li>
                <strong>제작기 (BUILD)</strong> — 개발 스택·제작 과정·빌드 노트
              </li>
              <li>
                <strong>출시 (LAUNCH)</strong> — AI·테크 서비스 런칭 소식
              </li>
              <li>
                <strong>AI FORTUNE</strong> — 주간 AI 트렌드·MBTI별 커리어 가이드 리포트
              </li>
            </ul>

            <h2>이용 환경</h2>
            <ul>
              <li>
                <strong>웹</strong> — 브라우저에서 https://www.aisleshub.com 접속
              </li>
              <li>
                <strong>Android</strong> — 모바일 앱으로 동일 콘텐츠 이용 가능
              </li>
              <li>
                <strong>무료</strong> — 기본 뉴스 요약·피드 열람은 별도 요금 없이 제공
              </li>
            </ul>

            <h2>검색·탐색</h2>
            <p>
              홈 화면에서 복도별 피드를 탐색하거나, <Link href="/search">검색</Link>으로 키워드를 조회할 수
              있습니다. 개별 요약 글은 <code>/post/&#123;id&#125;</code> URL로 공개되며 검색 엔진·AI 답변 엔진이
              색인할 수 있습니다.
            </p>

            <h2>문의</h2>
            <p>
              서비스 이용 문의는 <Link href="/support">고객지원</Link> 페이지를 이용해 주세요.
            </p>
          </article>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
