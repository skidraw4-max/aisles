# GEO (Generative Engine Optimization)

AIsle 콘텐츠가 Perplexity·ChatGPT Browse·Google AI Overviews 등 **생성형 검색·답변 엔진**에 인용되기 쉽도록 한 설정 요약입니다.

## JSON-LD (`/post/[id]`)

구현: `src/lib/post-json-ld.ts` → `src/app/(root)/post/[id]/page.tsx`

| 복도 | Schema.org `@type` | `author` |
|------|-------------------|----------|
| LOUNGE, GOSSIP, TREND | `NewsArticle` | AI Agent |
| BUILD, LAUNCH, RECIPE | `TechArticle` | 게시 작성자 username |
| AI_FORTUNE | `TechArticle` | AI Agent |
| GALLERY | `Article` | 게시 작성자 username |

공통 필드: `headline`, `description`(AI 요약·메타), `datePublished`, `publisher`, `mainEntityOfPage`, `inLanguage: ko-KR`.

- **원문 연결:** 자동 수집 글은 `isBasedOn` → `{ @type: WebPage, url }` ( `mitNewsOriginalUrl`, `geeknewsOriginalUrl`, `hackerNewsOriginalUrl` 등 Post 필드 우선순위는 상세 페이지 CTA와 동일).
- **AI FORTUNE:** `description`에 `trendBullets` 상위 3개, `about`에 트렌드 키워드.

Rich Results 테스트: BUILD·LOUNGE·AI FORTUNE 샘플 URL 각 1건.

## Gemini 프롬프트 (사실 중심)

공통 제약: `src/lib/geo-prompt-constraints.ts`

| 크론·모듈 | 파일 |
|-----------|------|
| GeekNews | `src/lib/geeknews/summarize.ts` |
| Hacker News | `src/lib/hackernews/summarize.ts` |
| Lobsters | `src/lib/lobsters/summarize-lobsters-article.ts` |
| Techmeme | `src/lib/techmeme/summarize-techmeme-article.ts` |
| MIT News | `src/lib/mit-news/summarize-mit-article.ts` |
| The Verge | `src/lib/verge/summarize-verge.ts` |
| AI Breakfast | `src/lib/aibreakfast/summarize-aibreakfast.ts` |
| AI FORTUNE | `src/lib/ai-fortune/generate-weekly-fortune.ts` |

제약 요지: 추상 수식 배제, **고유명사·제품명·수치·날짜** 필수, 객관적 톤. 뉴스 계열은 상단 요약 필드를 **3줄**로.

> **news-digest** (`src/app/api/cron/news-digest/route.ts`)는 기존 LOUNGE 글을 메일로 묶는 역할만 하며 Gemini 요약 프롬프트는 없습니다.

## robots.txt (`src/app/robots.ts`)

- 일반 크롤러(`*`): `/` 허용, `/api/`, `/admin/` 등 비공개 경로 disallow 유지.
- AI 크롤러 **명시 Allow**: `GPTBot`, `ChatGPT-User`, `PerplexityBot`, `Google-Extended`, `ClaudeBot`, `anthropic-ai`, `Applebot-Extended` — `/`, `/post/`.

### `/oracle/` vs AI FORTUNE

코드베이스에 **`/oracle/` 라우트는 없습니다.** AI FORTUNE은 다음으로 노출됩니다.

- 개별 리포트: `/post/{id}` (sitemap·JSON-LD·robots `/post/` Allow)
- 아카이브·소개: `/?category=AI_FORTUNE` (홈 SSR, `AI_FORTUNE_SEO_*` 메타)

**robots.txt 한계:** 표준 robots 규칙은 **경로(path)만** 매칭하며 쿼리(`?category=AI_FORTUNE`)는 구분하지 않습니다. `Allow: /`로 홈 전체가 허용되므로 카테고리 피드도 크롤 가능합니다. 쿼리별 Allow는 불가 — Search Console URL 검사로 색인을 확인하세요.

## 관련 문서

- [performance-seo.md](./performance-seo.md) — GSC 체크리스트
- [adsense-reapply.md](./adsense-reapply.md) — AI_FORTUNE SEO 소개
