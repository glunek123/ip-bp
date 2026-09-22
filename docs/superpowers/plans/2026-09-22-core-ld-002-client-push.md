# CORE-LD-002 Client Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an atomic operations push from `WAITING_PUSH` to `WAITING_REVIEW` plus a real enterprise-bound client account that can log in and read only its own pushed leads and allowed screenshots.

**Architecture:** Extend the existing local account/session stack with a client account type and one-enterprise binding while preserving internal membership-based RBAC. Keep the push command in the lead module and expose a separate client lead query projection; reuse material storage with a client-only read authorization branch.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Vue 3, Pinia, Vue Router, Element Plus, Jest, Vitest, Playwright.

## Global Constraints

- Only `WAITING_PUSH → WAITING_REVIEW` is implemented; no client review command.
- Client scope is exactly one active enterprise binding and never derives from `SELF/TEAM/DEPARTMENT`.
- Every write rechecks current identity, binding/grants, state and version on the backend.
- Push audit, state and immutable idempotency receipt commit in one transaction.
- Reuse `UserAccount`, `LocalCredential`, `AuthSession`, password, CSRF, request and private material storage capabilities.
- Use a forward migration and only the isolated database selected by `backend/.env.test` for database tests.
- No new dependency, production storage provider, remote push, merge, release or production database action.

---

### Task 1: Identity and lead persistence model

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260922009000_add_client_identity_actions/migration.sql`
- Create: `backend/prisma/migrations/20260922010000_add_client_accounts_and_lead_push/migration.sql`
- Modify: `backend/src/modules/leads/core-ld-migration.spec.ts`

**Interfaces:**

- Produces: `UserAccountType`, `CustomerAccountBinding`, `Lead.pushedAt`, `Lead.pushedByUserId`, `PermissionAction.LEAD_PUSH`, `PermissionAction.CLIENT_LEAD_READ`.
- Database invariant: a `CLIENT` account has one client binding and no internal membership/assignment; lead push fields are both null or both non-null.
- Migration invariant: enum/type additions are retry-safe and committed before the transactional schema phase, so a failed schema phase leaves no partially installed tables, columns, triggers, grants or revision bumps.

- [ ] **Step 1: Add failing migration assertions**

Add assertions that the migration creates `customer_account_bindings`, adds the two permission enum values and lead push columns, and defines account-kind isolation and paired-push-field constraints.

- [ ] **Step 2: Run the migration spec and observe RED**

Run: `pnpm --filter @dev-cor/backend test src/modules/leads/core-ld-migration.spec.ts`

Expected: FAIL because the migration and schema symbols do not exist.

- [ ] **Step 3: Add the Prisma model and forward SQL migration**

Use these stable model names and mapped values:

```prisma
enum UserAccountType {
  INTERNAL
  CLIENT

  @@map("user_account_type")
}

enum PermissionAction {
  LEAD_PUSH       @map("lead.push")
  CLIENT_LEAD_READ @map("client.lead.read")
}

model CustomerAccountBinding {
  id           String      @id @default(uuid()) @db.Uuid
  userId       String      @unique @map("user_id") @db.Uuid
  customerId   String      @map("customer_id") @db.Uuid
  departmentId String      @map("department_id") @db.Uuid
  active       Boolean     @default(true)
  version      Int         @default(1)
  // relations and timestamps follow existing composite-department patterns
}
```

The migration must backfill historical users as `INTERNAL`, install triggers rejecting client membership/role assignment and internal customer binding, add the paired lead field check, and grant `lead.push@DEPARTMENT` only to the safely detected bootstrap role.

- [ ] **Step 4: Generate Prisma and run the migration spec GREEN**

Run: `pnpm --filter @dev-cor/backend db:generate && pnpm --filter @dev-cor/backend test src/modules/leads/core-ld-migration.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit the persistence slice**

```text
git add backend/prisma backend/src/modules/leads/core-ld-migration.spec.ts
git commit -m "feat: add client account and lead push schema"
```

### Task 2: Real client login and immediate revocation

**Files:**

- Modify: `backend/src/access-control/actor-context.ts`
- Modify: `backend/src/auth/authenticated-session.ts`
- Modify: `backend/src/auth/auth.service.ts`
- Modify: `backend/src/auth/auth.service.spec.ts`
- Modify: `backend/src/auth/auth.controller.spec.ts`
- Modify: `frontend/src/api/auth.ts`
- Modify: `frontend/src/api/auth.spec.ts`
- Modify: `frontend/src/stores/auth.spec.ts`

**Interfaces:**

- Produces: `ActorContext.clientCustomerId?: string` and `AuthSessionView.principalType: 'INTERNAL' | 'CLIENT'`.
- Client session view exposes `customer: { id: string; name: string }` and no internal department details; internal response remains compatible.

- [ ] **Step 1: Write failing auth tests**

Cover a client credential with active binding logging in without a department, an internal credential retaining department selection, inactive account rejection, inactive binding rejection, and `resolveSession` invalidation immediately after either revocation.

- [ ] **Step 2: Run auth tests and observe RED**

Run: `pnpm --filter @dev-cor/backend test src/auth/auth.service.spec.ts src/auth/auth.controller.spec.ts`

Expected: FAIL because account type and client binding are not resolved.

- [ ] **Step 3: Implement discriminated session resolution**

Internal login continues to select an active membership. Client login selects the unique active binding and admitted customer, stores that customer's department as the session partition, and returns:

```ts
{
  principalType: 'CLIENT',
  user: { id, displayName, username },
  department: null,
  departments: [],
  customer: { id: customer.id, name: customer.name },
  authorizationRevision,
  expiresAt,
  csrfToken,
}
```

`resolveSession` must re-read account type, account active state and active binding on every request before adding `clientCustomerId` to the actor.

- [ ] **Step 4: Run backend and frontend auth tests GREEN**

Run: `pnpm --filter @dev-cor/backend test src/auth && pnpm --filter @dev-cor/frontend test src/api/auth.spec.ts src/stores/auth.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit real client authentication**

```text
git add backend/src/auth backend/src/access-control/actor-context.ts frontend/src/api/auth.* frontend/src/stores/auth.spec.ts
git commit -m "feat: authenticate enterprise client accounts"
```

### Task 3: Formal customer account management

**Files:**

- Create: `backend/src/modules/customers/customer-account.dto.ts`
- Create: `backend/src/modules/customers/customer-account.service.ts`
- Create: `backend/src/modules/customers/customer-account.service.spec.ts`
- Modify: `backend/src/modules/customers/customer.controller.ts`
- Modify: `backend/src/modules/customers/customer.controller.spec.ts`
- Modify: `backend/src/modules/customers/customer.module.ts`
- Create: `frontend/src/api/client-accounts.ts`
- Create: `frontend/src/api/client-accounts.spec.ts`
- Create: `frontend/src/modules/customers/CustomerAccountPanel.vue`
- Create: `frontend/src/modules/customers/CustomerAccountPanel.spec.ts`
- Modify: `frontend/src/modules/customers/CustomerDetailPage.vue`

**Interfaces:**

- Produces: `list(customerId)`, `create(customerId, {displayName, username, password})`, and `setStatus(customerId, userId, {active})`.
- HTTP routes: `GET/POST /customers/:customerId/client-accounts` and `PATCH /customers/:customerId/client-accounts/:userId/status`.

- [ ] **Step 1: Write failing service/controller/API/component tests**

Cover admitted-customer creation, duplicate username, draft-customer rejection, missing `USER_MANAGE@DEPARTMENT`, customer-scope denial, no internal membership/role creation, list redaction, and status revocation with session invalidation.

- [ ] **Step 2: Run focused tests and observe RED**

Run: `pnpm --filter @dev-cor/backend test src/modules/customers/customer-account.service.spec.ts src/modules/customers/customer.controller.spec.ts && pnpm --filter @dev-cor/frontend test src/api/client-accounts.spec.ts src/modules/customers/CustomerAccountPanel.spec.ts`

Expected: FAIL because the account management interfaces do not exist.

- [ ] **Step 3: Implement atomic account creation and status management**

Use `prepareLocalCredential` and a Serializable transaction. Require `USER_MANAGE@DEPARTMENT`, require `customer.read` scope to cover the customer, set `accountType: 'CLIENT'`, create binding and audit together, and on status change update account/binding, increment authorization revision, revoke sessions and audit in one transaction.

- [ ] **Step 4: Implement the customer detail panel**

The panel lists masked account facts, provides display name/username/password fields, disables duplicate submission, shows stable error messages, and refreshes from the server after create or status change.

- [ ] **Step 5: Run focused tests GREEN and commit**

Run the command from Step 2; expected PASS.

```text
git add backend/src/modules/customers frontend/src/api/client-accounts.* frontend/src/modules/customers/CustomerAccountPanel.* frontend/src/modules/customers/CustomerDetailPage.vue
git commit -m "feat: manage enterprise client bindings"
```

### Task 4: Atomic lead push command

**Files:**

- Modify: `backend/src/access-control/access-control.service.ts`
- Modify: `backend/src/access-control/access-control.service.spec.ts`
- Modify: `backend/src/access-control/permission-catalog.ts`
- Modify: `backend/src/access-control/organization-response.dto.ts`
- Modify: `backend/src/modules/leads/lead.dto.ts`
- Modify: `backend/src/modules/leads/lead.controller.ts`
- Modify: `backend/src/modules/leads/lead.controller.spec.ts`
- Modify: `backend/src/modules/leads/lead.service.ts`
- Modify: `backend/src/modules/leads/lead.service.spec.ts`

**Interfaces:**

- Produces: `LeadService.push(actor, leadId, idempotencyKey, { expectedVersion })`.
- `LeadDetail.capabilities.push` is true only for a currently authorized operation actor and a `WAITING_PUSH` lead.

- [ ] **Step 1: Write failing push tests**

Cover success, no `lead.push` grant, wrong scope, no active client binding/account, customer no longer admitted, wrong state, no products, stale version, same-key replay, same-key different request, concurrent race, and injected audit/receipt failures rolling back all facts.

- [ ] **Step 2: Run lead tests and observe RED**

Run: `pnpm --filter @dev-cor/backend test src/access-control/access-control.service.spec.ts src/modules/leads/lead.controller.spec.ts src/modules/leads/lead.service.spec.ts`

Expected: FAIL because `lead.push` and the route are absent.

- [ ] **Step 3: Implement authorization and command**

Add `lead.push` to the internal action union/catalog. In a bounded Serializable retry loop, lock/read authorization, receipt, lead/customer/products/binding, compare `expectedVersion`, update with a version predicate, write `lead.pushed` audit and immutable receipt snapshot, and map conflicts to stable response codes.

- [ ] **Step 4: Run lead tests GREEN and commit**

Run the command from Step 2; expected PASS.

```text
git add backend/src/access-control backend/src/modules/leads
git commit -m "feat: push leads for client review"
```

### Task 5: Enterprise-scoped client lead and material reads

**Files:**

- Create: `backend/src/modules/leads/client-lead.controller.ts`
- Create: `backend/src/modules/leads/client-lead.service.ts`
- Create: `backend/src/modules/leads/client-lead.service.spec.ts`
- Modify: `backend/src/modules/leads/lead.module.ts`
- Modify: `backend/src/modules/materials/material.service.ts`
- Modify: `backend/src/modules/materials/material.service.spec.ts`

**Interfaces:**

- Produces: `GET /client/leads` and `GET /client/leads/:id` with a redacted client projection.
- Existing `GET /materials` and content download accept a client only for screenshots of its own `WAITING_REVIEW` lead; every material mutation remains forbidden.

- [ ] **Step 1: Write failing isolation tests**

Cover correct enterprise read, other enterprise not found, `WAITING_PUSH` not found, internal actor denied from client endpoints, inactive binding denied, response redaction, own screenshot list/download, and denial for another lead/customer material and every mutation.

- [ ] **Step 2: Run client lead/material tests and observe RED**

Run: `pnpm --filter @dev-cor/backend test src/modules/leads/client-lead.service.spec.ts src/modules/materials/material.service.spec.ts`

Expected: FAIL because client queries and material authorization are absent.

- [ ] **Step 3: Implement client query projection and material branch**

All client lead predicates must include both `customerId: actor.clientCustomerId` and `status: 'WAITING_REVIEW'`. The material branch must resolve the owner lead under the same predicate and only allow `read`; it must never call or reuse internal scope expansion.

- [ ] **Step 4: Run tests GREEN and commit**

Run the command from Step 2; expected PASS.

```text
git add backend/src/modules/leads backend/src/modules/materials
git commit -m "feat: expose enterprise scoped client leads"
```

### Task 6: Identity-aware routes and shared shell

**Files:**

- Modify: `frontend/src/app/router.ts`
- Modify: `frontend/src/app/router.spec.ts`
- Modify: `frontend/src/app/AppShell.vue`
- Modify: `frontend/src/app/App.spec.ts`
- Modify: `frontend/src/modules/auth/LoginPage.vue`
- Modify: `frontend/src/modules/auth/LoginPage.spec.ts`

**Interfaces:**

- Route meta uses `audience: 'INTERNAL' | 'CLIENT'`.
- Internal default is `/customers`; client default is `/client/leads`.

- [ ] **Step 1: Write failing router, shell and login tests**

Verify post-login destination, customer-enterprise label, client-only navigation, internal route rejection for clients, client route rejection for internal actors, and safe `returnTo` handling that cannot cross audiences.

- [ ] **Step 2: Run frontend tests and observe RED**

Run: `pnpm --filter @dev-cor/frontend test src/app/router.spec.ts src/app/App.spec.ts src/modules/auth/LoginPage.spec.ts`

Expected: FAIL because sessions and routes do not distinguish audiences.

- [ ] **Step 3: Implement audience-aware UI routing**

Keep one login page and one shell component, but branch navigation and labels by `principalType`. Never render internal customer/lead/settings navigation for a client.

- [ ] **Step 4: Run tests GREEN and commit**

Run the command from Step 2; expected PASS.

```text
git add frontend/src/app frontend/src/modules/auth
git commit -m "feat: route client identities to client workspace"
```

### Task 7: Operations push UI and client pages

**Files:**

- Modify: `frontend/src/api/leads.ts`
- Modify: `frontend/src/api/leads.spec.ts`
- Create: `frontend/src/api/client-leads.ts`
- Create: `frontend/src/api/client-leads.spec.ts`
- Modify: `frontend/src/modules/leads/LeadDetailPage.vue`
- Modify: `frontend/src/modules/leads/LeadDetailPage.spec.ts`
- Create: `frontend/src/modules/client/ClientLeadListPage.vue`
- Create: `frontend/src/modules/client/ClientLeadListPage.spec.ts`
- Create: `frontend/src/modules/client/ClientLeadDetailPage.vue`
- Create: `frontend/src/modules/client/ClientLeadDetailPage.spec.ts`
- Modify: `frontend/src/app/router.ts`

**Interfaces:**

- `pushLead(id, expectedVersion, idempotencyKey): Promise<LeadDetail>`.
- Client API decodes only the redacted projection and rejects extra/malformed required facts.

- [ ] **Step 1: Write failing API and component tests**

Cover push loading/disable, success feedback and reload, stable version/state/account/permission failures, client list empty/error states, detail redaction, allowed attachment download and refresh persistence.

- [ ] **Step 2: Run frontend tests and observe RED**

Run: `pnpm --filter @dev-cor/frontend test src/api/leads.spec.ts src/api/client-leads.spec.ts src/modules/leads/LeadDetailPage.spec.ts src/modules/client`

Expected: FAIL because push and client pages do not exist.

- [ ] **Step 3: Implement the operation and client UI**

Generate one idempotency key per user click attempt, retain it while the request is in flight, do not auto-retry writes, and reload the lead after success. Client pages use existing cards, tables, status pills and material download API without exposing internal fields.

- [ ] **Step 4: Run tests GREEN and commit**

Run the command from Step 2; expected PASS.

```text
git add frontend/src/api frontend/src/modules/leads frontend/src/modules/client frontend/src/app/router.ts
git commit -m "feat: add lead push and client review views"
```

### Task 8: Database and browser acceptance

**Files:**

- Modify: `tests/support/core-lead-database.ts`
- Modify: `tests/e2e/core-leads.spec.ts`
- Modify: `package.json`
- Modify: `scripts/validation-scopes.mjs`

**Interfaces:**

- The `core-ld` E2E scope runs the real operation/client flow with Cookie sessions and real screenshot bytes.

- [ ] **Step 1: Add database/browser tests before production adjustments**

Add fixtures that create two admitted enterprises, real bound client credentials and an operation role with `lead.push`. Test operation login→push→logout→client login→list/detail/download→refresh, cross-enterprise URL denial, waiting-push absence, revocation, concurrency, rollback injection and persistence.

- [ ] **Step 2: Run database acceptance and observe any RED caused by missing integration**

Run: `pnpm test:e2e:core-ld`

Expected before final integration fixes: at least one new scenario fails for a concrete missing behavior; existing scenarios remain diagnosable.

- [ ] **Step 3: Apply only integration fixes demonstrated by failing tests**

Keep fixes inside the already designed interfaces; add a focused regression assertion for every discovered defect.

- [ ] **Step 4: Run focused tests and `check:fast`**

Run: `pnpm test:unit:core-ld && pnpm test:unit:auth && pnpm check:fast`

Expected: PASS.

- [ ] **Step 5: Commit the accepted vertical slice**

```text
git add tests scripts package.json backend frontend
git commit -m "test: verify real client lead push flow"
```

### Task 9: Review, final gates and state closure

**Files:**

- Modify: `docs/spec/v0.1/modules/leads.md`
- Modify: `docs/spec/v0.1/VALIDATION.md`
- Modify: `docs/feature-roadmap.md`
- Modify: `docs/project-status.md`
- Modify: `context-snapshot.json`

**Interfaces:**

- Closure is permitted only after zero open Critical/Important/Minor review findings and all required Level 3/database/migration/browser gates pass on a fixed candidate.

- [ ] **Step 1: Perform an isolated full-diff review before expensive gates**

Review identity separation, tenant predicates, authorization rechecks, idempotent response validation, transaction failure paths, redaction, attachment authorization, migration safety and test realism. Record `ACCEPTED` or findings with Critical/Important/Minor counts; fix and re-review every finding.

- [ ] **Step 2: Run migration acceptance**

Run the repository migration test entry against the isolated `.env.test` database, covering empty-schema deploy and previous-supported-schema upgrade without resetting any non-test database.

Expected: PASS with both paths exercised.

- [ ] **Step 3: Freeze a clean candidate and run formal Level 3 gates**

Run: `pnpm verify` followed by `pnpm test:e2e:full` if the full E2E is not already part of the fixed-scope evidence.

Expected: PASS with zero failed checks and real PostgreSQL/Chromium acceptance.

- [ ] **Step 4: Update completion sources only after evidence exists**

Mark `CORE-LD-002` complete, make `CORE-LD-003` the sole Current and `CORE-LD-004` Next, update validation evidence and project status with the exact commit/tree and review result, while retaining production-storage and release limitations.

- [ ] **Step 5: Record and strictly verify context**

Run: `pnpm context:record && pnpm context:check:strict`

Expected: PASS.

- [ ] **Step 6: Commit final documentation and report status**

```text
git add docs context-snapshot.json
git commit -m "docs: close core ld 002 validation"
```

Report the final commit/tree, evidence path, actual tests, review counts, remaining limitations and `git status`; do not push or merge.
