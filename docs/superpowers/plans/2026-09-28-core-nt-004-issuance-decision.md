# CORE-NT-004 Implementation Plan

> **For agentic workers:** follow repository `docs/ai-coding.md` risk routing. Checkboxes track implementation, not dynamic acceptance state.

**Goal:** An authorized operator chooses issue or no issue for one infringement-confirmed notary matter, with a durable, auditable stage transition and real UI.

**Architecture:** Add two `NotaryMatterStage` values and a single immutable issuance-decision fact. A focused Command locks the matter, checks live internal authorization and review fact, then writes decision, stage/version, audit, and existing notary Command receipt in one transaction. Extend existing notary detail/list APIs and operator page; no new portal or generic workflow engine.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Vue 3, Vitest/Jest, Playwright Chromium.

## Global Constraints

- Follow [approved design](../specs/2026-09-28-core-nt-004-issuance-decision-design.md), notary Living Spec, SD-41 and the core field/material contract.
- Only `ISSUANCE_DECISION → WAITING_CERTIFICATE | WAITING_RETURN`; no NT-005/006 Command or case record.
- Real `backend/.env.test` PostgreSQL only; never reset development/production data or alter executed migrations.
- Test-first for behavior; use focused checks during development. Freeze one candidate after independent review, then run its required Level 3 gate if the change alters permission computation or schema/history risk; otherwise follow the verified Level 2 rule and required migration/browser evidence.

## Task 1: Decision model, authorization and Command

**Files:** `backend/prisma/schema.prisma`, new `backend/prisma/migrations/<timestamp>_add_notary_issuance_decision/migration.sql`, `backend/src/access-control/permission-catalog.ts`, `backend/src/access-control/prisma-access-control.store.ts`, `backend/src/access-control/access-control.service.ts`, `backend/src/modules/leads/notary-issuance-decision.service.ts`, adjacent focused specs.

**Interface:** `decide(actor, matterId, idempotencyKey, { decision: 'ISSUE' | 'NO_ISSUE', expectedVersion: number })` returns `{ id, stage, version, issuanceDecision: { decision, actorDisplayName, decidedAt } }`.

- [x] Write RED tests for both choices, each refusal, replay/conflict, concurrency and rollback; verify expected RED with focused Jest.
- [x] Add forward migration and matching Prisma schema: stages, Action, one-per-matter immutable decision with actor/department/review linkage. Reuse existing notary receipt and audit records.
- [x] Implement row-locked, serializable Command with authorize-before-replay, conditional version update, transactionally bound fact/audit/receipt; verify focused GREEN and database failure-injection behavior.
- [x] Review migration from empty and previous supported schema, including old rows and constraints; independently review high-risk task before integration.

## Task 2: API and read projections

**Files:** `backend/src/modules/leads/lead-notary.controller.ts`, `lead-notary.dto.ts`, `lead-notary.service.ts`, `notary-list.dto.ts`, `notary-list.service.ts`, `notary-opening-review-read.ts`, `client-notary.service.ts`, `lead.module.ts`, direct contract/read specs.

- [x] Write RED API and read tests for decision response, stage/detail consistency, stage counts and constrained client historical visibility.
- [x] Add `POST /api/v1/notary-matters/:id/issuance-decision`, strict DTO/OpenAPI and existing key validation; extend read-only projections and stage invariants.
- [x] Verify focused backend tests and permission catalog compatibility; no action routes for pending certificate/return.

## Task 3: Real operator UI and browser chain

**Files:** `frontend/src/api/notary.ts`, `frontend/src/modules/leads/NotaryMatterDetailPage.vue`, `NotaryMatterListPage.vue`, `frontend/src/app/AppShell.vue`, related specs, `tests/e2e/core-leads.spec.ts`, support fixture only as needed.

- [x] Write RED decoder/component tests for the two stages, capability, immutable decision display and submit errors.
- [x] Implement two-choice confirmation with consequences, loading and stable error feedback; update stage navigation/counts and read-only historical display.
- [x] Run focused frontend tests, typecheck, `pnpm check:fast`, migration probe and isolated database/browser chain. Verify refresh/re-login and no premature NT-005/006 entry.

## Candidate and closure

- [x] Integrate task changes, independent final Review, close findings, synchronize changed contract and freeze candidate.
- [x] Run applicable official gate and isolated PostgreSQL/Chromium E2E; record candidate commit/tree and actual evidence in `VALIDATION.md`.
- [x] Only after full UI/API/DB/permission/browser acceptance, mark NT-004 complete, advance unique Current/Next, explain any context drift, run `context:record` and `context:check:strict`. Do not push, merge or deploy without fresh authorization.
