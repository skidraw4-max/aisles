# AI 운영위원회 (AI Review Board)

## 목적
분석 → 토론 → Claim Calibration → **Evidence Semantics** → Revision → Consistency Check → Critic → Chairman. **코드 자동 수정·배포·Cron 없음.**

호출 수(v7): **27** LLM (5+5+5+5+5+1+1) + deterministic checkers, max 기본 40.

## 실행
```bash
npx tsx scripts/run-ai-review-board.ts
```

## 기준 샘플 (삭제·덮어쓰기 금지)
- v1 `run-2026-09-17T07-53-24-323Z`
- v2 `run-2026-09-17T09-27-13-078Z`
- v3 `run-2026-09-17T10-09-59-178Z`
- v4 `run-2026-09-17T10-34-21-451Z`
- v5 `run-2026-09-17T10-55-31-639Z` (Claim Calibration)
- v6 `run-2026-09-17T11-15-53-412Z` (Calibration → Revision Consistency)
- v7 `run-2026-09-17T11-33-12-976Z` (Evidence Semantics & Claim Entailment)

## v7 Evidence → Claim Entailment
Calibration 직후 각 claim에 대해 EvidencePack만으로 entailment 판단:
`evidenceRelation` DIRECTLY_SUPPORTS|PARTIALLY_SUPPORTS|CONTEXT_ONLY|DOES_NOT_SUPPORT|CONTRADICTS|UNKNOWN  
`entailmentLevel` DIRECT|STRONG_INFERENCE|WEAK_INFERENCE|UNSUPPORTED|UNKNOWN (숫자 score 없음)  
**UNKNOWN/null ≠ negative evidence.** Absence of evidence ≠ evidence of absence.

## v1–v7 요약

| | v5 | v6 | v7 |
|--|--|--|--|
| calls | 22 | 22 | **27** |
| claimCalibrations | ✓ | ✓ | ✓ |
| evidenceSemantics | — | — | **✓** |
| consistency checks | — | ✓ | ✓ |
| 성공 기준 | claim 분해 | cal↔rev 연결 | **Evidence→Claim 의미** |

성공 기준(v7): revision rate가 아니라 Evidence of Absence vs Absence of Evidence 구분.
