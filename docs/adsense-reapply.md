# AdSense 재심사 준비

애드센스 품질·콘텐츠 정책 대응을 위해 적용한 변경과 운영 방법입니다.

## 1. AI FORTUNE 주차 백필

### 구간

- **시작**: `2026-04-W1` (2026년 4월 1주차, KST)
- **끝**: `2026-05-W2` (2026년 5월 2주차)
- 주차 키·표시 규칙: `src/lib/ai-fortune/kst-week.ts` (`aiFortuneWeekKey`, `listAiFortuneWeekKeysInRange`)

### 동작

- 각 주차별로 DB에 `aiFortuneWeekKey`가 없을 때만 Gemini로 주간 리포트 생성 (크론과 동일 파이프라인)
- `createdAt`은 4월 1주차가 가장 이르고, 5월 2주차가 가장 늦게 설정되어 **최근 주차가 목록 상단**에 오도록 함 (`aiFortuneWeekKey` desc + `createdAt` desc)

### 로컬·프로덕션 실행 (권장)

```bash
# 저장소 루트, .env에 DATABASE_URL·GEMINI 키·작성자 계정 필요
npx tsx scripts/backfill-ai-fortune.ts
```

필수 환경 변수 예:

- `DATABASE_URL` (또는 `DIRECT_URL`)
- `GOOGLE_GENERATIVE_AI_API_KEY` 또는 `GEMINI_API_KEY`
- `AI_FORTUNE_AUTHOR_USERNAME` (없으면 `HACKERNEWS_AUTHOR_USERNAME` 등 폴백)

주차당 Gemini 호출이 있어 **수 분~十여 분** 걸릴 수 있습니다. CI에서는 실행하지 않습니다.

### API (대안)

```bash
curl -X POST "https://<your-host>/api/cron/ai-fortune?backfill=true" \
  -H "Authorization: Bearer $CRON_SECRET"
```

- `CRON_SECRET`과 `Authorization: Bearer` 일치 필요
- Vercel `maxDuration`(120초) 때문에 **전체 백필은 스크립트 권장**

## 2. AI_FORTUNE 복도 SEO 소개

- URL: `/?category=AI_FORTUNE`
- 피드 목록 **위**에 2~3단락 한국어 소개 (`AiFortuneCategoryIntro`, SSR)
- 메타 설명: `src/app/(root)/page.tsx`의 `AI_FORTUNE_SEO_DESCRIPTION`

## 3. LOUNGE 자동 수집 본문 최소 길이

- 상수: `MIN_LOUNGE_BODY_CHARS = 400` (`src/lib/lounge-ingestion-policy.ts`)
- HTML 태그 제거·공백 정규화 후 순수 텍스트 길이가 400자 미만이면 **게시하지 않음** (로그 `[lounge-ingestion] 본문 길이 부족 — 게시 스킵`)
- 적용: Hacker News, GeekNews, MIT News, The Verge, Techmeme, Lobsters, AI Breakfast, YouTube(LOUNGE 채널) 등 **크론 자동 수집만**
- 사용자 수동 업로드(`/api/posts`, 업로드 폼)에는 적용하지 않음

## 4. BUILD·LAUNCH 메뉴 숨김 (AdSense 심사용)

심사 기간 동안 **메인 네비·홈 복도 탭·Today's Best 필터**에서 BUILD·LAUNCH만 숨깁니다. URL·업로드·관리자·게시글 본문은 그대로입니다.

### 환경 변수

| 값 | 동작 |
|---|---|
| unset / `false` | BUILD·LAUNCH 메뉴 **표시** (기본) |
| `true` | BUILD·LAUNCH 메뉴 **숨김** |

```bash
NEXT_PUBLIC_HIDE_BUILD_LAUNCH_MENU=true
```

- **Vercel**: Project → Settings → Environment Variables → Production(및 Preview)에 추가 후 **재배포**
- **로컬**: `.env.local`에 동일 키 설정 후 `npm run dev` 재시작
- 구현: `src/lib/hide-build-launch-menu.ts` — `MainNav`, `HomeContentTabs`, `TodaysBest`에서만 필터

### 심사 후 다시 표시

1. Vercel에서 `NEXT_PUBLIC_HIDE_BUILD_LAUNCH_MENU` 삭제 또는 `false`로 변경
2. 재배포

### 숨겨도 접근 가능한 것

- 직접 URL: `/?category=BUILD`, `/?category=LAUNCH`, `/post/{id}`
- 업로드 폼 카테고리 선택 (BUILD·LAUNCH 포함)
- 관리자: `/admin/launch-banners` (LAUNCH 배너)
- 검색·피드·사이트맵·게시글 내 복도 배지

## 검증

```bash
npx tsc --noEmit
npm run build
```
