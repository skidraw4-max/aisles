# AIsles Jury 테스트 기준선 (RM-00)

- 기준 커밋: `origin/main` 6b7d3b3 (Merge PR #7, feat/jury-ui-phase1)
- 측정일: 2026-10-22 (KST), Node 20.19.2, `npm ci` 후 `env -i` (환경변수·DB·API 키·.env 없음)
- 관련 계획 ID: RM-00 (CI 고정), RM-00b (격리 DB CI), RM-00c (하네스 예외 해소, 신규), I-002/I-016 회귀 기준, D-15

## 실행 명령

```bash
npm ci
npx tsc --noEmit --incremental false     # 오류 0 이어야 함
node scripts/test-baseline.mjs           # 목록 외 실패가 1건이라도 있으면 exit 1
```

`scripts/test-baseline.mjs`는 저장소의 모든 `*.test.{ts,tsx,cjs,mjs}`(node_modules, .next, mobile 제외; 188파일)를
`node --import tsx --test`로 실행하고, `test/baseline/failure-reporter.mjs` 리포터로 실패를 수집해
`test/baseline/known-failures.json`과 `파일 :: 테스트 이름` 키로 대조한다. 추가 의존성 없음.
CI: `.github/workflows/test-baseline.yml` (secrets·env 없음, PR과 main push에서 실행).

## 기준 수치 (실제 실행)

| 범위 | tests | pass | fail |
|---|---|---|---|
| 저장소 전체 (188파일) | 1562 | 1513 | 49 |
| Jury 범위 (파일명 jury 포함 132파일) | 836 | 787 | 49 |
| `src/lib/ai-review-board` (판정 로직) | 167 | 167 | 0 |
| tsc `--noEmit --incremental false` | — | 오류 0 | — |

## 허용 예외 클래스 (49건 = known-failures.json)

| 클래스 | 건수 | 원인 | 해소 작업 |
|---|---|---|---|
| TF-A | 43 | `DATABASE_URL` 미설정 (DB 통합 테스트) | RM-00b 격리 Postgres CI |
| TF-B | 2 | Preview DB 가드(`BLOCKED_PREVIEW_DB`)가 의도대로 차단 | RM-00b |
| TF-C | 3 | `server-only` 모듈이 node:test에서 해석 불가 (파일 2 + 테스트 1) | RM-00c 테스트 하네스 스텁 |
| TF-D | 1 | 테스트가 저장소 루트 `.env`를 읽음 (ENOENT) | RM-00c |

코드 결함(TF-E)으로 분류된 실패는 0건. 단 TF-A/B 45건은 DB 없이 실행되지 않아 결함 유무는 확인 불가.

## 필수 통과 규칙 (must-pass)

1. tsc 오류 0.
2. `node scripts/test-baseline.mjs` exit 0 — known-failures.json 밖의 실패 0건 (기준 1513 통과 전부 유지).
3. 판정 로직·프롬프트 불변: 승인 없는 PR에서 `src/lib/ai-review-board/**` diff 0 이고 해당 167개 테스트 전부 통과.
4. 예외 목록은 줄이기만 한다. 항목 추가는 사유·후속 ID를 PR에 기록하고 리뷰 승인 후에만 허용.
5. 목록 항목이 통과하기 시작하면 스크립트가 `FIXED`로 알려 주며, 해당 PR에서 목록에서 제거한다.

## 알려진 제약

- `src/lib/auth/classify-admin-auth-core.test.ts`는 `git grep`을 사용하므로 git 체크아웃 안에서 실행해야 한다 (CI checkout은 충족).
- flaky 판정은 반복 실행 데이터가 필요하다(현재 3회 실행, 수치 동일).
