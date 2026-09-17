# AI 운영위원회 (AI Review Board)

## 목적
분석 → 토론 → Claim Calibration → Revision → Critic → Chairman. **코드 자동 수정·배포·Cron 없음.**

호출 수(v5): **22** (5+5+5+5+1+1), max 기본 40.

## 실행
```bash
npx tsx scripts/run-ai-review-board.ts
npx tsx scripts/compare-ai-review-runs.ts \
  run-2026-09-17T09-27-13-078Z \
  run-2026-09-17T10-09-59-178Z \
  run-2026-09-17T10-34-21-451Z
# v5: run-2026-09-17T10-55-31-639Z
```

## 기준 샘플 (삭제·덮어쓰기 금지)
- v1 `run-2026-09-17T07-53-24-323Z`
- v2 `run-2026-09-17T09-27-13-078Z`
- v3 `run-2026-09-17T10-09-59-178Z`
- v4 `run-2026-09-17T10-34-21-451Z`
- v5 `run-2026-09-17T10-55-31-639Z` (Claim Calibration)

## v5 Claim Calibration
각 위원이 Independent 주장을 3–7 Claim으로 분해:
`evidenceType` DIRECT_FACT|INFERENCE|HYPOTHESIS|UNKNOWN · `supportLevel` SUPPORTED|PARTIALLY_SUPPORTED|NOT_SUPPORTED · `evidenceImpact` · `riskOfOverclaiming`  
→ Revision 입력. **강제 PARTIAL/FULL 금지.** UNKNOWN≠부정 evidence.

## v1–v5 요약

| | v4 | v5 |
|--|--|--|
| calls | 17 | **22** |
| claimCalibrations | — | **있음** |
| PARTIAL+FULL | 0 | **0** |
| UNCHANGED | 5/5 | **5/5** |
| conf Δ | 0 | **0** |
| Critic unknownAsEvidence | — | **flag 있음 (E)** |
| Critic causalWithoutEvidence | — | **flag 있음 (A)** |

v5에서 Claim 분해·Critic flag는 동작했으나, PARTIALLY_SUPPORTED+HIGH impact가 있어도 Revision은 여전히 UNCHANGED·confidence 유지.  
성공 기준은 revision rate가 아니라 Claim→Evidence→Calibration→Revision **연결의 논리성** — 연결은 구현됐으나 soft-revision 유발은 이번 Evidence에서 발생하지 않음.

테스트: `node --import tsx --test src/lib/ai-review-board/*.test.ts`
