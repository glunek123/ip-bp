# CORE-LD-007 Task 5 report

- Task: CORE-LD-007 Task 5 — isolated PostgreSQL and Chromium acceptance
- Model: gpt-6-luna
- Commit: `f2489e22c4e558af481afddef801d87f46bfa896`
- Changed files: `tests/e2e/core-leads.spec.ts`, `tests/support/core-lead-database.mjs`, `tests/support/core-lead-database.d.mts`
- Contract changes: none; tests exercise the existing API/UI contract.
- Requires Sol attention: no production behavior failure found.
- Known risks: none identified in this test slice. Test harness emits expected 500 logs for injected constraint failures and a pre-existing PostgreSQL client concurrency warning; assertions pass.

## Evidence

- Backend build passed: `pnpm --filter @dev-cor/backend build`.
- Final required suite passed: `pnpm test:e2e:core-ld` — 29/29 Chromium tests, including the real operator-password login → application → client-password login → pending withdrawal → allowed screenshot → confirmation → second review → refresh/history chain.
- Coverage includes PostgreSQL rollback fault injection, stale/invalid state and reason cases, authorization/isolation boundaries, idempotency/replay and two-key race cases, immutable earlier review/receipt facts, exact screenshot linkage, and empty/previous-schema migration probes.
- Before E2E, the project runner validated `backend/.env.test`, the pinned healthy `postgres-test` container and Playwright browser manifest. The fixture helper independently checked `current_database() = dev_cor_test` before fixture cleanup; no credentials were printed.
- Fixture cleanup is scoped to the test departments' lead/review/withdrawal rows, their fixture identities and fixture private root. No global truncate, database reset, volume operation, or dev/prod database action was performed.
