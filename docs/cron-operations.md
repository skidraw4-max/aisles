# Cron 운영 가이드

AIsle의 주기 작업은 **GitHub Actions**가 프로덕션 `/api/cron/*` 를 `Authorization: Bearer <CRON_SECRET>` 으로 호출하는 구조입니다. Vercel Cron(`vercel.json`)은 비어 있으며, 외부 스케줄러만 사용합니다.

## GitHub Actions 워크플로

| 워크플로 파일 | 용도 | KST 스케줄 | UTC cron |
|---------------|------|------------|----------|
| `.github/workflows/ai-fortune-weekly-kst.yml` | AI FORTUNE 주간 게시 | **매주 월 05:00** | `0 20 * * 0` (일 20:00) |
| `.github/workflows/news-digest-kst.yml` | LOUNGE 뉴스 다이제스트 메일 | **매일 06:00** (`slot=0`), **18:00** (`slot=1`) | `0 21 * * *`, `0 9 * * *` |
| `.github/workflows/external-cron-news-chain.yml` | 뉴스 수집 체인 (8소스 + YouTube) | **3시간마다** 정각 시작 | `0 */3 * * *` |

### 실패 알림

각 워크플로 마지막에 `if: failure()` 단계가 있습니다. 리포지토리 Secret **`CRON_ALERT_WEBHOOK_URL`**(Slack/Discord 등 Incoming Webhook)이 있으면 JSON `{"text":"..."}` 를 POST합니다. 없으면 Actions 로그에만 남깁니다.

## API 엔드포인트 (`/api/cron/*`)

모두 `GET` 또는 `POST`, 헤더 `Authorization: Bearer <CRON_SECRET>` 필수.

| 경로 | 비고 |
|------|------|
| `/api/cron/ai-fortune` | `?bootstrap=true` 배포 직후 1회, `?force=true` 강제 재생성 |
| `/api/cron/news-digest` | `?slot=0\|1` (KST 윈도우) |
| `/api/cron/geeknews` | `?force=true` 선택 |
| `/api/cron/hackernews` | 동일 |
| `/api/cron/lobsters` | 동일 |
| `/api/cron/techmeme` | 동일 |
| `/api/cron/verge` | 동일 |
| `/api/cron/aibreakfast` | 동일 |
| `/api/cron/mit-news` | 동일 |
| `/api/cron/youtube-sync` | 동일 |
| `/api/cron/daily-news-bundled` | 번들(수동·복구용) |
| `/api/cron/health` | 인증 없음 — `{ ok: true, jobs: [...] }` 정적 상태 |

**Rate limit:** `/api/cron/*` 는 IP당 분당 10회(미들웨어, in-memory). 정상 스케줄러는 한도 내입니다.

## 필수 환경 변수

### Vercel(프로덕션)

| 변수 | 용도 |
|------|------|
| `CRON_SECRET` | 모든 cron 라우트 Bearer 인증 |
| `GOOGLE_GENERATIVE_AI_API_KEY` 또는 `GEMINI_API_KEY` | 수집·AI FORTUNE·요약 |
| `DATABASE_URL` / `DIRECT_URL` | Prisma (마이그레이션은 DIRECT_URL) |
| `RESEND_API_KEY`, `EMAIL_FROM` | news-digest 메일 |
| `AI_FORTUNE_AUTHOR_USERNAME` | (선택) FORTUNE 작성자, 없으면 HN/GeekNews/Nedai |
| `HACKERNEWS_AUTHOR_USERNAME`, `GEEKNEWS_AUTHOR_USERNAME` | (선택) 크론 게시 작성자 |

### GitHub Actions Secrets

| Secret | 용도 |
|--------|------|
| `CRON_SITE_URL` | 예: `https://www.aisleshub.com` (끝 슬래시 없음) |
| `CRON_SECRET` | Vercel과 동일 |
| `CRON_ALERT_WEBHOOK_URL` | (선택) 실패 시 Webhook |

## 수동 부트스트랩·복구 (curl)

`<BASE>` = 프로덕션 오리진, `<SECRET>` = `CRON_SECRET` (실값은 터미널·CI에만 넣고 문서에 기록하지 않음).

```bash
# 헬스체크 (인증 불필요)
curl -sS "<BASE>/api/cron/health"

# AI FORTUNE — 배포 직후 이번 주 1회
curl -sS -X POST "<BASE>/api/cron/ai-fortune?bootstrap=true" \
  -H "Authorization: Bearer <SECRET>" \
  -H "Content-Type: application/json"

# AI FORTUNE — 강제 재생성
curl -sS -X POST "<BASE>/api/cron/ai-fortune?force=true" \
  -H "Authorization: Bearer <SECRET>"

# 뉴스 다이제스트 — 아침/저녁 슬롯
curl -sS -X POST "<BASE>/api/cron/news-digest?slot=0" \
  -H "Authorization: Bearer <SECRET>"
curl -sS -X POST "<BASE>/api/cron/news-digest?slot=1" \
  -H "Authorization: Bearer <SECRET>"

# 단일 소스 재수집
curl -sS -X POST "<BASE>/api/cron/geeknews?force=true" \
  -H "Authorization: Bearer <SECRET>"
```

HTTP `200` + JSON `ok: true` 를 확인합니다. `401` 이면 `CRON_SECRET` 불일치, `500` 이면 Vercel 로그에서 `step` 필드를 확인합니다.

## 멱등성·메트릭 (운영 관점)

| 작업 | 멱등 키 | 기대 동작 |
|------|---------|-----------|
| AI FORTUNE | `aiFortuneWeekKey` (주차) | 동일 주 재호출 → `skipped_exists` |
| GeekNews/HN/… | `*OriginalUrl` 고유 필드 | 동일 URL 스킵 |
| news-digest | 슬롯·날짜·수신자 | Resend 중복 발송은 로그로 추적 |

**주간 점검:** GitHub Actions 실행 이력(성공/실패), Vercel 로그의 `[cron/*]`·`[ai-fortune]`, GSC 색인(→ `docs/performance-seo.md`).

## CRON_SECRET 로테이션 체크리스트

1. Vercel 프로덕션에 새 `CRON_SECRET` 생성·저장.
2. GitHub Actions Secrets `CRON_SECRET` 동일 값으로 갱신.
3. (선택) `CRON_ALERT_WEBHOOK_URL` 유효성 테스트 — 워크플로를 `workflow_dispatch`로 일부러 실패시키지 말고, 수동 curl로 401 한 번 보낸 뒤 알림 파이프 확인.
4. 이전 시크릿을 쓰는 외부 cron-job.org 등이 있으면 제거 또는 갱신.
5. `curl` 로 `geeknews` 또는 `health`+인증 라우트 한 번 호출해 `200` 확인.
6. 다음 스케줄 슬롯(다이제스트·수집 체인) Actions 녹색 확인.

자세한 외부 스케줄러 예시는 [`external-scheduler-cron.md`](./external-scheduler-cron.md) 를 참고하세요.
