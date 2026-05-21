# UGC Hub — BUILD · LAUNCH

AIsle의 사용자 생성 콘텐츠(UGC) 허브 정책과 운영 가이드입니다.

## 복도 정의

| 복도 | Prisma | 목적 |
|------|--------|------|
| **BUILD** (제작기) | `BUILD` | AI 워크플로·레시피·빌드 노하우 공유 |
| **LAUNCH** (출시) | `LAUNCH` | 서비스·프로덕트 런치 홍보 |

`AI_FORTUNE`은 크론 전용이며 업로드 UI에서 제외됩니다.

## LAUNCH 메인 배너

### 노출 조건

- `Post.featuredOnHome = true`
- `Post.launchBannerUntil` 이 null 이거나 **현재 시각 이후**
- 카테고리 `LAUNCH`
- 메인 홈(`/?category` 없음) 슬라이더 **최대 3슬롯**

후보가 없으면 LAUNCH 제목만 보이고 슬라이더는 렌더되지 않습니다. `/admin/launch-banners`에서 `featuredOnHome`을 켜 주세요.

### 관리

- 경로: `/admin/launch-banners` (ADMIN)
- 후보 자동 목록: LAUNCH + 본문 최소 길이 + 썸네일 있음 → 검토 리스트
- 만료일 지정 시 자동 하차

### 메트릭 (GA4)

- `launch_banner_impression` — 슬라이더 노출
- `launch_banner_click` — 슬라이드 CTA 클릭

## BUILD 허브 랜딩 (`/?category=BUILD`)

- **이번 주 인기 레시피**: 최근 7일, `likeCount` 상위 5건
- CTA **레시피 등록하기** → `/upload` (로그인 필요)
- `metadata.params` 의 `tool` / `buildTool` / `tools` 로 태그·도구 필터(클라이언트)

### 메트릭

- `build_hub_cta_upload` — 등록 CTA
- `build_popular_click` — 인기 레시피 카드 클릭

## 업로드 UX

### LAUNCH 체크리스트 (안내)

- 서비스 스크린샷(썸네일)
- 데모·배포 URL (`externalLink` 또는 본문 링크)
- 한 줄 피치(제목·설명)

제출 후: *「메인 배너는 운영팀 검토 후 노출됩니다.」*

### BUILD 체크리스트

- 사용 도구·모델
- 워크플로 요약
- 결과물·스크린샷

제출 후: *「이번 주 인기 레시피 후보로 집계됩니다.」*

## 주간 베스트

- BUILD/LAUNCH 복도 필터 페이지 상단: 최근 7일 `likeCount` 상위
- 사이드바 `TodaysBest` 는 댓글·조회 가중(기존)과 별도

## 작성자 표시

| 복도 | 피드·목록 작성자 |
|------|------------------|
| BUILD, LAUNCH, GALLERY | 표시 |
| LOUNGE, AI_FORTUNE | 숨김 (`post-categories.ts`) |

## My Aisles

- BUILD/LAUNCH 전용 섹션: 조회수, LAUNCH 배너 상태(노출 중 / 검토 중 / —)

## 검색

- `/search?q=…&corridor=BUILD|LAUNCH` 복도 필터 지원

## 다이제스트 에디터 픽

`news-digest` 크론: 여유 슬롯 1건에 BUILD/LAUNCH 최신 글 후보(기존 로직). 본 허브와 별도로 메일 UTM·`fortune_week` 등은 `docs/ga4-events.md` 참고.

## 운영 · 모더레이션

- 배너 해제: 관리자가 `featuredOnHome` 끄기
- 신고 API: 미구현(추후). 긴급 시 DB 또는 관리 화면에서 unfeature

## Launch package playbook (운영)

1. **D-7**: LAUNCH 글 초안 + 썸네일·URL 확보
2. **D-3**: 관리자 후보 목록 검토 → `featuredOnHome` + 만료일(런치 주 종료)
3. **D-day**: 메인 배너·다이제스트 슬롯 동시 노출
4. **D+7**: 만료 자동 하차, 주간 베스트 아카이브 링크

## JSON-LD

BUILD/LAUNCH 상세 페이지에 `Article` 스키마(제목·설명·날짜·이미지) 삽입.

## 지표 대시보드 (권장)

| KPI | 소스 |
|-----|------|
| 배너 CTR | GA4 `launch_banner_click` / `impression` |
| BUILD 업로드 전환 | `build_hub_cta_upload` |
| 주간 인기 참여 | `build_popular_click`, DB `likeCount` |
