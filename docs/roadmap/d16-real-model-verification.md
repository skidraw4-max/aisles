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

## 판정 기준 E-1..E-5 (t434 정의, t435 기록)
| ID | 무엇을 | 통과 조건 | 확인 방법 |
|---|---|---|---|
| E-1 | 실모델 출처 | `resultSource=REAL_MODEL`, 모든 호출 model ID 기록(예: `gemini-2.5-flash-lite`), contract `v9.x-ev020` | DB 읽기 (`JuryReviewRequest`, `JuryLlmCallLog.model`, `JuryReviewResult.contractVersion`) |
| E-2 | 호출 완결성 | `JuryLlmCallLog` 32행 OK, seq 0–31 연속, `boardRunId` 일치, attempt COMPLETED | DB 읽기 |
| E-3 | 공급자 측 실호출 대조 | 콘솔 사용량(모델별 요청 수)이 실행 시간대 DB 호출 수와 일치 | Google AI Studio 또는 Cloud console 사용량, 모델별, UTC 범위 지정 (수동) |
| E-4 | 스키마 | `schemaValid=true`, `finalSurface` 필드 타입, decision/strength enum 범위 | DB 읽기 + 로컬 검증 스크립트 |
| E-5 | 표시 계약 | `buildReviewDisplayModel` CT 위반 0건 (정보성 flag는 위반 아님) | 로컬 검증 |

### VERIFIED_REAL 규칙
- VERIFIED_REAL 지정은 E-1..E-5 **모두** 확인 후에만.
- **F1–F3(t434 실행분)은 E-3 콘솔 대조가 끝나기 전까지 VERIFIED_REAL 지정 금지.** 대조 범위: 모델 `gemini-2.5-flash-lite`, UTC 2026-10-22 14:25–15:12, 기대 요청 수 111.
- C1–C5도 동일: 실행 후 해당 시간대 E-3 대조 완료 전 지정 금지.

### 증거 기록 템플릿 (E-1..E-5, 케이스마다 1장)
| 항목 | 값 | 근거 표시 |
|---|---|---|
| 케이스 / requestId / attemptId / resultId | | [DB 확인] |
| E-1 resultSource · model ID · contractVersion | | [DB 확인] |
| E-2 호출 수(OK/ERROR) · seq 범위 · boardRunId · attempt 상태 | | [DB 확인] |
| E-3 콘솔 요청 수(모델별, UTC 범위) vs DB 호출 수 | | [실제 확인] / [확인 불가] |
| E-4 schemaValid · enum 범위 | | [DB 확인] |
| E-5 CT 위반 수 | | [실제 확인] |
| 시각(UTC 시작–종료, KST 병기) | | |
| 누적 호출 수(실행 후) / 남은 상한 | | [DB 확인] |

## C1–C5 실행 계획 (t436 확정안, 실행은 JD 재승인 후)
공통: 리뷰 유형 `CLAIM_VALIDATION`(RM-21, I-026 필요), Preview, 연결 aisleshub.com, 기간 2026-10-14 ~ 2026-10-20(Asia/Seoul, 7일), 연결에서 수집한 실제 지표(값은 수집 시점 값을 템플릿에 기록, 아래 값은 계획 시 예상치).

| # | 입력 지표(availability / 값) | 주장 텍스트(claim) | 기대 결과 | 성공 기준 | 실패 기준 |
|---|---|---|---|---|---|
| C1 | userCount AVAILABLE / 예상 ≈410 | 누적 가입자가 400명을 넘었다 | 근거가 주장을 직접 지지 → ACCEPT/VERIFY 계열, claimStrength 확정 표시 가능 | E-1..E-5 통과 + 판정이 지표 값과 모순 없음(값 < 400이면 반대 판정이 정답) | 32회 미완, schema 위반, 값과 모순되는 판정 |
| C2 | userCount AVAILABLE (비교 기준 없음) | 가입자가 두 배로 늘었다 | 비교 기준 부재 → overclaim/근거 부족 지적, REWORD 또는 보류 계열 | overclaim 또는 근거 부족이 결과에 명시 | "두 배" 주장을 지지한다고 판정 |
| C3 | commentCount PERMISSION_DENIED (값 없음) | 댓글 활동이 활발하다 | 미수집 지표 → 근거 부족/보류, 측정값 투영 없음 | 결과에 측정값 없음·보류 표시 | 없는 값을 측정된 것처럼 서술(ISSUE-B, I-027 재현 시 기록) |
| C4 | postCount AVAILABLE / 수집 값 | 게시글 수가 집계되고 있다 | 단순 확인 → 지지 | 지지 판정, 값 일치 | 지지 못함 또는 값 불일치 |
| C5 | C1과 같은 지표 구성, **새 evidence** | C1과 동일 문자열 | C1과 같은 판정 계열(재현성) | decision 계열 일치, 차이 시 사유 기록 | 새 attempt가 생성되지 않음(재사용) 또는 판정 반대 |

### C5 재현성: 요청 키 재사용 회피
- 요청 키 = sha(tenantId, evidenceId, reviewType, claim) [코드 확인: `tenantReviewRequestKey`]. 같은 evidence+유형+주장이면 기존 결과를 재사용하고 LLM 호출 0회 → 재현성 검증이 안 됨.
- 주장 앞뒤 공백 변형은 서버에서 trim되므로 키가 바뀌지 않는다(사용 금지).
- evidence는 (연결, 목적, 기간, 시간대, contentHash)로 중복 제거된다 [코드 확인: `evidence-store.findByIdentity`]. 따라서 C5는 **기간을 하루 이동(2026-10-15 ~ 2026-10-21)** 해 새로 수집 → 새 evidenceId → 새 요청 키.
- 실행 전 확인: C5 evidenceId ≠ C1 evidenceId, C5 요청이 새 attempt를 생성(호출 32회). 지표 값이 달라지면 값 차이를 템플릿에 기록하고 판정 비교에 반영.

호출: 5×32 = 160회(≈$2.40). 실패 1회 여유 포함 192회(≈$2.88). 단가 추정 $0.015/회.

## 상한 303회(추가분)와 중단 규칙
- t436 확정: 303회는 **기존 111회 위 추가분**. 총 누계 상한 414회. 최대 비용 ≈ $4.545.
- 필요한 만큼만 사용(계획 160회). 목표(C1–C5 판정 확보) 달성 시 즉시 중단, 남은 상한은 쓰지 않는다.
- 자동 재시도 없음. 실패 시 중단·보고 후 JD 판단.
- 실행 중 `JuryLlmCallLog` 누계 감시, 다음 리뷰(32회)가 누계 414를 넘으면 시작하지 않음.
- 실패 실행 과금 여부: 확인 불가(E-3 콘솔 대조로만 확인 가능).

## 관련 이슈 (D-16 추적성)
- I-024 / RM-20: 주장 입력이 없을 때 주장 강도를 확정 표시하지 않음(1단계: 표시 계층만, '주장 입력 없음').
- I-026 / RM-21: 증거 카드 '리뷰 요청하기'에 리뷰 유형·주장 입력(C1–C5 선행 조건).
- I-027 / RM-19: 미수집 지표의 measured 값 투영(ISSUE-B) — 보류. t434/t435에서 임시로 I-025로 적었으나 `I-025`는 `docs/decisions/D-08-rereview-result-table.md`에서 이미 "JuryReReviewResult 0건"의 의미로 사용 중이라 I-027로 재지정(t436). 기존 I-025의 의미는 바꾸지 않는다.
- I-033 (UI, t452u): `/jury/evidence` 모바일(390–410px) 가로 넘침. 원인 [실제 확인, 로컬 하네스]: 카드의 「기술 정보 자세히 보기」(`.technicalDetails`)를 펼치면 `.row`(flex) 안의 64자 evidence id가 줄바꿈되지 않고 min-content 폭(약 580px)을 유지해 문서 scrollWidth가 639px가 됨. 수정: `.technicalDetails .row`의 값 칸만 `min-width:0; overflow-wrap:anywhere`, 라벨은 `flex-shrink:0`(jury.module.css). 1280px 화면은 수정 전후 픽셀 동일. 접힌 상태의 Preview 가로 스크롤·우측 플로팅 버튼(Vercel 툴바로 추정) 근처 'DATABASE' 라벨은 로컬에서 재현되지 않음 — Preview 재확인 필요. 관련: I-029/I-030/I-031 통합 브랜치(integration/ux-i029-i031). 후속(t453u): Preview DevTools 측정(390·410에서 scrollWidth 608)의 원인은 리뷰 자료 입력 폼의 `<p class=muted>선택한 서비스: {표시명} / {scope id}`(`ui.tsx` EvidenceBody, 끊김 없는 긴 id). 수정: 해당 줄에만 `.selectedService { min-width:0; overflow-wrap:anywhere }` 추가(전역 `.muted` 미변경, 부모 form은 block이라 추가 수정 불필요). [실제 확인, 로컬 하네스·긴 scope id]: 390/410에서 scrollWidth 469→390/410(details 접힘·펼침 모두), 768·1280 화면은 수정 전후 픽셀 동일. Preview 재측정은 [확인 불가].
- I-034 (UI, I-030 후속): 리뷰 요청 버튼(`ReviewSubmitButton`)의 처리 중 상태가 약 8ms 만에 풀려 버튼이 다시 활성화됨(중복 유료 실행 위험). 원인 [실제 확인, 로컬 하네스, React 19.2.4 / Next 15.5.14]: 폼 액션 실행 중 경과 시간 등 일반 setState가 일어나면 `useFormStatus().pending`이 false로 돌아감(setState 없는 최소 버튼은 유지, startTransition으로 감싸면 유지되지만 경과 시간이 액션 종료까지 멈춤). 수정: 진행 상태를 `useFormStatus` 대신 버튼이 직접 소유(`src/lib/jury-product/review-submit-progress.ts` 순수 리듀서) — 폼 submit 이벤트에서 ref 가드 + preventDefault/stopImmediatePropagation으로 중복 제출 차단, URL 변경(성공 이동·같은 경로 `?result=` 거절)·언마운트(오류 경계)·폼 reset(이동 없는 응답 → 3초 뒤 새로고침 안내)·한도+30초(브라우저 대기 중단 안내)로 정리. useActionState는 서버 액션 시그니처(prevState) 변경이 필요하고 같은 transition pending에 의존해 제외. 서버 액션·시그니처·폼·심사 로직·프롬프트·스키마 변경 없음. 검증 [실제 확인, 임시 하네스·모의 서버 액션, dev 및 별도 사본 next build/start]: 경과 시간 0→4초 동안 disabled 유지, 연타 5회+requestSubmit 2회에도 서버 호출 1회, 성공/거절/오류/무이동/타임아웃 정리, 거절 시 '화면이 이동하지 않았습니다' 오안내 없음. Preview·실제 리뷰 제출 경로는 [확인 불가].
- I-035 (UI, I-033 관찰): `/jury/evidence` 입력 폼 분석 항목 행에서 390–410px일 때 자료 상태 select("사용 가")와 측정값 input("측정값 (선")의 글자가 잘림. 원인 [실제 확인, 임시 하네스]: `ui.tsx` 지표 행이 nowrap flex `.row`이고 지표 이름이 min-content 폭을 유지해 두 필드가 텍스트 폭보다 좁아짐(390px: select/input 76–107px, 필요 104–110px, 4행 모두 잘림. 410px: 2행 잘림. form control은 scrollWidth==clientWidth라 수치로는 드러나지 않음). 수정: 지표 행에 `.metricRow`를 추가해 720px 이하에서만 이름을 별도 줄로 내리고 두 필드가 다음 줄을 나눠 씀(390px에서 156px, 410px에서 166px, 잘림 0행). 768px와 1280px는 스크린샷이 수정 전후 동일. 지표 계산·데이터·API·심사 로직 변경 없음. Preview 실측 [확인 불가].
