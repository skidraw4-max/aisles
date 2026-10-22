# RM-01 운영 마이그레이션 실행 런북 (미실행 — JD 실행 승인 필요)

## 대상 SQL 동일성 [검증]
- #10(8163ea5)의 `prisma/migrations/20261022130000_jury_review_tracking_rm01/migration.sql` sha256 `2d185302…348d` = #30 최상단 파일 = 사본 리허설 파일 = Preview 적용 파일 (diff 0).
- 빌드는 마이그레이션을 실행하지 않음(`run-build.cjs`: BUILD_MIGRATE_DISABLED) → main 머지만으로는 DB 변경 없음. **#10 배포 전에 수동 적용 필수**.

## 실행 경로 선택
- 권장 A: `scripts/prod-rehearsal/rm01-prod-apply.sql` — 마이그레이션 본문 그대로 + `SET LOCAL lock_timeout='5s'`, `statement_timeout='60s'`, `_prisma_migrations` 행 삽입을 **한 트랜잭션**으로. (Supabase SQL 실행 또는 psql). 사본 리허설 48ms, 이후 `prisma migrate status` = up to date. 재실행 시 `type already exists`로 전체 롤백(부분 적용 없음).
- 대안 B: `prisma migrate deploy`(PC, DIRECT_URL) — lock_timeout을 파일에 넣을 수 없음(체크섬 변경) → A 권장.

## 순서
1. 사전: 백업 확인(대시보드, 아래) / 트래픽 낮은 시간 / `select migration_name from _prisma_migrations where migration_name like '%rm01'` = 0행.
2. 직전 확인: 미적용 마이그레이션 1건뿐(Stage A 결과 동일한지 재조회).
3. `rm01-prod-apply.sql` 실행 (lock 대기 5s 초과 시 실패→재시도).
4. 검증 SELECT: `JuryReviewAttempt`/`JuryLlmCallLog` 존재·RLS on, `JuryReviewRequest.resultSource` 전부 UNKNOWN_LEGACY(5건), `_prisma_migrations` rm01 1행 finished.
5. 같은 창에서 #10 포함 그룹 B 머지 → 배포 READY → 스모크: 두 도메인 홈 200, /jury 리뷰 목록·상세 읽기, 런타임 오류 로그 확인.
6. **RM-01b (JD 결정 A, 2026-10-22)**: 4단계 검증 직후·그룹 B 머지 전 `backfill-rm01b-createdat.sql` 실행 → `UPDATE 5` 기대, 재실행 `UPDATE 0`.

## 롤백
- `rm01-down.sql`: 두 테이블·4컬럼·enum 삭제 + 이력 행 삭제. **파괴적**(적용 후 쌓인 attempt/LLM 로그와 failureReason/resultSource 소실). 앱을 #10 이전으로 되돌린 뒤에만. 사본에서 마이그레이션 전 카탈로그로 정확히 복원 확인.

## RM-01b — 결정: A (즉시 실행)
- A 즉시(4단계 직후): 기존 5건 createdAt/updatedAt ← 결과 completedAt. 사본 dry-run 5건 → 재실행 0건.
- B 보류: O-지표 30일 집계가 기존 5건을 적용일 기준으로 셈(5건 수준 왜곡).
