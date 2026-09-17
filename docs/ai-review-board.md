# AI 운영위원회 (AI Review Board)

## 목적
분석 → 토론 → 검증 → 종합 과정을 검증한다. **코드 자동 수정·배포·Cron 없음.**

파이프라인(v4):

EvidencePack → A–E Independent → A–E Debate(반박) → A–E Revision(Q1–Q12) → F Critic → Chairman

호출 수: **17** (5+5+5+1+1), max 기본 40.

## 실행 (로컬 CLI만)
```bash
npx tsx scripts/run-ai-review-board.ts
npx tsx scripts/analyze-ai-review-debate.ts run-2026-09-17T10-34-21-451Z
npx tsx scripts/compare-ai-review-runs.ts \
  run-2026-09-17T09-27-13-078Z \
  run-2026-09-17T10-09-59-178Z \
  run-2026-09-17T10-34-21-451Z
```

## 산출물
`data/ai-review-board/run-*/` (+ v4 `revisions.json`)

**기준 샘플 (삭제·덮어쓰기 금지):**
- v1: `run-2026-09-17T07-53-24-323Z`
- v2: `run-2026-09-17T09-27-13-078Z`
- v3: `run-2026-09-17T10-09-59-178Z`
- v4: `run-2026-09-17T10-34-21-451Z`

## 관찰 UI
`/admin/ai-review-board` · Debate 탭: 신런 `revisions` 우선, 구런 debate fallback · 없는 필드 `—`

## 테스트
```bash
node --import tsx --test src/lib/ai-review-board/*.test.ts
```

---

## Debate vs Revision (v4)

| 단계 | 역할 |
|------|------|
| Debate | agreement / disagreement / weakEvidence / missed / needsVerification 만 |
| Revision | `revisionStatus` UNCHANGED\|PARTIAL\|FULL + retainReason/revisionReason + Q1–Q12 + confidenceBefore/After |

강제 변경 금지. 다수 동의만으로 UNCHANGED·confidence↑ 금지.

---

## v1–v4 비교 요약

| | v1 | v2 | v3 | v4 |
|--|--|--|--|--|
| calls | 12 | 12 | 12 | **17** |
| disagreement | 8 | 18 | 5 | 2 |
| weakEvidence | 17 | 10 | 7 | 14 |
| PARTIAL+FULL | 0 | 0 | 0 | **0** |
| UNCHANGED 명시 | — | — | 5/5 | **5/5** |
| confidence Δ | — | — | (debate conf) | **전원 0.9→0.9** |
| Q1–Q12 저장 | — | — | — | **있음** |
| Critic integrity 필드 | — | — | — | **있음** |

### v4에서 확인된 점
- Revision 분리·`retainReason`·`revisionAnswers` 기록은 동작.
- PARTIAL **없음** (성공 기준이 rate가 아니므로 “실패”로 단정하지 않음 — 다만 CASE B 유형을 스스로 선택하지 않음).
- evidence gap을 Q4/Q5에서 인정하면서도 confidence를 내리거나 주장 강도를 PARTIAL로 완화하지 않음.
- 일부 표현(“critical decline”, “심각한 정체”)은 RULE 4 관점에서 overclaim 후보이나, 위원·Critic 모두 overclaim 아니라고 자체 평가.
- retainReason은 대체로 메트릭 근거이며, 순수 “다수 동의”만으로 유지한 사례는 드묾 (다만 “peer reviews corroborate”류 soft herding 잔존).

### 다음 실험 후보
- Critic이 overclaim/confidenceIntegrity를 더 공격적으로 flag하도록 강화
- Independent 단계에서 이미 overclaim한 문장을 Revision이 PARTIAL로 완화하는지 측정 가능한 채점 루브릭
- `activeUsersLast7d` / `viewsLast7d` 산출 가능 여부 (제품 TODO)

---

## EvidencePack 지표
v2와 동일 (`newUsersLast7d` / null active·views / `commentsLast7d`). 상세는 코드 `EVIDENCE_METRIC_DEFINITIONS`.
