# Team Permission Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace bare team UUIDs with constrained Team master data and add enforceable management permissions plus a non-escalating role-assignment boundary.

**Architecture:** Extend the fixed permission catalog first, then transactionally backfill Team rows and composite foreign keys. Keep customer scope behavior intact while adding a focused organization service that serializes management writes, validates active Team bindings, enforces actual-scope grant coverage, audits changes, and invalidates target authorization revisions.

**Tech Stack:** TypeScript 5.9, NestJS 11, Prisma 7, PostgreSQL 17, Jest 30, Playwright 1.63, pnpm 11.27.

## Global Constraints

- Preserve existing data; never delete or null existing team references.
- Keep `CustomerProfileStatus` at `DRAFT`.
- Do not add future business schemas, generic policy languages, role levels, administrator bypasses, or frontend-only authorization.
- Every Node or pnpm command runs after `. .\Use-ProjectRuntime.ps1` and version verification.
- Database tests use only `backend/.env.test` and the compose-managed PostgreSQL test service.
- This is Level 3 / Q2: run focused negative database tests, full `pnpm verify`, full database E2E, and independent review before claiming verified.

---

### Task 1: Safe Team and Permission Migrations

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260920010000_add_management_permission_actions/migration.sql`
- Create: `backend/prisma/migrations/20260920020000_add_team_master_data/migration.sql`
- Modify: `tests/support/customer-database.mjs`
- Modify: `tests/e2e/customers.spec.ts`

**Interfaces:**

- Produces `TeamStatus`, `Team`, six new `PermissionAction` values, and composite Team foreign keys.
- Produces migration probes callable from the existing database E2E suite.

- [x] Write database tests that fail because Team relations, invalid-reference rejection, inactive-history behavior, cross-department UUID remapping, controlled bootstrap backfill, and atomic rollback do not exist.
- [x] Run the focused migration and integrity tests and confirm expected failures.
- [x] Add the Prisma model and two ordered SQL migrations. Migration A only commits enum values. Migration B locks reference tables, creates deterministic compatibility mappings, validates data, adds constraints, and narrowly backfills a structurally identified bootstrap role.
- [x] Regenerate Prisma Client and rerun the focused database tests until green.

### Task 2: Generic Permission Snapshot and Active Team Binding

**Files:**

- Modify: `backend/src/access-control/access-control.service.ts`
- Modify: `backend/src/access-control/prisma-access-control.store.ts`
- Modify: `backend/src/access-control/access-control.service.spec.ts`
- Modify: `backend/src/modules/customers/customer.service.spec.ts`
- Modify: `backend/src/modules/customers/customer.service.ts`

**Interfaces:**

- Produces fixed `PermissionAction` and `PermissionScope` application types.
- Produces management scope checks without changing existing customer query predicates.
- `authorizeNewCustomer` returns no Team binding when the membership Team is inactive, and rejects a TEAM-only create Grant rather than creating an unscoped customer.

- [x] Add failing unit tests for all six action mappings, undefined management scope denial, inactive Team creation, and unchanged historical customer editing.
- [x] Run the focused Jest suites and confirm failures are caused by missing behavior.
- [x] Generalize the snapshot types and Prisma mapping, load Team status, and implement the minimal management-scope predicates.
- [x] Rerun focused Jest suites and keep existing customer scope tests green.

### Task 3: Team Lifecycle and Grant-Bounded Role Assignment

**Files:**

- Create: `backend/src/access-control/organization.service.ts`
- Create: `backend/src/access-control/organization.service.spec.ts`
- Modify: `backend/src/access-control/access-control.module.ts`

**Interfaces:**

- Produces `createTeam(actor, { name })`, `setTeamStatus(actor, teamId, status)`, `assignRole(actor, command)`, and `changeMembershipTeam(actor, command)`.
- Commands reject self-assignment, cross-department targets, inactive Teams, uncovered grants, active TEAM assignment bypasses, and stale authorization contexts.

- [x] Add failing tests for permitted DEPARTMENT assignment; missing `role.assign`; cross-department and cross-Team targets; A-SELF-to-B-SELF; TEAM-to-SELF; uncovered management Grant; inactive Team binding; restore/rebind checks; and atomic audit/revision failure.
- [x] Run `organization.service.spec.ts` and confirm failures reflect the missing service.
- [x] Implement row-locked transactional commands, explicit scope coverage, Team lifecycle rules, audit writes, and authorization revision increments without role-name or user-ID checks.
- [x] Rerun organization and access-control Jest suites until green.

### Task 4: Bootstrap and Database Scope Regression

**Files:**

- Modify: `backend/src/auth/bootstrap-local-account.service.spec.ts`
- Modify: `backend/src/auth/bootstrap-local-account.service.ts`
- Modify: `tests/support/customer-database.mjs`
- Modify: `tests/e2e/customers.spec.ts`

**Interfaces:**

- New installations grant all fixed actions through ordinary RoleGrant rows.
- Database E2E proves Team FKs, inactive-history semantics, and cross-department/cross-Team denial at the final query boundary.

- [x] Extend the bootstrap test first and verify it fails for the six missing actions.
- [x] Update bootstrap to use the expanded enum and verify the focused auth test passes.
- [x] Add real-database fixtures and assertions for Team lifecycle, invalid bindings, cross-scope access, migration upgrade, and rollback.
- [x] Run the focused database E2E suite and resolve only failures caused by this slice.

### Task 5: Facts, Documentation, and Final Gates

**Files:**

- Modify: `docs/spec/v0.1/DECISIONS.md`
- Modify: `docs/spec/v0.1/TECHNICAL-DESIGN.md`
- Modify: `docs/spec/v0.1/VALIDATION.md`
- Modify: `docs/architecture.md`
- Modify: `docs/feature-roadmap.md`
- Modify: `docs/project-status.md`

**Interfaces:**

- Documents the implemented Team/FK/lifecycle and Grant Boundary facts, migration recovery limits, and remaining Next Slice work.

- [x] Update only current-state and affected authorization/data-model sections; retain `CustomerProfileStatus = DRAFT` and future Slice exclusions.
- [x] Run focused unit tests, focused database E2E, `pnpm check:fast`, and inspect the final diff.
- [x] Run fresh full `pnpm verify` and full `pnpm test:e2e:full` on the final tree.
- [x] Obtain independent Q2 review against the original request, design, diff, and fresh evidence; resolve blocking findings and rerun affected checks.
