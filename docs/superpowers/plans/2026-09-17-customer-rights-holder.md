# Customer Rights Holder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the smallest operations-side flow for creating a named rights holder under a customer, viewing it, and linking the same stable holder to another authorized customer without exposing unrelated customer relationships.

**Architecture:** Keep the external seam inside the existing Customer Module while placing rights-holder implementation in focused controller, DTO, and service files. PostgreSQL stores a department-owned `RightsHolder`, a department-consistent many-to-many link, and a minimal idempotency receipt; every read is anchored to an authorized customer and every write increments that customer's optimistic version in the same transaction as audit facts.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Vue 3, Element Plus, Jest, Vitest, Playwright, pnpm.

## Global Constraints

- Rights-holder name is required and nonblank; credit code, address, legal representative, and duty are optional and may be omitted.
- Do not add automatic rights-holder duplicate detection, uniqueness on name or credit code, editing, deletion, unlinking, default-holder rules, or a department-wide holder directory.
- Read access requires `customer.read` on the anchor customer. Create/link requires `customer.edit-routine` on the target customer. Linking an existing holder also requires that holder to be reachable through at least one customer in the actor's current read scope.
- Customer, holder, link, and command receipt must share the same trusted department through database constraints; client-supplied department, actor, version result, or audit fields are rejected.
- Create/link, customer version increment, and shared audit events are atomic. POST commands require `Idempotency-Key`; same key and fingerprint replays the stored result, while a different fingerprint returns `IDEMPOTENCY_KEY_REUSED`.
- Keep E01 test identities explicitly test-only. This slice has no E02/file dependency and performs no production migration, deployment, or real-data operation.

---

### Task 1: CUST-RH-001A — PostgreSQL Model and Backend Interface

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260917070000_add_customer_rights_holders/migration.sql`
- Create: `backend/src/modules/customers/rights-holder.dto.ts`
- Create: `backend/src/modules/customers/rights-holder.service.ts`
- Create: `backend/src/modules/customers/rights-holder.service.spec.ts`
- Create: `backend/src/modules/customers/rights-holder.controller.ts`
- Create: `backend/src/modules/customers/rights-holder.controller.spec.ts`
- Modify: `backend/src/modules/customers/customer.module.ts`

**Interfaces:**

- Consumes: `AccessControlService.buildCustomerScope`, `tryBuildCustomerScope`, `DatabaseService`, `ActorContext`, and existing `customer.read` / `customer.edit-routine` grants.
- Produces:

```ts
type RightsHolderSummary = {
  id: string;
  name: string;
  credit: string | null;
  address: string | null;
  legalRepresentative: string | null;
  duty: string | null;
  updatedAt: string;
};

type RightsHolderCommandResult = {
  holder: RightsHolderSummary;
  linkId: string;
  customerVersion: number;
};

createAndLink(actor, customerId, idempotencyKey, input);
linkExisting(actor, customerId, idempotencyKey, input);
list(actor, customerId, page, pageSize);
get(actor, customerId, rightsHolderId);
findLinkable(actor, customerId, query, page, pageSize);
```

- [ ] **Step 1: Write failing service tests for the deep Module Interface**

Add focused Jest cases that exercise real service behavior through its public methods:

```ts
it('creates one holder, one link, two audit facts, and one customer version increment atomically', async () => {
  const result = await service.createAndLink(actor, customerId, key, {
    expectedCustomerVersion: 1,
    name: '  权利主体甲  ',
    credit: ' 91310000RH001 ',
  });
  expect(result).toMatchObject({
    customerVersion: 2,
    holder: { name: '权利主体甲' },
  });
  expect(linkCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ departmentId: actor.departmentId }),
    }),
  );
  expect(auditCreate).toHaveBeenCalledTimes(2);
});

it('does not reveal or link a guessed holder outside the actor read scope', async () => {
  await expect(
    service.linkExisting(actor, targetCustomerId, key, {
      expectedCustomerVersion: 1,
      rightsHolderId: hiddenHolderId,
    }),
  ).rejects.toMatchObject({ response: { code: 'RIGHTS_HOLDER_NOT_FOUND' } });
});
```

Cover blank name, optional fields, same holder linked to two authorized customers, non-leaking customer/holder 404s, cross-department holder, repeated association, stale customer version, revoked grant, identical idempotency replay, conflicting idempotency reuse, link/audit/version rollback, and responses that omit other customer associations.

- [ ] **Step 2: Write failing HTTP contract tests**

Test all five routes with a trusted actor, DTO whitelist, UUID pipes, pagination, required `Idempotency-Key`, and stable error codes:

```ts
await request(app.getHttpServer())
  .post(`/api/v1/customers/${customerId}/rights-holders`)
  .set('Authorization', 'Bearer allowed-token')
  .set('Idempotency-Key', commandKey)
  .send({
    expectedCustomerVersion: 1,
    name: ' 主体甲 ',
    departmentId: 'forged',
  })
  .expect(400);
expect(createAndLink).not.toHaveBeenCalled();
```

- [ ] **Step 3: Run the focused tests and verify RED**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/backend test -- rights-holder.service.spec.ts rights-holder.controller.spec.ts
```

Expected: FAIL because the rights-holder DTO, service, controller, Prisma delegates, and routes do not exist.

- [ ] **Step 4: Add the forward-only schema and migration**

Add `RightsHolder`, `CustomerRightsHolderLink`, and `RightsHolderCommandReceipt`. The migration must include these database invariants:

```sql
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_id_department_id_key" UNIQUE ("id", "department_id");

ALTER TABLE "rights_holders"
  ADD CONSTRAINT "rights_holders_name_nonblank_check"
  CHECK (NULLIF(BTRIM("name"), '') IS NOT NULL);

ALTER TABLE "customer_rights_holder_links"
  ADD CONSTRAINT "customer_rights_holder_links_customer_department_fkey"
  FOREIGN KEY ("customer_id", "department_id")
  REFERENCES "customers"("id", "department_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "customer_rights_holder_links_holder_department_fkey"
  FOREIGN KEY ("rights_holder_id", "department_id")
  REFERENCES "rights_holders"("id", "department_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "customer_rights_holder_links_customer_holder_key"
  UNIQUE ("customer_id", "rights_holder_id");
```

The command receipt has a unique `(department_id, actor_user_id, action, idempotency_key)` key, request SHA-256 fingerprint, result holder/link/customer IDs and result customer version. It uses composite foreign keys so a receipt cannot point across departments.

- [ ] **Step 5: Implement the minimal DTO, Interface, transaction, and routes**

Normalize strings by trimming only. Hash a canonical command payload with Node `createHash('sha256')`; check an existing receipt after current authorization and before the version gate. Use conditional customer `updateMany({ version: expectedVersion })`, create audits `rights-holder.created` and `customer.rights-holder-linked`, and map unique races to `RIGHTS_HOLDER_ALREADY_LINKED` or idempotency replay/conflict without returning database text.

The linkable query must include a nested customer predicate derived from `customer.read`, exclude holders already linked to the target, constrain `departmentId`, and return only holder fields:

```ts
where: {
  departmentId: actor.departmentId,
  links: { some: { customer: readScope } },
  NOT: { links: { some: { customerId } } },
}
```

- [ ] **Step 6: Verify GREEN and backend static checks**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/backend exec prisma generate
pnpm --filter @dev-cor/backend test -- rights-holder.service.spec.ts rights-holder.controller.spec.ts customer.service.spec.ts customer.controller.spec.ts
pnpm typecheck
pnpm lint
pnpm format:check
```

Expected: all focused tests and static checks pass with no ignored warnings.

- [ ] **Step 7: Save the backend checkpoint**

```powershell
git add backend docs/superpowers/plans/2026-09-17-customer-rights-holder.md docs/project-status.md docs/spec docs/deferred-design.md docs/context-snapshot.json
git commit -m "feat: add customer rights holder backend"
```

---

### Task 2: CUST-RH-001B — Operations Customer Page Flow

**Files:**

- Modify: `frontend/src/api/http.ts`
- Modify: `frontend/src/api/http.spec.ts`
- Create: `frontend/src/api/rights-holders.ts`
- Create: `frontend/src/api/rights-holders.spec.ts`
- Create: `frontend/src/modules/customers/CustomerRightsHolderPanel.vue`
- Create: `frontend/src/modules/customers/CustomerRightsHolderPanel.spec.ts`
- Create: `frontend/src/modules/customers/RightsHolderDetailPage.vue`
- Create: `frontend/src/modules/customers/RightsHolderDetailPage.spec.ts`
- Modify: `frontend/src/modules/customers/CustomerDetailPage.vue`
- Modify: `frontend/src/modules/customers/CustomerDetailPage.spec.ts`
- Modify: `frontend/src/app/router.ts`

**Interfaces:**

- Consumes: the five Task 1 HTTP routes and current customer `{ id, version, capabilities.editRoutine }`.
- Produces typed functions `listCustomerRightsHolders`, `getCustomerRightsHolder`, `findLinkableRightsHolders`, `createCustomerRightsHolder`, and `linkCustomerRightsHolder`. POST functions set `Idempotency-Key` through an optional `headers` field on the shared JSON request wrapper.

- [ ] **Step 1: Write failing HTTP-wrapper and decoder tests**

```ts
await requestJson('/customers/c1/rights-holders', {
  method: 'POST',
  headers: { 'Idempotency-Key': 'command-1' },
  body: { expectedCustomerVersion: 1, name: '主体甲' },
});
expect(fetch).toHaveBeenCalledWith(
  expect.any(String),
  expect.objectContaining({
    headers: expect.objectContaining({ 'Idempotency-Key': 'command-1' }),
  }),
);
```

Decoder tests reject missing nullable fields, malformed pagination/capabilities, leaked association fields, and invalid command results with `INVALID_RESPONSE`.

- [ ] **Step 2: Write failing panel and detail-page tests**

Cover loading, empty, failure, read-only capability, new-holder dialog, required name, optional CU03 fields, linkable-holder dialog, one active submit/idempotency key, preserved inputs after failure, refresh after success, version conflict reload prompt, and nested detail 404. Assert that edit/delete/unlink/default controls do not exist.

- [ ] **Step 3: Run frontend tests and verify RED**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/frontend test -- http rights-holders CustomerRightsHolderPanel RightsHolderDetailPage CustomerDetailPage
```

Expected: FAIL because the header option, typed API, panel, detail page, and route do not exist.

- [ ] **Step 4: Implement the typed request and original-page interaction**

Extend `RequestOptions` with `headers?: Readonly<Record<string, string>>` and merge only caller-supplied headers into fetch. The panel remains under the existing customer detail and emits the new customer version after successful writes. Generate one `crypto.randomUUID()` per user submission and reuse it only for the corresponding retry; a new deliberate submission receives a new key.

Use Element Plus components through version-pinned direct imports. The nested detail route is:

```ts
{
  path: '/customers/:customerId/rights-holders/:rightsHolderId',
  component: RightsHolderDetailPage,
}
```

- [ ] **Step 5: Verify GREEN and frontend static checks**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/frontend test -- http rights-holders CustomerRightsHolderPanel RightsHolderDetailPage CustomerDetailPage
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

Expected: focused Vitest, typecheck, lint, format, and production build pass.

- [ ] **Step 6: Save the frontend checkpoint**

```powershell
git add frontend
git commit -m "feat: add customer rights holder pages"
```

---

### Task 3: CUST-RH-001C — PostgreSQL, Browser, Trace, and Q2 Gate

**Files:**

- Modify: `tests/support/customer-database.mjs`
- Modify: `tests/support/customer-database.d.mts`
- Modify: `tests/e2e/customers.spec.ts`
- Modify: `docs/security/customer-foundation-q2-review.md`
- Modify: `docs/spec/v0.1/READINESS.md`
- Modify: `docs/spec/v0.1/COVERAGE.md`
- Modify: `docs/spec/v0.1/VALIDATION.md`
- Modify: `docs/spec/v0.1/modules/customers.md`
- Modify: `docs/deferred-design.md`
- Modify: `docs/project-status.md`
- Modify: `docs/context-snapshot.json`

**Interfaces:**

- Consumes: the final Task 1 schema/routes and Task 2 pages.
- Produces database helpers for holder/link counts, audit inspection, direct-SQL cross-department rejection, audit-failure rollback, and previous-schema upgrade validation, with matching `.d.mts` declarations.

- [ ] **Step 1: Add failing database/browser scenarios**

Add Playwright cases that create customer A and B, create H under A, link H to B, and open the same holder ID from both customer routes. Add API/direct-database cases for blank names, duplicate name/credit allowed, guessed hidden UUID, cross-department customer/holder link rejection, repeated and concurrent links, stale version, permission revocation, audit failure rollback, identical/different idempotency replay, and response non-disclosure.

- [ ] **Step 2: Run the new E2E selection and verify RED**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm db:test:up
pnpm build
pnpm test:e2e --grep "rights holder"
```

Expected: FAIL before final fixtures/migration wiring or for the first uncovered database constraint; preserve the first failure in VALIDATION.

- [ ] **Step 3: Apply all migrations to a verified isolated empty test database**

Confirm the target is `backend/.env.test` and the test-only database at `127.0.0.1:55433`; do not touch the development database or production. Recreate only the named `postgres-test` service when an empty database is required, apply every migration, and run `prisma migrate status`.

- [ ] **Step 4: Verify previous-schema upgrade and direct SQL constraints**

In a temporary PostgreSQL schema, apply migrations through `20260917060000_add_customer_admission_contact`, insert synthetic customers, then apply the rights-holder migration. Assert old customer rows remain, new tables/constraints exist, a valid same-department association succeeds, blank holder name and both cross-department FK directions fail with the named constraints, and a failed migration transaction leaves no partial objects.

- [ ] **Step 5: Run the full Q2 candidate gates**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm verify
pnpm test:e2e
```

Expected: complete repository verification and every database-backed Playwright test pass on the same fixed candidate. If implementation, migration, test configuration, or business docs change afterward, rerun the evidence invalidated by that change.

- [ ] **Step 6: Obtain independent Q2 review and remediate findings**

Provide the reviewer the approved TD-SLICE, plan, baseline/candidate refs, full diff, migration, rights-holder source/tests, and fresh verify/E2E evidence. Critical, Important, and Minor must all be zero for `ACCEPTED`; every fix forms a new candidate and reruns focused plus invalidated gates.

- [ ] **Step 7: Close traceability and context**

Record actual RED/GREEN commands, counts, migration targets, candidate tree, review conclusion, E01/E02 boundaries, and excluded production actions. Format changed files, run `pnpm context:record`, then run `pnpm context:check`, `pnpm format:check`, `git diff --check`, and inspect staged scope.

- [ ] **Step 8: Safely integrate only an accepted candidate**

Follow `.cursor/rules/verified-feature-integration.mdc`: commit the fixed candidate, fetch `origin/main`, verify no unexpected divergence, integrate without force, run the required post-integration context/diff/key smoke checks, push, and confirm the remote contains the expected commit. If review, branch, credentials, conflict, or evidence is not acceptable, preserve the feature branch and report `IMPLEMENTED_UNVERIFIED` instead of integrating.
