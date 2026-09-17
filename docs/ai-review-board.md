# AI 운영위원회 (AI Review Board)

## 목적
분석 → 토론 → Claim Calibration → Revision → **Consistency Check** → Critic → Chairman. **코드 자동 수정·배포·Cron 없음.**

호출 수(v5/v6): **22** LLM (5+5+5+5+1+1) + deterministic consistency checker, max 기본 40.

## 실행
```bash
npx tsx scripts/run-ai-review-board.ts
npx tsx scripts/compare-ai-review-runs.ts \
  run-2026-09-17T09-27-13-078Z \
  run-2026-09-17T10-09-59-178Z \
  run-2026-09-17T10-34-21-451Z
# v5: run-2026-09-17T10-55-31-639Z
# v6: (latest Gemini run after consistency check)
```

## 기준 샘플 (삭제·덮어쓰기 금지)
- v1 `run-2026-09-17T07-53-24-323Z`
- v2 `run-2026-09-17T09-27-13-078Z`
- v3 `run-2026-09-17T10-09-59-178Z`
- v4 `run-2026-09-17T10-34-21-451Z`
- v5 `run-2026-09-17T10-55-31-639Z` (Claim Calibration)
- v6 `run-2026-09-17T11-15-53-412Z` (Calibration → Revision Consistency)

## v6 Claim → Revision Consistency
Revision 직후 **deterministic** consistency check (추가 LLM 호출 없음).
- `calibrationImpactAssessment` / `revisionAction` per claimId
- `calibrationRevisionChecks[]`: CONSISTENT | PARTIALLY_CONSISTENT | INCONSISTENT
- Critic overlay: mismatch / overclaim / unknown-as-negative / causal / confidence / majority flags
- **강제 PARTIAL/FULL 금지.** UNCHANGED + RETAIN_WITH_JUSTIFICATION 허용 (근거 필수).

## v5 Claim Calibration
각 위원이 Independent 주장을 3–7 Claim으로 분해:
`evidenceType` DIRECT_FACT|INFERENCE|HYPOTHESIS|UNKNOWN · `supportLevel` SUPPORTED|PARTIALLY_SUPPORTED|NOT_SUPPORTED · `evidenceImpact` · `riskOfOverclaiming`  
→ Revision 입력. **강제 PARTIAL/FULL 금지.** UNKNOWN≠부정 evidence.

## v1–v6 요약

| | v4 | v5 | v6 |
|--|--|--|--|
| calls | 17 | **22** | **22** (+checker) |
| claimCalibrations | — | **있음** | **있음** |
| consistency checks | — | — | **있음** |
| PARTIAL+FULL | 0 | **0** | (run 결과) |
| UNCHANGED | 5/5 | **5/5** | (run 결과) |
| Critic unknownAsEvidence | — | **flag** | **flag + overlay** |
| Critic causalWithoutEvidence | — | **flag** | **flag + overlay** |

성공 기준(v6): Calibration 한계가 Revision 판단에 **논리적으로 연결**되었는가 (revision rate 아님).
