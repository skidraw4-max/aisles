# 성능·SEO 기준선

## 성능 목표 (Vercel Speed Insights·Lighthouse)

| 지표 | 목표 | 비고 |
|------|------|------|
| LCP (모바일) | &lt; 2.5s | 홈 히어로·피드 첫 카드 `next/image` + `sizes` |
| INP | &lt; 200ms | 클라이언트 피드 무한 스크롤은 교차 관찰 지연 로드 |
| CLS | &lt; 0.1 | 썸네일 aspect-ratio·placeholder 유지 |
| TTFB (캐시 히트) | &lt; 600ms | 홈 `revalidate=60`, 사이트맵 `3600` |

**Speed Insights:** 루트 `src/app/layout.tsx` 에 `@vercel/speed-insights` 가 포함되어 있습니다. Vercel 프로젝트 대시보드 → Speed Insights 탭에서 실측을 확인합니다.

### ISR·캐시

| 라우트 | `revalidate` |
|--------|----------------|
| `/` (홈) | 60s |
| `/sitemap.xml` | 3600s |
| `/post/[id]` | `force-dynamic` (좋아요·북마크·조회수 개인화) |
| `/api/feed` | `s-maxage=60`, `stale-while-revalidate=120` |

### 접근성·모션

- AI FORTUNE 리포트(`ai-fortune-report.module.css`): `prefers-reduced-motion: reduce` 시 스캔·펄스 애니메이션 비활성화.

## SEO — Google Search Console 주간 체크리스트

- [ ] **색인** → 페이지: 신규 `/post/*`·`/?category=` 주요 URL이 “색인 생성됨”인지
- [ ] **Sitemap:** `https://<도메인>/sitemap.xml` 제출 상태·마지막 읽기 날짜
- [ ] **AI_FORTUNE / BUILD / LAUNCH:** 최근 글·`featuredOnHome` LAUNCH가 사이트맵·검색에 노출되는지 샘플 URL 3건 검사
- [ ] **robots.txt:** `/api/`, `/admin/` 등 disallow 유지 확인
- [ ] **Canonical:** 카테고리 홈 `/?category=LAB` 등 `alternates.canonical` 일치
- [ ] **구조화 데이터:** Rich Results 테스트로 Article(JSON-LD) — BUILD·LAUNCH·LOUNGE
- [ ] **Core Web Vitals:** 모바일 URL 그룹 “좋음” 비율

크론·비밀 운영은 [`cron-operations.md`](./cron-operations.md) 를 함께 봅니다.
