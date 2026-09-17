# AI 운영위원회 (AI Review Board)

## 목적
분석 → 토론 → 검증 → 종합 과정을 검증한다. **코드 자동 수정·배포·Cron 없음.**

파이프라인(고정):

EvidencePack → AI-A~E 독립 분석 → A~E 토론 → AI-F Critic → Chairman 종합

## 실행 (로컬 CLI만)
```bash
npx tsx scripts/run-ai-review-board.ts
npx tsx scripts/run-ai-review-board.ts --stub-evidence --mock-llm
npx tsx scripts/analyze-ai-review-debate.ts run-2026-09-17T10-09-59-178Z
npx tsx scripts/compare-ai-review-runs.ts run-2026-09-17T09-27-13-078Z run-2026-09-17T10-09-59-178Z
```

## 산출물
`data/ai-review-board/run-*/`

**기준 샘플 (삭제·덮어쓰기 금지):**
- v1: `run-2026-09-17T07-53-24-323Z`
- v2 (metric clarity): `run-2026-09-17T09-27-13-078Z`
- v3 (honest revisionStatus): `run-2026-09-17T10-09-59-178Z`

## 관찰 UI
`/admin/ai-review-board` · `/admin/ai-review-board/[runId]` (ADMIN)

## 테스트
```bash
node --import tsx --test src/lib/ai-review-board/*.test.ts
```

---

## EvidencePack 지표 정의

| 필드 | 의미 | 현재 산출 |
|------|------|-----------|
| `userCount` | 전체 회원 수 | ✅ |
| `usersLast7d` | **DEPRECATED** = `newUsersLast7d` | ✅ 호환용 |
| `newUsersLast7d` | 최근 7일 **신규 가입** | ✅ `User.createdAt` |
| `activeUsersLast7d` | 최근 7일 활성 사용자 | ❌ **null** (활동 정의 TODO) |
| `postCount` | 전체 게시글 수 | ✅ |
| `postsLast7d` | 최근 7일 작성 게시글 | ✅ |
| `commentsLast7d` | 최근 7일 작성 댓글 | ✅ `Comment.createdAt` |
| `viewsLast7d` | 최근 7일 조회수 | ❌ **null** (`Post.views` 누적만) |
| `totalViews` | 전체 기간 조회수 합 | ✅ (7일 조회수 아님) |
| `commentCount` | 전체 댓글 수 | ✅ |
| `postsByCategory` | 카테고리별 게시글 수 | ✅ |

프롬프트에는 `EVIDENCE_METRIC_PROMPT_GUARD` + `metricDefinitions`가 **숫자 JSON보다 먼저** 붙는다 (`formatEvidencePackForPrompt`).

---

## Debate revisionStatus (v3+)

강제 변경 금지. AI가 정직하게 하나만 선택:

| 값 | 의미 |
|----|------|
| `UNCHANGED` | 독립 판단 유지 (유지 근거 `revisionReason` 필수) |
| `PARTIAL` | 일부 주장·우선순위만 수정, 핵심 thesis 유지 |
| `FULL` | 핵심 판단 교체·철회 |

`revised === true` 는 PARTIAL/FULL 호환 플래그. revision rate를 인위적으로 올리는 프롬프트는 쓰지 않는다.

---

## v1 vs v2 vs v3 실험 요약

| | v1 `…07-53-24-323Z` | v2 `…09-27-13-078Z` | v3 `…10-09-59-178Z` |
|--|--|--|--|
| metricDefinitions | 없음 | 있음 | 있음 |
| revisionStatus 필드 | 없음 | 없음 | **있음** |
| newUsers / active / views | (구 usersLast7d) | 0 / null / null | 0 / null / null |
| disagreement items | 8 | 18 | 5 |
| weakEvidence | 17 | 10 | 7 |
| revision (PARTIAL+FULL) | 0 | 0 | **0** |
| UNCHANGED (명시) | — | — | **5/5** |
| overallTrendScore | 2 | 35 | 20 |

### v3에서 확인된 점
- 메커니즘은 동작함: 전원 `revisionStatus`를 선택하고, UNCHANGED마다 **유지 근거**를 남김.
- 이번 런에서는 동료 분석이 **핵심 전제(신규 0·댓글 0·활성/조회 null)** 에 강하게 합의 → 반박이 “근거를 무너뜨리는” 수준이 아니라 **강조점 차이**에 그침 → 전원 UNCHANGED는 정직한 선택으로 해석 가능.
- disagreement는 v2(18)보다 줄었(5). revision을 강제하지 않았기 때문에 PARTIAL/FULL=0은 실패가 아니라 **“바꿀 필요 없음”을 선택한 결과**.
- 실험 목적(“재검토할 수 있는가?”)에 대한 답: **재검토 슬롯·근거 기록은 가능**. 이번 Evidence·동료 합의 조건에서는 **실제로 의견을 바꿀 만큼의 반박은 발생하지 않음**.

### 남은 실험 가설 (다음 단계 후보)
- 의도적으로 **상충 Evidence** 또는 **교차 반박이 강한 stub** 을 넣었을 때만 PARTIAL/FULL이 나오는지
- Critic 이후에 2차 재검토 라운드가 필요한지 (현재 범위 밖)

### 남은 TODO (제품)
- `activeUsersLast7d` 활동 정의 합의 후 산출
- `viewsLast7d`는 이벤트/로그 없으면 계속 null

---

## Admin UI
- Debate: UNCHANGED / PARTIAL / FULL 배지 + weakEvidence / missed / needsVerification / initial opinion
- 목록: agree/disagree/weakEv/rev/P/F/conf
