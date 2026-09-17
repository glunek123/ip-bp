# Customer Foundation First Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not dispatch subagents unless the user explicitly authorizes delegation.

**Goal:** Deliver the smallest testable flow in which an authorized operator creates a customer draft, reads it only within the granted department scope, and sees the automatically recorded creation event.

**Architecture:** Keep one NestJS modular monolith and one Vue application. A minimal access-control module supplies trusted `ActorContext` and database query scope; the customer module owns draft rules and writes the customer plus shared audit event in one PostgreSQL transaction. Frontend pages use the existing HTTP wrapper and preserve the current direct list/new/detail interaction style.

**Tech Stack:** Node 24.21.0, pnpm 11.27.0, NestJS 11, Prisma 7, PostgreSQL 17, Vue 3, Vue Router 4, Element Plus 2.14.5, Jest/Supertest, Vitest/Vue Test Utils, Playwright.

## Global Constraints

- Base ref: `ce7d6f1`; implementation runs on `codex/operations-customer-foundation-impl`.
- Approved Spec: `REQ-XM-001/005/006`, `REQ-CU-001`, `AC-XM-001/005/006`, `AC-CU-001`, `SD-22/28/29/31/33/34`, `TD-AUTHZ-01`, `TD-TRACE-UX-01`, `TD-SLICE-CU-BASE-01 rev3`.
- The user explicitly authorized business code, development-database migrations, automated tests and necessary documentation synchronization on 2026-09-16 via the referenced conversation “收口权限设计”. Production changes, production data, real-account grants and out-of-scope features remain excluded.
- Shared PostgreSQL tables must enforce department scope in every customer query. Frontend hiding is never authorization.
- Role names are editable templates; authorization evaluates one grant that covers both action and scope. This batch does not build the permission administration UI.
- The real SSO adapter remains `INTEGRATION_BLOCKED` by E01. Tests use an explicit test identity adapter and must not be reported as real authentication.
- Customer evidence upload/admission remains outside this batch and `INTEGRATION_BLOCKED` by E02. No real certificate data is used.
- No new approval flow, workflow engine, policy language, file center, case, settlement, report, or OCR capability.
- Every implementation task follows red-green-refactor and ends with a separate reviewable commit.

---

### Task 1: CUST-FND-001 — Q2 Security Gate

```yaml
task_id: CUST-FND-001
spec_refs: REQ-XM-001/005/006, AC-XM-001/005/006, SD-28/31/33/34, TD-AUTHZ-01, TD-TRACE-UX-01
base_ref: ce7d6f1
scope: docs/security/customer-foundation-q2-review.md, docs/project-status.md
risk: Q2
acceptance: implementation-gate review fixes or accepts every authorization, department-isolation, audit, session-revision and sensitive-data boundary; final Q2 VERIFIED still requires an independent security review
checks: pnpm spec:check; pnpm context:check; pnpm format:check
status: COMPLETED
result_ref: task commit `docs: complete customer foundation Q2 gate`
evidence: docs/security/customer-foundation-q2-review.md
```

**Files:**

- Create: `docs/security/customer-foundation-q2-review.md`
- Modify: `docs/project-status.md`

**Interfaces:**

- Consumes: `authorize(actor, action, resourceFacts)` and `buildQueryScope(actor, action, resourceType)` from TD-AUTHZ-01.
- Produces: an accepted or blocked decision for the exact Task 2–4 scope; it does not approve real SSO, object storage, production migration, or release.

- [x] **Step 1: Record the review scope and threat cases**

  The review file must contain this decision table with a result and evidence for every row:

  ```markdown
  | Boundary           | Required result                                                                                                     |
  | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
  | Trusted actor      | departmentId, userId and authorizationRevision come only from the identity adapter                                  |
  | Grant evaluation   | one grant covers both customer action and target scope; grants are not unioned into broader access                  |
  | Query isolation    | customer list/detail apply department scope in the database query and return non-leaking 404 for inaccessible IDs   |
  | Mutation isolation | departmentId is server-derived; create cannot submit another department                                             |
  | Revocation         | every request re-reads or validates authorizationRevision; a revoked grant fails on the next request                |
  | Audit              | customer and audit event commit atomically; audit contains stable IDs and no certificate body or full personal data |
  | Test identity      | enabled only in the test environment and impossible to activate in production configuration                         |
  | Migration          | additive local/test migration only; no shared or production database execution is authorized                        |
  ```

- [x] **Step 2: Review against concrete negative tests**

  Require these exact cases before acceptance: unauthenticated `401`; missing action `403`; same-department but outside scope non-leaking `404`; cross-department list returns zero foreign rows; cross-department detail `404`; forged `departmentId` ignored/rejected; revoked authorization fails on the next request; customer write rollback leaves no audit event and audit failure leaves no customer.

- [x] **Step 3: Mark the gate accurately**

  Set the review result to `ACCEPTED_FOR_INTERNAL_IMPLEMENTATION`, `CHANGES_REQUIRED`, or `BLOCKED`. Only the first result can unlock Task 2 after explicit coding authorization. Record reviewer, date, reviewed commit, exclusions, and concrete findings; do not write “passed” without evidence.

- [x] **Step 4: Run documentation checks**

  Run:

  ```powershell
  . .\Use-ProjectRuntime.ps1
  pnpm spec:check
  pnpm context:record
  pnpm context:check
  pnpm format:check
  ```

  Expected: all commands pass; no source, schema, migration, or business test file is changed.

- [x] **Step 5: Commit**

  ```powershell
  git add docs/security/customer-foundation-q2-review.md docs/project-status.md docs/context-snapshot.json
  git commit -m "docs: complete customer foundation Q2 gate"
  ```

---

### Task 2: CUST-FND-002 — Minimal Configurable Authorization Core

```yaml
task_id: CUST-FND-002
spec_refs: REQ-XM-001/005, AC-XM-001/005, SD-28/29/31/33, TD-AUTHZ-01
base_ref: result_ref from CUST-FND-001
scope: backend/prisma/schema.prisma, backend/prisma/migrations/*, backend/src/access-control/*, backend/src/app.module.ts
risk: Q2
acceptance: a test actor can read/create only within one valid grant and department; two grants never combine into broader edit access; revocation is effective on the next authorization call
checks: backend Jest unit/integration tests; pnpm typecheck; pnpm lint
status: IMPLEMENTED_UNVERIFIED_DB
result_ref: task commit `feat: add minimal configurable customer authorization`; PostgreSQL migration evidence is blocked by the unavailable local Docker daemon
evidence: backend/src/access-control/*.spec.ts and migration diff
```

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260916120000_add_access_control/migration.sql`
- Create: `backend/src/access-control/actor-context.ts`
- Create: `backend/src/access-control/access-control.service.ts`
- Create: `backend/src/access-control/access-control.service.spec.ts`
- Create: `backend/src/access-control/access-control.module.ts`
- Create: `backend/src/access-control/test-identity.adapter.ts`
- Create: `backend/src/access-control/test-identity.adapter.spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**

- Produces:

  ```ts
  export type ActorContext = {
    userId: string;
    departmentId: string;
    authorizationRevision: number;
  };

  export type CustomerAction =
    | 'customer.read'
    | 'customer.create-draft';

  export type CustomerScope = 'self' | 'team' | 'department';

  authorizeCustomer(
    actor: ActorContext,
    action: CustomerAction,
    facts: { departmentId: string; responsibleUserId?: string; teamId?: string },
  ): Promise<void>;

  buildCustomerScope(
    actor: ActorContext,
    action: CustomerAction,
  ): Promise<CustomerWhereInput>;
  ```

- [x] **Step 1: Write failing authorization tests**

  Add tests proving that one department-read grant plus one self-create grant does not produce department-create permission; a foreign department is denied; a disabled assignment and stale `authorizationRevision` are denied; the test identity adapter throws unless `NODE_ENV === 'test'`.

- [x] **Step 2: Run the focused tests and verify RED**

  Run:

  ```powershell
  . .\Use-ProjectRuntime.ps1
  pnpm --filter @dev-cor/backend test -- access-control.service.spec.ts test-identity.adapter.spec.ts
  ```

  Expected: FAIL because the access-control module and schema do not exist.

- [x] **Step 3: Add the minimal schema and service**

  Add only department, user, role-template, role-grant and role-assignment records needed by the two customer actions. Store action and scope as constrained enums, version role/assignment changes, and derive query predicates from the same grant evaluation used by commands. Do not add a generic expression language or permission UI.

- [ ] **Step 4: Generate the local/test migration and verify GREEN**

  Run against the dedicated test database:

  ```powershell
  . .\Use-ProjectRuntime.ps1
  pnpm db:test:up
  pnpm --filter @dev-cor/backend db:generate
  pnpm --filter @dev-cor/backend test -- access-control.service.spec.ts test-identity.adapter.spec.ts
  ```

  Expected: all focused tests pass, including the negative cross-department and stale-revision cases.

  Current checkpoint: Prisma Client generation and all 7 focused tests pass. `pnpm db:test:up` and migration execution remain unverified because Docker Desktop's daemon did not become ready and the local service could not be started with the available permissions.

- [x] **Step 5: Run task checks and commit**

  ```powershell
  . .\Use-ProjectRuntime.ps1
  pnpm typecheck
  pnpm lint
  git add backend/prisma backend/src/access-control backend/src/app.module.ts docs/project-status.md docs/context-snapshot.json
  git commit -m "feat: add minimal configurable customer authorization"
  ```

---

### Task 3: CUST-FND-003 — Customer Draft, Scoped Reads, and Atomic Audit

```yaml
task_id: CUST-FND-003
spec_refs: REQ-CU-001, AC-CU-001, REQ-XM-006, AC-XM-006, SD-22/29/34, TD-SLICE-CU-BASE-01 rev3, TD-TRACE-UX-01
base_ref: result_ref from CUST-FND-002
scope: backend/prisma/schema.prisma, backend/prisma/migrations/*, backend/src/modules/customers/*, backend/src/modules/audit/*, backend/src/app.module.ts
risk: Q2
acceptance: an authorized actor creates a name-only draft, lists/reads it inside scope, cannot see a foreign-department draft, and gets one immutable shared audit event in the same transaction
checks: customer service tests; customer HTTP tests; PostgreSQL rollback/isolation tests; pnpm typecheck; pnpm lint
status: IMPLEMENTED_UNVERIFIED_DB
result_ref: working tree after a91b4e2; customer unit/HTTP tests pass, database evidence blocked by unavailable Docker daemon
evidence: backend/src/modules/customers/*.spec.ts; docs/spec/v0.1/VALIDATION.md
```

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260916123000_add_customer_draft/migration.sql`
- Create: `backend/src/modules/audit/audit-event.repository.ts`
- Create: `backend/src/modules/customers/customer.dto.ts`
- Create: `backend/src/modules/customers/customer.service.ts`
- Create: `backend/src/modules/customers/customer.service.spec.ts`
- Create: `backend/src/modules/customers/customer.controller.ts`
- Create: `backend/src/modules/customers/customer.controller.spec.ts`
- Create: `backend/src/modules/customers/customer.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**

- Consumes: `ActorContext`, `authorizeCustomer`, and `buildCustomerScope` from Task 2.
- Produces:

  ```ts
  type CreateCustomerDraft = { name: string; category?: string; region?: string };
  type CustomerSummary = {
    id: string;
    name: string;
    profileStatus: 'draft';
    departmentId: string;
    responsibleUserId: string;
    version: number;
    updatedAt: string;
  };

  createDraft(actor: ActorContext, input: CreateCustomerDraft): Promise<CustomerSummary>;
  list(actor: ActorContext, page: number, pageSize: number): Promise<{
    items: CustomerSummary[];
    total: number;
    page: number;
    pageSize: number;
  }>;
  get(actor: ActorContext, customerId: string): Promise<CustomerSummary>;
  ```

- [x] **Step 1: Write failing domain and HTTP tests**

  Tests must cover trimmed non-empty name, server-derived department/responsible user, default `draft`, stable pagination order `updatedAt desc, id asc`, unknown DTO fields rejected, unauthenticated `401`, missing create action `403`, inaccessible ID non-leaking `404`, and one `customer.draft-created` shared audit event.

- [ ] **Step 2: Add failing transaction and isolation tests**

  With two departments in the test PostgreSQL database, prove that list and detail never return the other department. Force audit insertion to fail and assert that no customer remains; force customer insertion to fail and assert that no audit event remains.

- [x] **Step 3: Run focused tests and verify RED**

  ```powershell
  . .\Use-ProjectRuntime.ps1
  pnpm db:test:up
  pnpm --filter @dev-cor/backend test -- customer.service.spec.ts customer.controller.spec.ts
  ```

  Expected: FAIL because customer and shared-audit modules do not exist.

- [x] **Step 4: Implement the minimal customer transaction**

  Create only the fields used by the interface. `departmentId`, `responsibleUserId`, status, version, timestamps and audit actor are server-derived. The customer and `AuditEvent` append occur inside one Prisma transaction; there is no `CustomerAuditEvent` table.

- [x] **Step 5: Verify GREEN and commit**

  ```powershell
  . .\Use-ProjectRuntime.ps1
  pnpm --filter @dev-cor/backend test -- customer.service.spec.ts customer.controller.spec.ts
  pnpm typecheck
  pnpm lint
  git add backend/prisma backend/src/modules backend/src/app.module.ts docs/project-status.md docs/context-snapshot.json
  git commit -m "feat: add scoped customer draft backend"
  ```

---

### Task 4: CUST-FND-004 — Direct Customer Draft UI and Cross-End Acceptance

```yaml
task_id: CUST-FND-004
spec_refs: REQ-CU-001, AC-CU-001, REQ-XM-001/006, SD-22/29/34, TD-SLICE-CU-BASE-01 rev3
base_ref: result_ref from CUST-FND-003
scope: frontend/src/api/customers*, frontend/src/modules/customers/*, frontend/src/app/router.ts, tests/e2e/customer-draft.spec.ts
risk: Q2
acceptance: an allowed test user opens the customer list, creates a name-only draft in one submit, sees its detail/history, and a second-department user cannot find or open it
checks: frontend Vitest; Playwright customer flow; pnpm verify
status: PLANNED
result_ref: none; task is not implemented
evidence: frontend customer component tests and tests/e2e/customer-draft.spec.ts
```

**Files:**

- Create: `frontend/src/api/customers.ts`
- Create: `frontend/src/api/customers.spec.ts`
- Create: `frontend/src/modules/customers/CustomerListPage.vue`
- Create: `frontend/src/modules/customers/CustomerListPage.spec.ts`
- Create: `frontend/src/modules/customers/CustomerNewPage.vue`
- Create: `frontend/src/modules/customers/CustomerNewPage.spec.ts`
- Create: `frontend/src/modules/customers/CustomerDetailPage.vue`
- Create: `frontend/src/modules/customers/CustomerDetailPage.spec.ts`
- Modify: `frontend/src/app/router.ts`
- Create: `tests/e2e/customer-draft.spec.ts`

**Interfaces:**

- Consumes: `GET /api/v1/customers`, `POST /api/v1/customers`, and `GET /api/v1/customers/:id` from Task 3 through the existing `requestJson` wrapper.
- Produces routes `/customers`, `/customers/new`, `/customers/:id`; it does not add edit, duplicate override, upload, admission, or permission administration UI.

- [ ] **Step 1: Write failing API decoder tests**

  Verify that valid list/detail/create responses decode, malformed responses become `INVALID_RESPONSE`, and backend `401/403/404` codes remain available to page behavior.

- [ ] **Step 2: Write failing component tests**

  Test separate loading, empty, failure and success states; one-click draft submit; blank-name field error; submit button disabled while pending; retained input after failure; detail shows `草稿` and a folded creation-history row; forbidden actions are absent for the test actor without create permission.

- [ ] **Step 3: Run focused tests and verify RED**

  ```powershell
  . .\Use-ProjectRuntime.ps1
  pnpm --filter @dev-cor/frontend test -- customers
  ```

  Expected: FAIL because the customer API and pages do not exist.

- [ ] **Step 4: Implement the direct pages**

  Add only list, new and detail routes. Reuse the existing app router, HTTP wrapper, Element Plus components and CSS tokens. Keep list → new → save → detail as the primary path; do not add a wizard, approval step, dashboard, file controls, or configurable form engine.

- [ ] **Step 5: Verify component tests and write the failing E2E**

  The E2E creates `测试客户甲`, verifies its draft detail and creation history, switches to the second synthetic department, verifies list exclusion and direct URL `404`, then switches back and verifies access remains. Run once to confirm the flow fails before final wiring.

- [ ] **Step 6: Complete wiring, run full checks, and commit**

  ```powershell
  . .\Use-ProjectRuntime.ps1
  pnpm db:test:up
  pnpm --filter @dev-cor/frontend test -- customers
  pnpm build
  pnpm test:e2e -- --grep "customer draft"
  pnpm verify
  git add frontend/src tests/e2e/customer-draft.spec.ts docs/project-status.md docs/spec/v0.1/COVERAGE.md docs/spec/v0.1/VALIDATION.md docs/context-snapshot.json
  git commit -m "feat: deliver customer draft first batch"
  ```

  Expected: focused component tests, the customer draft Playwright flow, and `pnpm verify` all pass. Validation must state that the identity is synthetic and real E01/E02 integration remains unverified.

## Excluded Next Batches

- Customer edit, optimistic concurrency, exact-number duplicate blocking and same-name override.
- Stable material plus exact `contentVersionId`, real object storage, certificate upload and formal admission.
- Permission administration UI, case members, export/download authorization, real SSO and production rollout.

Each excluded batch requires its own reviewed scope and acceptance tests; exclusion does not weaken the corresponding approved Spec.
