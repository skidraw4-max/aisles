# AI 운영위원회 (AI Review Board) — 1차

## 목적
분석 → 토론 → 검증 → 종합 과정을 검증한다. **코드 자동 수정·배포·Cron 없음.**

파이프라인(고정):

EvidencePack → AI-A~E 독립 분석 → A~E 토론 → AI-F Critic → Chairman 종합

## 실행 (로컬 CLI만)
```bash
# DB 집계 EvidencePack + 실제 Gemini
npx tsx scripts/run-ai-review-board.ts

# DB 없이 stub evidence + mock LLM (테스트/오프라인)
npx tsx scripts/run-ai-review-board.ts --stub-evidence --mock-llm

# 보존 샘플 Debate 메트릭 관찰
npx tsx scripts/analyze-ai-review-debate.ts run-2026-09-17T07-53-24-323Z
```

## 산출물
`data/ai-review-board/run-*/` — evidence, independent-analysis, debate, critic, final, raw-log.jsonl

**1차 기준 샘플 (삭제·덮어쓰기 금지):** `run-2026-09-17T07-53-24-323Z`  
일반 런은 `.gitignore`로 제외하고, 위 샘플만 추적한다.

## 관찰 UI
`/admin/ai-review-board` · `/admin/ai-review-board/[runId]` (ADMIN, 실행 버튼 없음)

## 테스트
```bash
node --import tsx --test src/lib/ai-review-board/ai-review-board.test.ts
```

---

## EvidencePack 지표 정의

| 필드 | 의미 | 현재 산출 |
|------|------|-----------|
| `userCount` | 전체 회원 수 | ✅ `User.count` |
| `usersLast7d` | **DEPRECATED** — `newUsersLast7d`와 동일 | ✅ (호환용) |
| `newUsersLast7d` | 최근 7일 **신규 가입** (`User.createdAt`) | ✅ |
| `activeUsersLast7d` | 최근 7일 활성 사용자 | ❌ `null` — 활동 정의 TODO |
| `postCount` | 전체 게시글 수 | ✅ |
| `postsLast7d` | 최근 7일 작성 게시글 | ✅ `Post.createdAt` |
| `commentsLast7d` | 최근 7일 작성 댓글 | ✅ `Comment.createdAt` |
| `viewsLast7d` | 최근 7일 조회수 | ❌ `null` — `Post.views`는 누적만 |
| `totalViews` | 전체 조회수 합 | ✅ |
| `commentCount` | 전체 댓글 수 | ✅ |
| `postsByCategory` | 카테고리별 게시글 수 | ✅ |

### `usersLast7d` 문제 (관찰)
- **실제 의미:** 최근 7일 신규 가입자 수
- **오해 위험:** AI가 “최근 7일 활성 사용자(DAU/WAU)”로 해석
- **샘플 런 영향:** `usersLast7d: 0`을 “활성 유저 0 / engagement crisis”로 과해석한 흔적
- **대응:** `newUsersLast7d` 명시 필드 + `metricDefinitions` + docsHints. 샘플 JSON은 보존(덮어쓰지 않음)

---

## 샘플 런 Debate 관찰 (`run-2026-09-17T07-53-24-323Z`)

| 메트릭 | 값 |
|--------|-----|
| initial opinion diversity (unique prefixes) | 5/5 |
| agreement count | 31 |
| disagreement count | 8 |
| weakEvidence (evidence challenge) | 17 |
| missed | 15 |
| needsVerification | 14 |
| revision count | **0** (전원 `revised=false`) |
| avg confidence (independent → debate) | 0.89 → 0.94 |
| evidence-backed scored dims | 28/28 of scored |
| Critic `herdingDetected` | false |

### 해석 (버그 단정 금지)
1. **의견 다양성:** A(UX)·B(트렌드/SEO·GEO)·C(경쟁)·D(기술/a11y/보안)·E(성장) 초점은 서로 다름. exact problem 문구 중복 쌍 0.
2. **반박:** disagreement 8 + weakEvidence 17 — 반박·근거 도전은 발생. 다만 B·E는 disagreement 0.
3. **검증/질문:** needsVerification 14, missed 15 — 추가 검증 요청은 활발.
4. **영향 흔적:** 동의 항목이 많음(31). 공통 전제(`usersLast7d=0`→저참여)로 수렴. Critic도 동일.
5. **미수정 이유:** 각자 역할 초점을 유지한 채 “보완 관찰”로 정리한 형태로 보임. confidence는 오히려 상승.
6. **`revised=false`:** 완전 독립 유지일 수도 있고, 토론 프롬프트가 “수정 임계”를 높게 만든 결과일 수도 있음 → **다음 단계에서 프롬프트/스키마 실험 후보** (지금은 관찰만).

---

## Admin UI 관찰 메모
- Debate 탭: agreement / disagreement / **weakEvidence / missed / needsVerification** / revision / initial opinion 표시
- 목록: when, calls, cost, status, agree/disagree/weakEv/rev/conf (debate 없으면 count는 `—`)
- Critic: 플래그·notes 구조화 뷰 (Raw 탭 유지)
