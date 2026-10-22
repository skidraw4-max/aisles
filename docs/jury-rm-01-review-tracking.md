# RM-01 — review request tracking (D-05, D-14)

- `JuryReviewRequest`: + `createdAt`, `updatedAt`, `resultSource` (default `UNKNOWN_LEGACY` → all pre-RM-01 rows), `failureReason`.
- `JuryReviewAttempt`: one row per execution attempt (RUNNING → COMPLETED/FAILED, failure reason, result source, boardRunId, started/finished). Failed attempts are logged without creating a `JuryReviewRequest`, so retry semantics are unchanged.
- `JuryLlmCallLog`: per-LLM-call metadata only (operation, memberId, status, error code, latency, start). No prompt/response/evidence text or keys.
- Instrumentation: `src/lib/jury-product/llm-call-log.ts` wraps `ReviewBoardLlm` from outside `src/lib/ai-review-board` (zero diff there; prompts and judging logic untouched).
- Result source: the Gemini path in `tenantReviewCore` sets `REAL_MODEL`. `VERIFIED_REAL` is never set automatically (D-16). Cores that do not declare a source record `UNKNOWN_LEGACY`.
- Tracking is best-effort: a tracking write failure never changes the review outcome.
- Migration `20261022130000_jury_review_tracking_rm01` is additive (enum + 4 nullable/defaulted columns + 2 tables, RLS enabled). Tested on isolated loopback Postgres only. **Not applied to Production/Preview** — needs separate JD approval.
