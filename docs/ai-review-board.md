# AI 운영위원회 (AI Review Board)

## 목적
Independent → Debate → Claim Calibration → Evidence Semantics → **Semantic Judge** → Revision → Consistency → Critic → Chairman.

호출 수(v8): **32** LLM (+ chairman resume 시 33) ≤40.

## 실행
```bash
npx tsx scripts/run-ai-review-board.ts
# chairman만 재시도(실패 run)
npx tsx scripts/resume-ai-review-board-chairman.ts [runId]
```

## 기준 샘플 (삭제·덮어쓰기 금지)
- v7 `run-2026-09-17T11-33-12-976Z`
- v8 `run-2026-09-17T11-52-42-008Z` — Semantic Judge

## v8 Semantic Judge
Revision **이전** 독립 Judge ×5 + deterministic overlay. EvidencePack만으로 claim entailment 재판정.
- Live: verdict=`SEMANTICALLY_AMBIGUOUS` (TP/FP는 regression 전용)
- `calibrationAgreement` AGREE|DISAGREE|PARTIAL
- leap: UNKNOWN_AS_NEGATIVE / FACT_TO_CAUSALITY / TREND / GLOBAL / TECH_STACK_TO_QUALITY
- Admin: **Semantic Judge** 탭 (없으면 —)

성공 기준: 정확한 의미 판정 (revision rate 아님).
