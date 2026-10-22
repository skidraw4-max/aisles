# RM-06 — aisleshub DB 연결 타임아웃 원인 조사 (I-023, 읽기 전용)

- 조사 시각: 2026-10-22 15:45~16:00 KST
- 범위: Vercel 런타임 로그(운영, 최근 7일), Vercel 프로젝트 메타데이터(환경변수는 **이름·범위만**), Supabase 메타데이터(집계만), 코드 리뷰.
- 변경 사항: **없음**(설정·env·DB·배포 변경 없음). 이 문서는 D-10 결정을 위한 근거와 변경안이다.
- 표기: 환경변수 값, DB URL, project ref는 기록하지 않는다.

## 1. 관측 사실

| # | 사실 | 근거 |
|---|---|---|
| F1 | 운영 error/fatal 로그 7일 합계 ≈ 1,181건 (배포 `dpl_4zHb…` 1,145건 + 현재 배포 `dpl_GjnR…` 36건) | [실제 확인] Vercel runtime logs group_by=deploymentId |
| F2 | 그중 `timeout exceeded when trying to connect` 1,143건(≈96.8%), `Connection terminated …` 19건 | [실제 확인] 전문 검색 count |
| F3 | 경로: `/` 229건, `/post/<id>` 대다수(상위 20개 경로 각 5~15건), `/search` 8, `/notices/<id>` 5. 도메인은 전부 www.aisleshub.com, jury 호스트는 0건 | [실제 확인] group_by=requestPath, 최근 100건 표본 |
| F4 | 로그 위치: `[fetchLatestForCategory]` 582건(홈 quasar 캐시 재검증, `/post` 페이지에서도 발생), `[recordPostView] PostViewDaily upsert failed` 다수 | [실제 확인] |
| F5 | 시간대(최근 100건 표본, KST): 10/22 02~07시 집중(시간당 12~18건), 이후 시간당 2~9건 — 특정 배치 시각이 아닌 트래픽 연동 패턴 | [실제 확인] 표본 기준, 7일 전체 시간 분포는 [확인 불가](API 상위 100건 제한) |
| F6 | `pg-pool` 3.13: 정확히 `timeout exceeded when trying to connect` 문구는 **풀이 가득 차서 기존 클라이언트 반납을 기다리는 대기열**(`_pendingQueue`)이 `connectionTimeoutMillis`를 넘길 때만 발생. 신규 소켓 연결 실패는 `Connection terminated due to connection timeout` | [코드 확인] node_modules/pg-pool/index.js L200-231, L247-276 |
| F7 | `src/lib/prisma.ts`: PrismaClient·pg.Pool은 `globalThis` 싱글턴(운영 포함). Pool `max` 기본값 production **2**(`PG_POOL_MAX` 미설정 시), `connectionTimeoutMillis` 8,000, `idleTimeoutMillis` 20,000 | [코드 확인] prisma.ts, db-pool-factory.ts |
| F8 | Vercel 운영 env에 `PG_POOL_MAX` **없음** → max=2 적용. 운영 DB 관련 env 이름: `DATABASE_URL`, `DIRECT_URL`(production/preview 각각) | [실제 확인] env 이름·target만 조회 |
| F9 | `withDbRetry`는 `timeout exceeded`도 재시도 대상(최대 3회, 80/160ms) → 풀 포화 시 같은 대기열에 재진입, 최악 ≈24초 대기 | [코드 확인] src/lib/db-retry.ts |
| F10 | 홈/포스트 경로 fan-out: `fetchLatestLabGalleryEight`·`fetchCommunityPreviewPosts`가 `Promise.all`로 2쿼리씩, `home-page-data`도 3쿼리 병렬, `unstable_cache(revalidate 60s)` 재검증 + `recordPostView` 쓰기 2건이 같은 풀(2)을 공유 | [코드 확인] |
| F11 | DB 인스턴스: `max_connections`=60, 조사 시점 전체 backend ≈16(Supavisor→Postgres 2, 나머지 시스템) — **DB 서버 연결 포화 아님** | [DB 확인] pg_stat_activity 집계 |
| F12 | 풀러: Supavisor **transaction 모드** 사용(로그 상태 표기 `(transaction)`). 24h Supavisor ERROR 25건: SCRAM 인증 단계 타임아웃/클라이언트 소켓 종료 | [DB 확인] Supabase logs 집계 |
| F13 | 쿼리 자체는 빠름: Post 조회 평균 1~14ms(최대 1~4s). 단 같은 DB에서 Jury `… FOR UPDATE` 평균 20~84ms, 최대 8.6s | [DB 확인] pg_stat_statements 집계 |
| F14 | 리전: vercel.json `regions: ["bom1"]`, Supabase 운영 프로젝트 ap-south-1(뭄바이) — 동일 리전. 로그의 `region=iad1/cle1/sin1…`는 요청 엣지 리전 | [코드 확인]/[DB 확인]; 함수 실행 리전 실측은 [확인 불가] |
| F15 | Performance advisor: 미인덱스 FK 30건(Post_authorId 등), 미사용 인덱스 2건, Auth 연결 절대값 10 | [DB 확인] (모두 INFO) |

## 2. 원인 가설 (우선순위)

1. **H1 — 인스턴스당 pg.Pool max=2 포화(대기열 8초 초과)** — 가장 유력.
   F2·F6에 따라 오류의 97%는 "연결 실패"가 아니라 "풀 대기 초과"다 [코드 확인]. Vercel Fluid compute에서는 한 인스턴스가 동시 요청을 처리하므로 [추론], 홈/포스트 렌더의 병렬 쿼리(F10) + 캐시 재검증 + 조회수 쓰기가 슬롯 2개를 두고 경쟁한다. DB 서버는 여유(F11), 쿼리도 빠름(F13) → 병목은 클라이언트 풀 [추론, 강한 근거].
2. **H2 — 재시도에 의한 증폭** — `withDbRetry`가 풀 대기 초과를 재시도(F9)해 대기열을 더 길게 만든다 [코드 확인]. 단독 원인은 아니고 H1 증폭기 [추론].
3. **H3 — 슬롯 점유 시간 증가 요인**: 신규 연결의 TLS+SCRAM 핸드셰이크 지연(F12 SCRAM 타임아웃, F2의 19건), 콜드 스타트 시 2슬롯 모두 연결 수립 중 [추론]. 오류 비중은 작음.
4. **H4 — 같은 DB의 Jury 트랜잭션 잠금 대기**(F13, FOR UPDATE 최대 8.6s): Post 쿼리와 잠금 대상이 달라 직접 원인 가능성 낮음 [추론]. 다만 공용 DB 부하 공유는 사실 [DB 확인].
5. **H5 — 리전 불일치**: 동일 리전으로 보여 가능성 낮음 [코드 확인/DB 확인], 함수 리전 실측은 [확인 불가].
6. **H6 — Supavisor 풀 크기/max client 한도**: 풀러 설정값은 조회 불가 [확인 불가]. 현재 backend 2개만 사용 중이라 풀러 측 포화 근거는 없음.

## 3. D-10 변경안 (미적용, 결정 필요)

| 순서 | 변경 | 종류 | 위험 | 기대 효과 |
|---|---|---|---|---|
| A | Vercel 운영 env `PG_POOL_MAX`=5(시작값) 추가 후 7일 관찰 | **Vercel 설정 변경**(D-10 승인 필요) | 인스턴스 수×5만큼 Supavisor 클라이언트 연결 증가. transaction 모드라 Postgres backend 증가는 제한적 [추론]. Supavisor max client 한도 확인 선행 필요 | H1 직접 완화 |
| B | `withDbRetry`에서 풀 대기 초과(`timeout exceeded when trying to connect`)는 재시도 제외, 연결 수립 오류만 재시도 | 코드(별도 PR) | 일시 대기 성공 기회 감소 | H2 제거, 최악 대기 24s→8s |
| C | `recordPostView`(조회수 2쓰기)를 응답 후 처리(`after()`)로 이동하거나 하나의 쿼리로 합침 | 코드 | 낮음 | 렌더 경로 슬롯 점유 감소 |
| D | 홈 quasar 캐시 재검증 주기 60s→300s 등 조정, `/post` 페이지에서 홈 payload 재검증 분리 | 코드 | 신선도 감소 | 재검증 쿼리 감소 |
| E | 풀 대기/연결 실패를 구분한 로그 코드(POOL_WAIT_TIMEOUT / CONNECT_TIMEOUT)와 대기 시간 지표 | 코드 | 없음 | 효과 측정 |
| F | (선택) Jury 운영 DB 분리 또는 Jury 테스트가 운영 DB에 잠금을 거는지 점검 | 운영 정책(D-xx) | 중간 | H4 제거 |

권고 순서: E → B → A(관찰) → C/D. A는 설정 변경이므로 이번 작업에서 적용하지 않았다.

## 4. 이번에 하지 않은 것
- Prisma 싱글턴 수정: 이미 `globalThis` 싱글턴이라 필요 없음 [코드 확인].
- `PG_POOL_MAX` 기본값 코드 변경: 효과는 A와 같지만 머지 즉시 운영 동작이 바뀌는 연결 예산 변경이므로 D-10에 묶음.
- B~E 코드 변경: 운영 동작 변경이므로 D-10 결정 후 별도 PR.
