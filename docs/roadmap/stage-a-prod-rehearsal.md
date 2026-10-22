# Stage A — 운영 반영 리허설 (로컬 스키마 전용 운영 사본)

작성: 2026-10-22 (KST). 운영 DB에는 읽기 전용 카탈로그/집계 SELECT만 실행. 운영 쓰기·마이그레이션·설정·배포·병합 없음.

## A1. 운영 사본 재구성
- 대상: Supabase 프로젝트 "AIsle"(aisleshub.com 및 jury.aisleshub.com 공용 DB). public 스키마 40개 테이블(Jury 24), enum 37, 인덱스 112, 제약 122, 정책 2, RLS 플래그.
- 방법: `catalog-meta.sql`(읽기 전용) 결과 `prod-schema-meta.txt` → `build-schema-from-meta.py` → `create-copy.sh`로 로컬 PG17 `jury_prodcopy` 생성. Supabase 전용 객체(`auth.users`, `anon`/`authenticated` 역할)는 스텁.
- `_prisma_migrations` 48행(롤백 1행 포함)을 운영과 동일 id/checksum/시각으로 복제(`prod_migrations.psv`, logs 제외).
- 충실도: 재구성 DB에 같은 카탈로그 쿼리를 돌려 diff → 차이는 `User.mbti` attnum(운영에 삭제된 컬럼 흔적)과 정렬 순서 1건뿐. 의미상 동일.
- 행 데이터 복사 없음. `seed-synthetic.sql`이 운영의 형태·건수만 합성: 테넌트 2, OWNER 2, 연결 2(모두 DISCOVERY_PENDING, APPROVED 스코프 1/2), 서비스 권한 5, 증거 7, 지표 39, 리뷰 요청/결과 5(fixture-run `aa734100…`, 재리뷰 자식 `37072025…` 포함), 사용자 15.
- 전체 데이터 사본(옵션, 미생성): Supabase 브랜치 약 $0.01344/시간(조직 Pro). 브랜치는 기본적으로 데이터 미포함, 데이터 포함 시 PII(User.email 등) 복제 → JD 승인·삭제 계획 필요. 새 프로젝트 복원도 비용·PII 동일 이슈.

## A2. migrate deploy 리허설
- `prisma migrate status`(운영 이력 기준): 미적용은 **`20261022130000_jury_review_tracking_rm01` 1건뿐**. `20261008100000_jury_organization_foundation`(#15)은 운영에 2026-10-14 적용 완료.
- 체크섬: 13개 과거 마이그레이션이 로컬(LF)과 불일치 → CRLF로 계산 시 운영과 정확히 일치(Windows에서 적용된 흔적). 내용 동일, `migrate deploy`는 성공(경고 없음).
- 결과: 1.25s(CLI 포함), SQL 자체 ~10ms. 2회차 "No pending migrations"(멱등).
- 잠금: `JuryReviewRequest` AccessExclusive(5행, 메타데이터만 변경), `JuryTenant` ShareRowExclusive(FK 추가, 순간). 권장 `lock_timeout` 5s.
- 기존 5행 `resultSource=UNKNOWN_LEGACY` 확인. **주의: 기존 행의 `createdAt/updatedAt`은 마이그레이션 시각으로 채워짐**(원래 생성 시각 아님).
- 스모크(`smoke.ts`): 목록 읽기(요청 5/결과 5), 상세/비교 읽기(LEGACY_SOURCE), 리뷰 저장 + attempt/LLM 로그 기록 → PASS.

## A3. 백필(`backfill-rm10b.ts`, 기본 dry-run, 단일 트랜잭션, 멱등)
- 리허설 결과: 연결 2, 누락 권한 3건(READ_ONLY_ACCOUNT 연결의 OWNER에 VIEW/REVIEW/IMPROVE), DISCOVERY_PENDING→CONNECTED 2건(운영 스코프는 전부 APPROVED, PROPOSED-only 0) + 감사 이벤트 2.
- dry-run은 롤백 확인, `--apply` 2회차 0건(멱등). 비격리 DB는 `JURY_BACKFILL_APPROVED=RM-10b` 없으면 거부.
- 선택 데이터 정합성(운영 미실행): `aa734100…`(boardRunId `fixture-…`) → `resultSource=FIXTURE`, `37072025…`(mock 판정) → `MOCK`로 라벨링하는 UPDATE 2건. 현재는 UNKNOWN_LEGACY라 비교/추이에서 이미 제외됨 → 급하지 않음(D 결정 후).

## A4. 스키마 diff 검토
- `prisma migrate diff --from-schema main(6b7d3b3) --to-schema #27`: 의미 변경 = RM-01 마이그레이션과 정확히 일치(RLS 2줄은 schema로 표현 불가라 마이그레이션에만). 나머지 +347/−288줄은 포맷(정렬/공백) 변경.
- **사전 존재 드리프트(RM-01 무관, 운영 vs main schema 동일하게 존재)**: 운영에 `PasswordResetToken` 테이블 없음(마이그레이션은 applied_steps=0으로 "적용" 처리됨), `Comment_authorId_idx` 없음, schema에 없는 인덱스 2개(`Post_launch_banner_idx`, `User_newsletterSubscribed_digestFrequency_idx`), `Notice/PostStance.updatedAt` 기본값, Prisma 관리 밖 `announcements`(auth.users FK). → `migrate deploy`엔 영향 없음, 단 운영에 `prisma db push`/`migrate diff`를 쓰면 위험.

## A5. 롤백/백업
- `rm01-down.sql`: 사본에서 실행 → 카탈로그가 마이그레이션 전과 동일, 재실행 멱등, 이후 재-deploy 정상. 파괴적(attempt/로그 데이터와 신규 컬럼 삭제) → 앱을 먼저 되돌린 후 승인받아 실행.
- 백업: 조직 Pro 플랜(일일 백업 7일 보관). WAL archive_mode=on, 마지막 아카이브 2026-10-22 18:03 KST. PITR 애드온 여부와 최신 일일 백업 시각은 MCP로 조회 불가 → 대시보드(Database → Backups)에서 JD 확인 필요. DB 크기 48MB.
