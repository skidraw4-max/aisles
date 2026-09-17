# AI 운영위원회 (AI Review Board)

## 목적
Evidence → … → Semantic Judge → Revision → Critic → Chairman.

호출 수: **32** LLM ≤40 (Live). v9.1은 **regression only** (새 Gemini Live 없음).

## 실행
```bash
npx tsx scripts/run-ai-review-board.ts
node --import tsx --test src/lib/ai-review-board/*.test.ts
```

## 기준 샘플 (삭제·덮어쓰기 금지)
- v8 `run-2026-09-17T11-52-42-008Z`
- v9 `run-2026-09-17T12-25-17-531Z`
- SEM-001…015 + **CASE-01…10** (v9.1) in `tests/fixtures/ai-review-board/semantic-reference-cases.json`

## v9.1
- CASE-01/02: null 측정 불가 vs null→dormant 분리
- CASE-04/06/08: benchmark / 범위 과잉 / 단일지표→전체 참여
- `NO_ACTION_NEEDED` ≡ `NO_CHANGE` alias
- `mismatchType`, `chairmanReliabilityFlags`, Admin Claim Table
- Live TP/FP 금지
