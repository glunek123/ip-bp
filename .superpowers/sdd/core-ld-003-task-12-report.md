# CORE-LD-003 Task 12 report

## Change

Added a forward-only migration that makes review decisions match the lead's customer and the reviewer's actual enterprise binding, and makes receipts match the decision's actor, binding, lead, department and result version. The new composite foreign keys use `ON UPDATE RESTRICT`. A `BEFORE UPDATE OR DELETE` trigger now rejects receipt mutations with SQLSTATE `55000`; the existing decision trigger remains in force. Prisma contains the same composite keys and relations, including the defining-side unique keys Prisma requires for one-to-one relations. No earlier migration was edited.

## RED / GREEN evidence

- RED: `pnpm --filter @dev-cor/backend test src/modules/leads/core-ld-migration.spec.ts` failed because `20260922013000_harden_client_lead_review_integrity` did not exist (2 failed, 9 passed). One older ordering assertion was then made independent of the total migration count.
- Database RED could not be observed: the first E2E attempt stopped before tests because the isolated test container was down. This is a TDD evidence gap for the PostgreSQL behavior test.
- GREEN: `pnpm --filter @dev-cor/backend db:generate` succeeded with Prisma 7.10.0. Focused migration Jest passed (11/11).
- `pnpm check:fast` initially failed on a concurrent frontend edit. After that edit settled, it exposed a missing `reviewIntegrity` field in the E2E fixture declaration; this was fixed in `tests/support/core-lead-database.d.mts`. The final `pnpm check:fast` passed architecture, backend/frontend/root TypeScript and ESLint.
- Once Docker Desktop was available, `pnpm db:test:up` started only `postgres-test`. `pnpm db:test:migrate:deploy` applied all 27 forward migrations from an empty `dev_cor_test` database, including the new integrity migration.
- PostgreSQL GREEN: `pnpm exec node scripts/run-e2e.mjs tests/e2e/core-leads.spec.ts --grep "core lead migrations"` ran exactly one test and passed (1/1). The test exercises empty schema installation, synthetic previous-schema upgrade, failure atomicity and the new review identity probes. The documented `pnpm test:e2e:core-ld -- --grep ...` form forwarded a literal `--` and selected all tests, so the direct runner invocation was used for the focused result.

## Risks and limits

The PostgreSQL RED behavior test could not run before implementation due to Docker availability. The static Jest RED did fail for the missing migration. The successful PostgreSQL probe now verifies SQLSTATE `23503` for decision/receipt mismatches and parent identity changes, and `55000` for decision/receipt updates and deletes. Only the isolated test database was accessed; no development or production database was touched.
