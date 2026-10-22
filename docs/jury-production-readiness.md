# Jury Production Readiness Review

This review branch is based on `04e947d0e6ec421f7541adcde22066f0f29d6fe0`, the verified Jury development HEAD. It does not merge, deploy, or apply database changes.

## Proposed initial Production scope

Keep the existing commit history and dependency boundaries intact. The initial review scope is:

- Jury host routing and the isolated Jury route group.
- Jury landing, login, organization entry, console, review, evidence, and service-onboarding surfaces that depend on the existing Jury schema.
- Shared authentication callback/origin handling required by Hub and Jury.
- Build-time database target protection and the rule that builds never run migrations.

Defer until separately approved:

- Organization foundation migration `20261008100000_jury_organization_foundation`.
- Organization invitation/service-member backfill and RLS activation.
- GitHub refresh execution, agent execution, automatic loops, and extended re-review flows.
- AI Review Board evaluation/runtime-storage changes and Preview diagnostics.

These items are not removed here because the current code and commit history have cross-dependencies. Any reduction should be performed as a dependency-preserving follow-up change, not by copying files or making arbitrary cherry-picks.

## Required database order

1. Confirm that the prior Jury migrations are applied in order.
2. Review existing role values, membership uniqueness, service-connection counts, and the intended `MEMBER`/`AUDITOR` conversion.
3. Define and review RLS policies, or confirm the DB role intentionally bypasses RLS.
4. Apply the organization foundation migration as a separately approved database operation.
5. Verify the schema, backfill counts, foreign keys, indexes, and RLS behavior.
6. Deploy the application only after the database contract is ready.

The build wrapper intentionally does not run migrations, so a deployment cannot be treated as a migration step.

## Validation gaps

Repository tests cover pure policy, access, target-guard, TLS, and migration-policy logic. They do not prove an actual Vercel Preview deployment, Supabase TLS handshake, real RLS behavior, OAuth/email delivery, GitHub API access, or a live migration. Those remain explicit pre-Production checks.

## Known review note

The original branch had an extra blank line at EOF in `src/lib/jury-product/member-service-cleanup.ts`. This branch removes only that formatting issue; no runtime behavior is changed.
