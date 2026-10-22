# Stage B — 결정 정리 (2026-10-22 KST)

원칙: 개발/운영 반영을 실제로 막는 결정만 승인 대상으로 올림. 판정 로직·프롬프트 변경은 별도 승인 대상이며 여기서 구현하지 않음.

## 차단(승인 필요)
| ID | 막는 것 | 선택지 | 권고 | 영향 | 판정/프롬프트 | 마이그레이션 |
|---|---|---|---|---|---|---|
| RM-01b | 운영 반영(그룹 B 직후) — O-지표 "최근 30일"·목록 정렬이 기존 5건을 마이그레이션 시각으로 취급 | A 결과 completedAt으로 보정 / B 그대로 둠 | **A** (`backfill-rm01b-createdat.sql`, 사본 리허설 5건→재실행 0건) | 기존 5행 시각만 변경 | 없음 | 없음(데이터 UPDATE, 운영 실행 승인 필요) |
| D-16 | 최종 검증(실모델, VERIFIED_REAL 0건) → M-011 비교·M-013 추세·UI-05 확인 불가 | A Preview 프로젝트(aisles-jury-preview)+실 Gemini 키, 고정 입력 3~5건 / B 운영에서 직접 / C 보류 | **A**, 예산 상한(예: 호출 50회) | 검증 경로 확보, 운영 무영향 | 없음(입력만 고정) | Preview DB에 RM-01 적용 필요(운영 아님) |
| D-06 | 운영 실모델 리뷰의 504·무기록 실패 방지(RM-03 타임아웃 래퍼가 값 미설정으로 비활성) | A Vercel 함수 내 실행 + `JURY_LLM_*` 한도(Pro, maxDuration 300s) / B 외부 큐 워커 | **A** 지금: 호출당 60s, 전체 240s, route maxDuration 300 / B는 RM-17 때 재검토 | 초과 시 FAILED+사유 저장 | 없음(래퍼 외부, 프롬프트 불변) | 없음(운영 env 설정 — 승인 필요) |
| D-02 | RM-13(URL 우선 검사), 그 뒤 RM-17 | A 채택(1차 공개 페이지만, url-scope.csv) / B 불채택 | **A**, 단 VERIFIED_REAL 경로(D-16) 확보 후 착수 | 신규 어댑터 | 없음(입력 증거 추가, 판정 불변) — 증거 해석이 프롬프트 변경을 요구하면 별도 승인 | **필요**(URL 컬럼) |
| D-01 | RM-18(에이전트·자동 루프 재개 판단) | A 핵심 루프 완성까지 비노출 유지(RM-05 현행) / B 재개 계획 작성 | **A 유지**, D-16 검증 후 재평가 | 변화 없음 | 없음 | 없음 |

## 보류(비차단)
| ID | 사유 |
|---|---|
| D-08 | RM-11은 parentReviewResultId 계보로 구현 완료, 테이블 미사용. 제거(B) 권고 유지하되 스키마 정리는 급하지 않음 — D-06 장기 실행 결정 후 |
| D-09 | 표시 계층 "판정 불가"(NO_EVIDENCE 보류)는 RM-02/04에서 이미 구현. 판정 로직 쪽 도입은 판정 변경 → 별도 승인, 현재 개발 미차단 |
| D-13 | 심각도는 판정 출력/프롬프트 변경 → 별도 승인. UI는 "총 개수+심각도 미기록"으로 동작 중 |
| D-10 | 코드 독립 설정(PG_POOL_MAX 등), RM-06 문서대로 별도 승인 |

## I-PRT: 운영 PasswordResetToken 테이블 없음 (aisleshub 본 사이트)
- 근거: 운영 카탈로그에 테이블 없음, `_prisma_migrations`에 `20260409120000_password_reset_token` applied_steps_count=0(실행 없이 적용 처리).
- 코드: `/api/auth/forgot-password`가 토큰 저장 실패 시 오류 로그 후 **Supabase 기본 재설정 메일(reset-callback → /auth/update-password)로 폴백**. 토큰 방식(`/reset-password?token`, `/api/auth/verify-token`, `/api/auth/reset-password-token`)은 토큰이 생성되지 않으므로 실사용 경로에 안 나타남.
- 로그: Vercel 운영 런타임 로그 0~10일 "forgot-password"/"reset" 0건(10~14일 구간은 조회 시간 초과), Supabase 로그 24시간 관련 0건 → 최근 사용 없음.
- 심각도: **중간(기능 저하, 현재 사용자 영향 미관측)**. 메일 발송은 폴백으로 동작할 것으로 보이나 E2E 미검증.
- 수정안(승인 필요): `fix-password-reset-token.sql`(IF NOT EXISTS, 멱등, RLS on, `_prisma_migrations` 미변경) — 사본에서 2회 실행·삽입 확인. 적용 후 테스트 계정으로 비밀번호 찾기 E2E 1회.

## JD 승인 기록 (2026-10-22 18:54 KST, t422)
| ID | 결정 | 실행 상태 |
|---|---|---|
| RM-01b | **A** 기존 요청 createdAt/updatedAt을 결과 completedAt으로 보정 | 운영 UPDATE는 롤아웃 시점에 **별도 실행 승인** 후에만 (`backfill-rm01b-createdat.sql`) |
| D-16 | **A** Preview 실모델 검증 환경 | RM-01을 Preview DB에만 적용 완료. 실행 대기 — `docs/roadmap/d16-real-model-verification.md` |
| D-06 | **A** 함수 내 실행 + 한도 | Production env `JURY_LLM_CALL_TIMEOUT_MS=60000`, `JURY_LLM_TOTAL_BUDGET_MS=240000` 설정(다음 배포부터 적용, 재배포 안 함). `maxDuration=300`은 jury layout 코드 변경(Draft PR) |
| D-02 | **A** 채택(1차 공개 페이지) | D-16 검증 경로 확보 후 RM-13 착수 — 그전까지 보류 |
| D-01 | **A** 확장 기능 비노출 유지 | 변경 없음, D-16 검증 후 재평가 |
| I-PRT | PasswordResetToken 수정 SQL | **미승인 — 실행 금지** |

## 추가 승인 (2026-10-22 19:07 KST)
- Preview env `JURY_LLM_CALL_TIMEOUT_MS=60000`, `JURY_LLM_TOTAL_BUDGET_MS=240000` 설정 완료(Preview만, 이후 Preview 빌드부터 적용).
- D-16 호출 상한 증액은 **미승인** → 실모델 검증 미실행(현재 상한 ~50회 = 리뷰 1회분).
