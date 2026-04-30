# 외부 스케줄러로 기사 수집 API 호출하기

**한 줄 요약:** 배포된 사이트의 `/api/cron/*` 에 `Authorization: Bearer <CRON_SECRET>` 과 함께 요청하면, 공지 관리의 수동 동기화와 동일한 서버 로직으로 수집이 실행된다. 외부 스케줄러(GitHub Actions, cron-job.org 등)가 주기적으로 이 URL을 호출하면 Vercel Cron 없이도 주기 수집을 유지할 수 있다.

## 전제 조건

| 항목 | 설명 |
|------|------|
| 환경 변수 | 프로덕션(Vercel 등)에 **`CRON_SECRET`** 이 설정되어 있어야 한다. 비어 있으면 라우트가 401로 거부한다. |
| Gemini 등 | 수집 로직에 필요한 `GOOGLE_GENERATIVE_AI_KEY` / `GEMINI_API_KEY`, 작성자 계정 등은 기존과 동일하다. |
| URL | 프로덕션 베이스 URL (예: `https://www.aisleshub.com`). 프리뷰 URL은 DB·키가 다를 수 있어 운영용으로는 비권장. |

## 중복 실행 주의

- **`vercel.json` 의 Cron** 과 **외부 스케줄러**를 동시에 쓰면 같은 작업이 두 번 돌 수 있다.
- 외부 스케줄러만 쓸 경우: Vercel 대시보드에서 Cron 비활성화 또는 `vercel.json` 의 `crons` 제거 후 재배포를 검토한다.

## 엔드포인트 (현재 저장소 기준)

모두 **`GET` 또는 `POST`** 동일. 인증: **`Authorization: Bearer <CRON_SECRET>`**

| 순서 | 경로 | 비고 |
|------|------|------|
| 1 | `/api/cron/geeknews` | `?force=true` 선택 |
| 2 | `/api/cron/hackernews` | 동일 |
| 3 | `/api/cron/verge` | 동일 |
| 4 | `/api/cron/aibreakfast` | 동일 |
| 5 | `/api/cron/mit-news` | 동일 |
| 6 | `/api/cron/youtube-sync` | 동일 |

강제 재수집 시 URL 예: `https://www.aisleshub.com/api/cron/geeknews?force=true`

---

## 예시: curl

`<BASE>` = 프로덕션 오리진, `<SECRET>` = `CRON_SECRET` 값.

```bash
curl -sS -X POST "<BASE>/api/cron/geeknews" \
  -H "Authorization: Bearer <SECRET>" \
  -H "Content-Type: application/json"
```

한 줄로 각각:

```bash
curl -sS -X POST "https://www.aisleshub.com/api/cron/geeknews" -H "Authorization: Bearer $CRON_SECRET"
curl -sS -X POST "https://www.aisleshub.com/api/cron/hackernews" -H "Authorization: Bearer $CRON_SECRET"
curl -sS -X POST "https://www.aisleshub.com/api/cron/verge" -H "Authorization: Bearer $CRON_SECRET"
curl -sS -X POST "https://www.aisleshub.com/api/cron/aibreakfast" -H "Authorization: Bearer $CRON_SECRET"
curl -sS -X POST "https://www.aisleshub.com/api/cron/mit-news" -H "Authorization: Bearer $CRON_SECRET"
curl -sS -X POST "https://www.aisleshub.com/api/cron/youtube-sync" -H "Authorization: Bearer $CRON_SECRET"
```

로컬에서 시크릿 확인 후 테스트:

```bash
export CRON_SECRET='......'
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "https://www.aisleshub.com/api/cron/geeknews" \
  -H "Authorization: Bearer $CRON_SECRET"
```

`200` 이면 호출 성공(본문 JSON으로 created 등 확인 가능).

---

## 예시: GitHub Actions

저장소에 `.github/workflows/external-cron-news-chain.yml` 을 두고, 리포지토리 **Secrets** 에 다음을 등록한다.

| Secret 이름 | 값 |
|-------------|-----|
| `CRON_SITE_URL` | `https://www.aisleshub.com` (끝에 슬래시 없음) |
| `CRON_SECRET` | Vercel 프로덕션과 동일한 `CRON_SECRET` |

워크플로 파일 내용은 해당 YAML 파일을 참고한다. UTC 기준 3시간마다 첫 작업 시점에 맞춰 6개 엔드포인트를 10분 간격으로 순차 호출한다.

---

## 적용 방법 (순서)

1. **Vercel(또는 호스팅) 환경 변수**에 `CRON_SECRET` 이 프로덕션에 설정돼 있는지 확인한다.
2. **외부 스케줄러만 사용할지 결정**한다. 그렇다면 `vercel.json` 크론을 제거하거나 Vercel Cron을 끄고 중복을 피한다.
3. **GitHub Actions** 를 쓸 경우: 저장소 **Settings → Secrets and variables → Actions** 에 `CRON_SITE_URL`, `CRON_SECRET` 추가 후 워크플로 파일을 커밋·푸시한다.
4. **Actions 탭**에서 해당 워크플로를 수동 실행(workflow_dispatch)해 한 번 테스트한다.
5. **스케줄 실행 후** Vercel 로그 또는 응답 JSON으로 `created` 등을 확인한다.

기타 서비스(cron-job.org 등)는 **HTTPS**, **POST**, **헤더 `Authorization: Bearer …`** 만 동일하게 맞추면 된다.
