# AI 운영위원회 (AI Review Board)

## 목적
Evidence → … → Semantic Judge → Revision → Critic → Chairman.

호출 수: **32** LLM ≤40 (Live). v9.1은 **regression only** (새 Gemini Live 없음).

## Roles
실행 시 AI-A~E / F / Chairman 역할·focus의 **SSOT**는 `src/lib/ai-review-board/personas.ts` (`PERSONA_SYSTEM`, `MEMBER_FOCUS`)다. 역할 전문은 여기에 복제하지 않는다.

## Admin 로컬 실행
`/admin/ai-review-board` 상단 **「운영위원회 일시키기」** (로컬 `next dev`만).
- Evidence: DB 집계 + GA4 attach(기본, fail-open)
- 클릭 후 해당 run 상세로 이동 · phase별 한글 상태(토론 단계 = 「위원회 토론 중」) · 폴링
- Vercel/prod에서는 실행 거부. CLI `scripts/run-ai-review-board.ts`도 유지.

## 실행
```bash
npx tsx scripts/run-ai-review-board.ts
node --import tsx --test src/lib/ai-review-board/*.test.ts
```

Env: `GOOGLE_GENERATIVE_AI_API_KEY` / `GEMINI_API_KEY`, `DATABASE_URL`  
선택(GA4 Evidence): `GA4_PROPERTY_ID`, `GA4_SERVICE_ACCOUNT_JSON` 또는 `_BASE64` — 자세한 내용은 `docs/ga4-events.md`.

## 기준 샘플 (삭제·덮어쓰기 금지)
- v8 `run-2026-09-17T11-52-42-008Z`
- v9 `run-2026-09-17T12-25-17-531Z`
- **v9.1 Live** `run-2026-09-17T12-58-30-257Z`
- SEM-001…015 + CASE-01…10 in `tests/fixtures/ai-review-board/semantic-reference-cases.json`

## v9.1
- Live Gemini + CASE regression
- CASE-01/02 null 측정 vs dormant 분리 등
- `mismatchType`, `chairmanReliabilityFlags`, Admin Claim Table

## GA4 Evidence
- `EvidencePack.ga4` — Data API 스냅샷 (DB aggregates와 분리)
- Admin 런 Overview 탭에 GA4 카드
- GA4 activeUsers ≠ DB activeUsersLast7d
