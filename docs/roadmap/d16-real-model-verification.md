# D-16 실모델 검증 (Preview) — 준비 상태

## 환경 (2026-10-22 KST)
- Vercel Preview 배포: 스택 최상단 브랜치들이 READY (git push 시 자동 생성). Preview DB 라우팅은 `JURY_PREVIEW_DB*` env(Preview 전용).
- Preview Supabase(aisles-jury-preview): RM-01 마이그레이션 적용 완료(`_prisma_migrations` 48행, 기존 요청 6건 UNKNOWN_LEGACY, 새 테이블 RLS on). Supabase 쪽 이력(`supabase_migrations`)에도 1행 기록됨.
- Gemini 키: `GOOGLE_GENERATIVE_AI_API_KEY`가 Preview 대상에 존재(Production과 같은 변수 → 같은 Google 계정 과금). 값은 확인·출력하지 않음.
- Preview에는 `JURY_LLM_*` 한도가 없음(이번 승인은 Production만) → 실행 전 Preview에도 같은 값 설정 권장(별도 승인).

## 호출 수와 상한 — 중요
- 리뷰 1회 = LLM 32회 (`EXPECTED_PIPELINE_LLM_CALLS`, 실행당 상한 기본 40).
- 승인 상한 ~50회로는 **리뷰 1회만** 가능 → 3~5건 고정 입력·추세(3점 이상)·이전 비교 검증 불가.
- 필요량: 고정 입력 3건 = 96회, 5건 = 160회, + 재리뷰 1회 비교 = +32. 추정비용 $0.015/회 기준 3건 ≈ $1.4, 5건+재리뷰 ≈ $2.9.
- 권고: 상한을 **100회(3건)** 또는 **200회(5건+재리뷰)**로 재승인. 실행 중 `JuryLlmCallLog` 누계로 상한 감시, 초과 직전 중단.

## 고정 입력 (합성, PII 없음, 같은 연결·같은 지표 구성)
| # | 주장(claim) | 지표(기간 2026-09-01~30, Asia/Seoul) | 기대 확인점 |
|---|---|---|---|
| F1 | 9월 가입 전환율이 8월 대비 개선됐다 | signup_conversion 4.1% (8월 3.2%), sessions 12,400 | 근거 충분 → ACCEPT/VERIFY 계열 |
| F2 | 신규 온보딩으로 이탈이 절반으로 줄었다 | churn_30d 11% (8월 13%) | 과장 탐지(overclaim) → REWORD |
| F3 | 결제 오류가 사라졌다 | payment_error_rate 미수집(NOT_MEASURED) | 근거 부족/보류 표시 |
| F4 | 재방문율이 유지됐다 | d7_retention 22% (8월 22%), sessions 12,400 | 중립 |
| F5 | F1과 동일 입력(재현성) | F1과 동일 | F1과 판정 일치 여부, 이전 대비 비교(M-011) |

## 실행 순서 (상한 재승인 후)
1. Preview 배포 URL에서 테스트 조직/연결 생성 → F1~F5 순서로 증거 입력·리뷰 실행.
2. 각 결과: resultSource=REAL_MODEL, JuryReviewAttempt COMPLETED, JuryLlmCallLog 32행 확인.
3. 검수 후 VERIFIED_REAL 지정(수동, D-16 원칙) → M-013 추세(3점), M-011 비교, UI-05 체크리스트, O-지표 실값 확인.
