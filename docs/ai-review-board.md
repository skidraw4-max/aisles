# AI 운영위원회 (AI Review Board)

## 목적
분석 → 토론 → 검증 → 종합 과정을 검증한다. **코드 자동 수정·배포·Cron 없음.**

파이프라인(고정):

EvidencePack → AI-A~E 독립 분석 → A~E 토론 → AI-F Critic → Chairman 종합

## 실행 (로컬 CLI만)
```bash
npx tsx scripts/run-ai-review-board.ts
npx tsx scripts/run-ai-review-board.ts --stub-evidence --mock-llm
npx tsx scripts/analyze-ai-review-debate.ts run-2026-09-17T07-53-24-323Z
npx tsx scripts/compare-ai-review-runs.ts run-2026-09-17T09-27-13-078Z
```

## 산출물
`data/ai-review-board/run-*/`

**기준 샘플 (삭제·덮어쓰기 금지):**
- v1: `run-2026-09-17T07-53-24-323Z`
- v2 (metric clarity): `run-2026-09-17T09-27-13-078Z`

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

## v1 vs v2 실험 요약

| | v1 `…07-53-24-323Z` | v2 `…09-27-13-078Z` |
|--|--|--|
| metricDefinitions in evidence | 없음 | 있음 |
| newUsersLast7d / activeUsers / viewsLast7d | (구 usersLast7d만) | 0 / **null** / **null** |
| commentsLast7d | (없음) | 0 |
| Chairman 전제 | “zero **active** users in last 7 days” | “zero **new** users… active/view metrics **unavailable**” |
| signup-aware 신호 | 약함 | 전원 의견에서 신규 가입 구분 |
| disagreement items | 8 | 18 |
| revision | 0 | 0 |
| overallTrendScore | 2 (enrich 후) | 35 |

### v2에서 확인된 점
- Debate/Critic/Chairman **구조는 변경하지 않음** — EvidencePack 의미·프롬프트 가드만 강화.
- AI가 `newUsersLast7d=0`과 `activeUsersLast7d=null`을 **구분**하기 시작함 (v1의 “활성 0” 단정 완화).
- 여전히 저참여 내러티브는 존재하나, 근거가 “측정 불가 + 신규 가입 0 + 댓글 0” 쪽으로 이동.

### 남은 TODO
- `activeUsersLast7d` 활동 정의(게시/댓글/좋아요 등) 합의 후 산출
- `viewsLast7d`는 이벤트/로그 없으면 계속 null

---

## Admin UI
- Debate: weakEvidence / missed / needsVerification / initial opinion
- 목록: agree/disagree/weakEv/rev/conf
