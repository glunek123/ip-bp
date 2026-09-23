# CORE-LD-007 Two-Party Withdrawal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authorized operator apply to withdraw a no-infringement archive, then let an active account of the original customer enterprise confirm it and review the lead again without losing history.

**Architecture:** Keep `Lead` as the current status/version aggregate and add a composite-FK-protected active review-decision pointer. Preserve all prior review decisions and receipts; add immutable application and confirmation facts with durable idempotent response snapshots. Extend the existing lead/client controllers and pages, not a generic workflow engine.

**Tech Stack:** NestJS, Prisma 7/PostgreSQL 17, Vue 3/Vite, Jest, Vitest, Playwright, pnpm 11.27.0, Node 24.21.0.

## Global Constraints

- Binding design: [CORE-LD-007 design](../specs/2026-09-23-core-ld-007-withdrawal-design.md), SD-40, REQ-LD-003 and the CORE-LD field/material contract. An application never changes `ARCHIVED` or erases the original decision; only the original enterprise's current effective client binding may confirm; confirmation returns to `WAITING_REVIEW`.
- Both commands require `expectedVersion` and a 1–128-character `Idempotency-Key`; application reason trims to 1–5000 Unicode code points. Replays require current authorization; same key/different request conflicts. Current decision is explicit; old decisions and review receipts remain immutable and replayable.
- Internal `lead.withdraw.apply` is a separate scoped Grant. Client `client.lead.withdraw.confirm` is a fixed client capability, never internally assignable. Backend enforces all state, identity, customer, version and range checks.
- Use forward-only migrations; never edit deployed migrations or reset development/production data. Database commands may target only the independently verified `backend/.env.test` test database. PowerShell processes running Node/pnpm must dot-load `Use-ProjectRuntime.ps1` and verify locked versions.
- Current is CORE-LD-007 until formal UI/API/backend/PostgreSQL/migration/real-account browser checks and independent Final Review pass. Do not implement LD-005/006, other archive types, cancellation/rejection or a full client portal. Do not push, merge, release or touch production.
- Risk route: Tasks 1–3 are high-risk and require `gpt-6-sol` implementation plus independent `gpt-6-sol` task review before integration. Tasks 4–6 are bounded execution for `gpt-6-luna`, with self-review and focused tests; the integrated candidate gets one independent `gpt-6-sol` Final Review. Root does not repeat passing focused suites without a risk signal.

---

### Task 1: Forward migration, Prisma relationships, and exact Actions

**Files:** `backend/prisma/schema.prisma`; new `backend/prisma/migrations/20260923012000_add_lead_withdrawal_actions/migration.sql` and `20260923013000_add_lead_withdrawal_history/migration.sql`; `backend/src/access-control/access-control.service.ts`, `prisma-access-control.store.ts`, `permission-catalog.ts`; `backend/src/modules/leads/core-ld-migration.spec.ts` and direct access-control tests.

**Interfaces produced:** `Lead.activeReviewDecisionId: string | null`; `Lead.reviewDecisions: LeadReviewDecision[]`; `Lead.activeReviewDecision: LeadReviewDecision | null`; `LeadWithdrawalApplication` and `LeadWithdrawalConfirmation`; enum values `LEAD_WITHDRAW_APPLY` and `CLIENT_LEAD_WITHDRAW_CONFIRM` mapped to `lead.withdraw.apply` and `client.lead.withdraw.confirm`.

- [ ] **Step 1 — RED:** Add migration/schema assertions for the two new enum values, removal of only the three per-lead decision unique constraints, backfill and composite FK of the active pointer, unique `(leadId, fromVersion)`, immutable application/confirmation tables, composite decision→application→confirmation/binding FKs and one-application-per-decision/one-confirmation-per-application constraints. Run `pnpm --filter @dev-cor/backend test src/modules/leads/core-ld-migration.spec.ts`; confirm a feature-missing failure.
- [ ] **Step 2 — GREEN:** Implement two forward migrations, Prisma relations and action mapping/catalog. The action migration commits before any statement uses the new PostgreSQL enum values. Grant the new internal action only through existing controlled bootstrap-role upgrade selection, not all `lead.push` holders; never expose the client action in internal role DTO/catalog. Keep old immutable triggers and receipt composite FK. Generate Prisma and run the focused migration/access-control tests plus backend typecheck.
- [ ] **Step 3 — database:** Against `backend/.env.test` only, apply all migrations from an empty temporary schema and upgrade the previous supported schema with old infringement/no-infringement decisions and receipts. Verify old rows/backfilled active pointers, failure rollback, cross-enterprise FK rejection and UPDATE/DELETE denial. Preserve the test database and report exact commands/results.
- [ ] **Step 4 — commit/review:** Self-review changed SQL and schema, `git diff --check`, commit; independent Sol reviewer must return `ACCEPTED` with zero open Critical/Important/Minor before Task 2.

### Task 2: Operator application Command and read projection

**Files:** `backend/src/modules/leads/lead.dto.ts`, `lead.controller.ts`, `lead.service.ts`, matching response DTO/OpenAPI and `lead.controller.spec.ts`/`lead.service.spec.ts`. A small lead-withdrawal projection helper may be created only if it eliminates duplicated mapping.

**Consumes:** Task 1 models and `lead.withdraw.apply`. **Produces:** `POST /api/v1/leads/:id/withdrawal-applications`, request `{ reason: string; expectedVersion: number }`, and operator detail `capabilities.withdrawApply`, current pending application and stable withdrawal/review history.

- [ ] **Step 1 — RED:** Add focused tests that prove absence of the route/Command, and specify valid application, no change to `ARCHIVED`/active decision, version+1, immutable fact/audit/snapshot, same-key replay, different-request conflict, stale/wrong-state/other-archive/other-department/no-Grant refusal, competing applications and injected fact/audit failure rollback. Run targeted lead controller/service Jest and observe the expected missing-feature failure.
- [ ] **Step 2 — GREEN:** Add strict DTO/OpenAPI, controller header validation and a Serializable Command following existing `push` lock/Grant/receipt patterns. Recheck authorization before replay. Use a unique application row for the durable response snapshot; response includes application ID, lead ID, status `ARCHIVED`, new version, normalized reason, applicant display name and server timestamp. Do not store a second mutable archive reason on `Lead`.
- [ ] **Step 3 — read:** Operator `get` still requires `lead.read` and returns current active decision plus safe application/confirmation history ordered by version then ID. `withdrawApply` is true only for an authorized operator viewing an unrequested active no-infringement archive. Add OpenAPI contract tests; run focused Jest, backend typecheck and `git diff --check`.
- [ ] **Step 4 — commit/review:** Commit the task; independent Sol review of Command, Grant, tenant scope, concurrency and receipt behavior must close all findings before Task 3.

### Task 3: Client confirmation, repeat review and exact client/material reads

**Files:** `backend/src/modules/leads/client-lead-review.dto.ts`, `client-lead-response.dto.ts`, `client-lead.controller.ts`, `client-lead.service.ts`; `backend/src/modules/materials/material.service.ts`; direct service/controller/material/OpenAPI tests and minimal Task-2 operator projection adjustments if required.

**Consumes:** active decision pointer and withdrawal facts. **Produces:** `POST /api/v1/client/leads/:id/withdrawal-confirmations` with `{ applicationId: UUID; expectedVersion: number }`, client `capabilities.confirmWithdrawal`, safe pending application/history projection, re-review after confirmation.

- [ ] **Step 1 — RED:** Add tests for original-enterprise confirmation by a different effective bound account; wrong enterprise/inactive account/binding/non-ADMITTED rejection; pending application and active-decision identity; same-key replay/changed request, version and concurrent confirmation races; injected confirmation failure rollback; then a second `NO_INFRINGEMENT` or `INFRINGEMENT` decision with all old decisions/receipts intact. Assert old review-key replay preserves its original snapshot. Run targeted client service/controller/material Jest and see feature-missing failures.
- [ ] **Step 2 — GREEN:** Add DTO/route, fixed client Action, Serializable confirmation after fresh CLIENT/binding/customer validation and lead row lock. Confirm only the pending application for the current active no-infringement decision; set `WAITING_REVIEW`, clear active pointer, version+1, insert immutable confirmation/snapshot atomically. Keep old review fingerprint; modify the existing review Command to create a new decision when current pointer is null and set its pointer in the same transaction. Do not UPDATE/DELETE historical facts.
- [ ] **Step 3 — queries/material:** Client pending list includes `WAITING_REVIEW` plus this enterprise's pending withdrawal; processed list excludes a pending application. Detail and screenshot authorization use current pointer/status, not any historical decision. Detail returns allowed history and application; no internal notes/teams/grants or other-company facts. Operator projection, if adjusted, follows `lead.read` scope. Run focused tests, backend typecheck, `git diff --check`.
- [ ] **Step 4 — commit/review:** Commit; independent Sol reviewer must close authorization, migration compatibility, state machine and historical-receipt findings before Task 4.

### Task 4: Minimal real operator and client UI

**Files:** `frontend/src/api/leads.ts`, `client-leads.ts` and direct API specs; `frontend/src/modules/leads/LeadDetailPage.vue`/spec; `frontend/src/modules/client/ClientLeadListPage.vue`/spec and `ClientLeadDetailPage.vue`/spec; shared styles only if existing tokens cannot express the new controls.

**Consumes:** Task 2/3 route and response contracts. **Produces:** genuine application and confirmation controls, pending-list entry, history rendering.

- [ ] **Step 1 — RED:** First add API decode/request tests and page tests for service-controlled capabilities, required reason, confirmation copy, loading/errors, same-key retry after uncertain network result, successful reload and second review visibility; run targeted Vitest to observe missing-behavior failures.
- [ ] **Step 2 — GREEN:** Wire existing request helper and Demo-aligned shared components. Operator detail explains application does not revoke archive; client pending list names the task, client detail explains confirmation and history. Disable duplicate submit, retain frozen payload/key on uncertain result, distinguish stale version from access denial, and do not rely on hidden buttons for security.
- [ ] **Step 3 — report:** Run focused Vitest, frontend typecheck and relevant format/lint; self-review and commit. Report changed files, commands/results, contract changes, risks and whether Sol attention is needed. No separate task reviewer absent escalation.

### Task 5: Real database/browser contract and migration regression

**Files:** `tests/e2e/core-leads.spec.ts`, `tests/support/core-lead-database.mjs` and `.d.mts`; related migration probe only. No production behavior changes unless a concrete failure exposes one, in which case escalate high-risk findings to root/Sol.

- [ ] **Step 1 — RED:** Extend actual PostgreSQL/Chromium tests for real operator login→application→customer logout/login→confirmation→second review→refresh/history/allowed screenshot, plus wrong-enterprise, revoked account/binding/Grant, old state/version, duplicate/altered keys, two-key races and injected fact/audit/receipt rollback. Add empty-schema and previous-supported-schema upgrade probes preserving old review facts.
- [ ] **Step 2 — GREEN/verify:** Use only the test DB resolved by `backend/.env.test`; deploy migrations without resetting development/production. Run `pnpm test:e2e:core-ld` after building the changed backend. Fix only bounded test/helpers; escalate application/security/concurrency/schema failures immediately. Report actual test count/results and commit.

### Task 6: Integrated candidate, review, gate and state closeout

**Files:** existing `docs/spec/v0.1/modules/leads.md`, `docs/spec/v0.1/VALIDATION.md`, `docs/feature-roadmap.md`, `docs/project-status.md`, `docs/context-snapshot.json`; only if outcomes justify them.

- [ ] **Step 1 — candidate:** Root checks task reports, changed-file/contract summaries, unresolved risks and `git diff --check`; run one integration `pnpm check:fast`. Freeze a clean candidate and dispatch independent Sol Final Review of the whole branch. Address findings as one fix wave, rerun affected tests and obtain reviewer closure.
- [ ] **Step 2 — Level 3:** On the stable candidate run `pnpm verify`, complete isolated PostgreSQL/Chromium E2E and migration upgrade/rollback checks. Reuse trustworthy same-tree tests; do not duplicate them simply for a second badge. Failure means 007 stays Current.
- [ ] **Step 3 — closeout:** Only after every browser/API/backend/migration/isolation/review gate passes, mark 007 complete, make 005 sole Current and 006 Next, record fixed code/tree evidence without attributing it to later documentation-only trees, run `pnpm spec:check`, `pnpm context:record`, `pnpm context:check:strict`, affected formatting and `git diff --check`, then commit. Do not push or merge without new authorization.

## Coverage cross-check

Tasks 1–3 establish immutable multi-round data, exact identity/permission, two transactional Commands and current-vs-history reads. Task 4 supplies both real-role entries. Task 5 proves the end-to-end chain, cross-enterprise isolation, retries, rollback and migrations. Task 6 independently reviews and formally gates the integrated tree; no later Slice is prebuilt.
