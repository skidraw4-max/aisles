# AI 운영위원회 (AI Review Board)

## 목적
Independent → Debate → Claim Calibration → Evidence Semantics → Semantic Judge → Revision → Consistency → Critic → Chairman.

호출 수: **32** LLM ≤40.

## 실행
```bash
npx tsx scripts/run-ai-review-board.ts
node --import tsx --test src/lib/ai-review-board/*.test.ts
```

## 기준 샘플 (삭제·덮어쓰기 금지)
- v8 `run-2026-09-17T11-52-42-008Z`
- v9 `run-2026-09-17T12-25-17-531Z` — Semantic Judge Validation

## v9 Validation
- Human Reference: `tests/fixtures/ai-review-board/semantic-reference-cases.json` (SEM-001…015)
- TP/FP = regression only; Live = AMBIGUOUS + classification/leap/action/overlayFlags
- Overlay = flags only (LLM 판정 덮어쓰기 없음)
- Admin Semantic Judge: **Live Run** vs **Regression Reference** 분리
