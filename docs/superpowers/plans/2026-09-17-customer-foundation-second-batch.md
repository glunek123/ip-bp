# Customer Foundation Second Batch Implementation Plan

> **For Codex:** Execute this plan with the executing-plans workflow and red-green-refactor. This plan records the already-authorized scope; it is not a new approval gate.

**Goal:** Deliver the smallest usable operations-side loop for editing customer draft basics, enforcing the approved department-scoped duplicate rules, and recording modification audit facts against real PostgreSQL.

**Architecture:** Extend the existing Customer Module, configurable Grant evaluator, shared audit table, direct Vue customer pages, and current PostgreSQL schema. Authorization remains action-plus-scope on every request; duplicate checks and optimistic writes run on the server and are protected by database constraints where applicable.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Vue 3, Element Plus, Jest, Vitest, Playwright, pnpm.

## Fixed scope and gates

- Base checkpoint: `e811747` on `codex/operations-customer-foundation-impl`.
- Spec basis: REQ-CU-001 / AC-CU-001, REQ-XM-001/005/006, SD-22/28/29/33/34, TD-SLICE-CU-BASE-01 rev3, T01/T02/T03/T09.
- Included fields: customer name, customer type, identity type, identity number, issuing country or region, category, and region on a draft customer.
- Included operations: read current draft, edit within one effective Grant scope, query duplicate candidates, reject an exact identity duplicate in the same department, require one reason for a same-name override, reject stale versions, and write immutable modification/override audit events in the same transaction.
- Excluded: formal admission, contacts, evidence/material upload or versioning, critical corrections to an admitted customer, permission administration UI, cases, fees, settlement, reports, production migration, release, and deployment.
- Independent Q2 review was dispatched separately and returned `ACCEPTED` on 2026-09-17 after two blocked remediation rounds (Critical 0, Important 0). This plan does not treat implementer self-review as approval, and the accepted internal scope does not include E01/E02 or production release.
- E01 requires the real identity provider, protocol/issuer/client/audience/claim mapping, logout/session/revocation behavior, test tenant/accounts, and secret delivery route. It blocks real-login integration only; this batch uses the explicitly test-only identity adapter.
- E02 requires the private object-store provider/endpoint/region/bucket, credentials route, encryption/key ownership, signed-link policy, malware inspection boundary, retention/backup/restore evidence, and test bucket. It blocks customer evidence and admission only; no object-storage code is added here.

---

### Task 1: CUST-FND-005 — Backend edit, duplicate, and audit contract

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260917*_add_customer_editing/migration.sql`
- Modify: `backend/src/access-control/access-control.service.ts`
- Modify: `backend/src/access-control/prisma-access-control.store.ts`
- Modify: `backend/src/access-control/*.spec.ts`
- Modify: `backend/src/modules/customers/customer.dto.ts`
- Modify: `backend/src/modules/customers/customer.service.ts`
- Modify: `backend/src/modules/customers/customer.controller.ts`
- Modify: `backend/src/modules/customers/*.spec.ts`

**Steps:**

1. Add failing unit/HTTP tests for the edit action, scoped 404, stale version, exact-identity conflict, same-name reason requirement, successful update, and same-transaction audit rollback.
2. Run focused backend tests and confirm the new assertions fail for missing behavior.
3. Add the minimum Prisma fields, department-scoped identity uniqueness, permission enum action, DTOs, duplicate query, PATCH endpoint, service rules, optimistic version update, and audit writes.
4. Map database uniqueness races to stable `CUSTOMER_IDENTITY_DUPLICATE` responses without returning another department's data.
5. Re-run focused backend tests, Prisma generate, typecheck, lint, and format checks.

**Acceptance:** An authorized actor edits an accessible draft; an unauthorized action returns 403; an out-of-scope target returns the same non-leaking 404 as missing; exact identity duplicates in one department never create two accepted records; same-name updates require and audit a reason; an old version cannot overwrite current data; a failed customer or audit write leaves neither half committed.

---

### Task 2: CUST-FND-006 — Operations customer edit page

**Files:**

- Modify: `frontend/src/api/customers.ts`
- Modify: `frontend/src/api/customers.spec.ts`
- Create: `frontend/src/modules/customers/CustomerEditPage.vue`
- Create: `frontend/src/modules/customers/CustomerEditPage.spec.ts`
- Modify: `frontend/src/modules/customers/CustomerNewPage.vue`
- Modify: `frontend/src/modules/customers/CustomerNewPage.spec.ts`
- Modify: `frontend/src/modules/customers/CustomerDetailPage.vue`
- Modify: `frontend/src/modules/customers/CustomerDetailPage.spec.ts`
- Modify: `frontend/src/app/router.ts`
- Modify: `frontend/src/styles/global.css` only if existing classes cannot express the form.

**Steps:**

1. Add failing API/component tests for loading the edit form, capability-gated entry, save/disable behavior, same-name inline reason on create and edit, identity duplicate, stale version, retained input after failure, and successful return to detail.
2. Run focused frontend tests and confirm failure for absent behavior.
3. Implement the typed PATCH/duplicate API and one direct `/customers/:id/edit` page using the existing customer form style and error vocabulary.
4. Keep the normal path one page and one save action; show the reason input only after a same-name conflict and do not add admission/material controls.
5. Re-run focused frontend tests, typecheck, lint, format, and build.

**Acceptance:** A permitted operations user edits basic draft information without a new workflow; server conflicts are actionable and preserve input; edit is absent when the backend says the action is unavailable; the page never treats hidden controls as authorization.

---

### Task 3: CUST-FND-007 — PostgreSQL and browser verification

**Files:**

- Modify: `tests/e2e/customers.spec.ts`
- Modify: `docs/security/customer-foundation-q2-review.md`
- Modify: `docs/spec/v0.1/READINESS.md`
- Modify: `docs/spec/v0.1/modules/customers.md`
- Modify: `docs/project-status.md`
- Modify: `docs/context-snapshot.json`

**Steps:**

1. Add failing real-PostgreSQL/Playwright cases for department-scoped identity uniqueness, cross-department non-leakage, same-name override, version conflict, edit revocation, modification audit, and transaction rollback.
2. Start `postgres-test`, apply all migrations, and prove the database schema is current.
3. Run the browser path against the real backend/database with explicit test identities; do not report it as E01.
4. Run `pnpm verify`, then `pnpm test:e2e`; re-run both if code/config changes after verification.
5. Record actual commands, counts, independent-Q2 conclusion, E01/E02 inputs/blockers, and remaining release limits. Run `pnpm context:record` only after the final verified state is accurate.

**Acceptance:** Migration and E2E evidence proves the edit/deduplicate/audit behavior on real PostgreSQL, including rollback and department isolation. Independent Q2 findings are resolved or explicitly leave the affected scope pending; E01/E02 remain separately scoped; nothing is released.

## Execution result

- CUST-FND-005: `IMPLEMENTED_VERIFIED_DB` — backend unit/HTTP tests and migrations cover edit, duplicate rules, optimistic version, authorization and audit atomicity.
- CUST-FND-006: `IMPLEMENTED_VERIFIED_UI` — direct operations edit page, detail capability and same-name retry are covered by Vitest and the real browser path.
- CUST-FND-007: `IMPLEMENTED_VERIFIED_INTERNAL_INTEGRATION` — six migrations are current and Playwright 25/25 passes on the isolated PostgreSQL test database, including migration rollback, partial PATCH, normalized duplicate matching, hidden-scope non-disclosure, concurrent identity/name protection, and safe audit differences.
- Independent Q2: the first two reviews returned `BLOCKED`; after remediation, the final independent review returned `ACCEPTED` with Critical 0 and Important 0. Current scope is `IMPLEMENTED_VERIFIED_INTERNAL_INTEGRATION`, not production approval.
- E01/E02: still separately blocked by the inputs recorded above. No production migration, release or deployment occurred.
