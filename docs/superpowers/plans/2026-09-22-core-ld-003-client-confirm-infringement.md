# CORE-LD-003 Client Confirm Infringement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a real enterprise-bound client confirm infringement on its own pushed lead, atomically move `WAITING_REVIEW → WAITING_EVIDENCE_DECISION`, and let both client and operations read the same immutable decision.

**Architecture:** Keep external identity authorization anchored to the existing active `CustomerAccountBinding`, and implement the write in `ClientLeadService` as a serializable command. Persist the authoritative business fact in an immutable one-to-one `LeadReviewDecision` and replay-safe transport result in `ClientLeadReviewReceipt`; expose only redacted client projections while adding the same decision projection to the existing internal lead detail.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Vue 3, Vue Router, Element Plus, Jest, Vitest, Playwright.

## Global Constraints

- Implement only `WAITING_REVIEW → WAITING_EVIDENCE_DECISION` with `result=INFRINGEMENT`; do not implement CORE-LD-004, evidence decisions, notary transfer or a complete client portal.
- Client scope remains exactly the currently active enterprise binding and never derives from internal `SELF/TEAM/DEPARTMENT` grants.
- Add `CLIENT_LEAD_REVIEW`, but keep both client actions outside the internal role-template catalog.
- Every command rechecks active `CLIENT` account, active binding, admitted customer, enterprise/department match, push facts, current state and `expectedVersion` on the backend.
- State, immutable review decision and idempotency receipt commit in one serializable transaction; any durable-write failure rolls back all three.
- Same idempotency key plus the same fingerprint returns the first immutable response; the same key plus a different request returns `IDEMPOTENCY_CONFLICT`.
- Use only forward migrations. Database tests may use only the isolated database selected by `backend/.env.test`; do not reset development, production or persistent-volume data.
- Reuse current authentication, CSRF, request, material storage, shared visual components and command error conventions. Add no dependency.
- Follow SD-38: explain inputs and consequences before action, expose only real choices, and keep consequential confirmation explicit.
- Use task-bounded subagents for independently testable implementation tasks. Use `gpt-6-sol` for independent review, architecture, high-risk commands, concurrency and migration review; use `gpt-6-luna` for clearly bounded test runs, failure-log analysis, simple spec additions, API type synchronization, documentation and gap checks.
- Do not push, merge, publish, release or access production systems.

---

### Task 1: External review persistence and permission action

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260922011000_add_client_lead_review_action/migration.sql`
- Create: `backend/prisma/migrations/20260922012000_add_client_lead_review/migration.sql`
- Modify: `backend/src/access-control/access-control.service.ts`
- Modify: `backend/src/access-control/prisma-access-control.store.ts`
- Modify: `backend/src/access-control/organization.service.spec.ts`
- Modify: `backend/src/access-control/role-template.controller.spec.ts`
- Modify: `backend/src/access-control/role-template.service.spec.ts`
- Modify: `backend/src/modules/leads/core-ld-migration.spec.ts`

**Interfaces:**

- Produces: `PermissionAction.CLIENT_LEAD_REVIEW` mapped to `client.lead.review` and `PermissionAction` string union member `'client.lead.review'`.
- Produces: `LeadReviewResult.INFRINGEMENT`, `LeadReviewDecision`, and `ClientLeadReviewReceipt` Prisma models.
- Database invariant: one review decision per lead; `toVersion = fromVersion + 1`; decision rows reject `UPDATE` and `DELETE`; receipt action is exactly `client.lead.review`.
- Catalog invariant: `CLIENT_LEAD_READ` and `CLIENT_LEAD_REVIEW` remain excluded from `internalAssignablePermissionActions`.

- [ ] **Step 1: Write failing schema and catalog tests**

Extend `core-ld-migration.spec.ts` with exact ordering and SQL assertions:

```ts
const clientReviewActionMigrationName =
  '20260922011000_add_client_lead_review_action';
const clientReviewSchemaMigrationName = '20260922012000_add_client_lead_review';

it('adds client review action before the transactional review schema', () => {
  expect(migrations.slice(-2)).toEqual([
    clientReviewActionMigrationName,
    clientReviewSchemaMigrationName,
  ]);
  expect(readMigration(clientReviewActionMigrationName)).toContain(
    "ADD VALUE IF NOT EXISTS 'client.lead.review'",
  );
  const sql = readMigration(clientReviewSchemaMigrationName);
  expect(sql.trim().startsWith('BEGIN;')).toBe(true);
  expect(sql).toContain('CREATE TYPE "lead_review_result"');
  expect(sql).toContain('CREATE TABLE "lead_review_decisions"');
  expect(sql).toContain('CREATE TABLE "client_lead_review_receipts"');
  expect(sql).toContain('reject_lead_review_decision_mutation');
  expect(sql).toContain('client_lead_review_receipts_action_check');
  expect(sql.trim().endsWith('COMMIT;')).toBe(true);
  expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN/);
});
```

Add expectations in access-control tests that attempts to submit either `CLIENT_LEAD_READ` or `CLIENT_LEAD_REVIEW` as a role grant are rejected with `ROLE_TEMPLATE_ACTION_NOT_ASSIGNABLE`, and that neither action appears in the organization permission catalog.

- [ ] **Step 2: Run the migration and access-control tests RED**

Run:

```text
pnpm --filter @dev-cor/backend test src/modules/leads/core-ld-migration.spec.ts src/access-control/organization.service.spec.ts src/access-control/role-template.controller.spec.ts src/access-control/role-template.service.spec.ts
```

Expected: FAIL because the action, models and migrations do not exist.

- [ ] **Step 3: Add the Prisma enum, relations and models**

Add the mapped action and these stable models, including inverse relation arrays on `Department`, `UserAccount`, `Customer`, `CustomerAccountBinding` and `Lead`:

```prisma
enum LeadReviewResult {
  INFRINGEMENT

  @@map("lead_review_result")
}

model LeadReviewDecision {
  id                          String                 @id @default(uuid()) @db.Uuid
  departmentId                String                 @map("department_id") @db.Uuid
  leadId                      String                 @unique @map("lead_id") @db.Uuid
  customerId                  String                 @map("customer_id") @db.Uuid
  reviewerUserId              String                 @map("reviewer_user_id") @db.Uuid
  customerAccountBindingId    String                 @map("customer_account_binding_id") @db.Uuid
  reviewerDisplayNameSnapshot String                 @map("reviewer_display_name_snapshot")
  result                      LeadReviewResult
  decidedAt                   DateTime               @default(now()) @map("decided_at") @db.Timestamptz(3)
  fromVersion                 Int                    @map("from_version")
  toVersion                   Int                    @map("to_version")
  department                  Department             @relation(fields: [departmentId], references: [id], onDelete: Restrict)
  lead                        Lead                   @relation(fields: [leadId, departmentId], references: [id, departmentId], onDelete: Restrict, map: "lead_review_decisions_lead_department_fkey")
  customer                    Customer               @relation(fields: [customerId, departmentId], references: [id, departmentId], onDelete: Restrict, map: "lead_review_decisions_customer_department_fkey")
  reviewer                    UserAccount            @relation("LeadReviewDecisionReviewer", fields: [reviewerUserId], references: [id], onDelete: Restrict)
  customerAccountBinding      CustomerAccountBinding @relation(fields: [customerAccountBindingId], references: [id], onDelete: Restrict)
  receipt                     ClientLeadReviewReceipt?

  @@index([departmentId, customerId, decidedAt])
  @@map("lead_review_decisions")
}

model ClientLeadReviewReceipt {
  id                       String                 @id @default(uuid()) @db.Uuid
  departmentId             String                 @map("department_id") @db.Uuid
  actorUserId              String                 @map("actor_user_id") @db.Uuid
  customerAccountBindingId String                 @map("customer_account_binding_id") @db.Uuid
  action                   String                 @db.VarChar(100)
  idempotencyKey           String                 @map("idempotency_key") @db.VarChar(128)
  requestFingerprint       String                 @map("request_fingerprint") @db.Char(64)
  resultLeadId             String                 @map("result_lead_id") @db.Uuid
  resultLeadVersion        Int                    @map("result_lead_version")
  reviewDecisionId         String                 @unique @map("review_decision_id") @db.Uuid
  resultSnapshot           Json                   @map("result_snapshot")
  department               Department             @relation(fields: [departmentId], references: [id], onDelete: Restrict)
  actor                    UserAccount            @relation("ClientLeadReviewReceiptActor", fields: [actorUserId], references: [id], onDelete: Restrict)
  customerAccountBinding   CustomerAccountBinding @relation(fields: [customerAccountBindingId], references: [id], onDelete: Restrict)
  resultLead               Lead                   @relation(fields: [resultLeadId, departmentId], references: [id, departmentId], onDelete: Restrict, map: "client_lead_review_receipts_lead_department_fkey")
  reviewDecision           LeadReviewDecision     @relation(fields: [reviewDecisionId], references: [id], onDelete: Restrict)
  createdAt                DateTime               @default(now()) @map("created_at") @db.Timestamptz(3)

  @@unique([departmentId, actorUserId, action, idempotencyKey], map: "client_lead_review_receipts_department_actor_action_key")
  @@index([resultLeadId, departmentId])
  @@map("client_lead_review_receipts")
}
```

Add `CLIENT_LEAD_REVIEW @map("client.lead.review")` to `PermissionAction`; add the corresponding string and Prisma map entry, but leave `internalAssignablePermissionActions` unchanged.

- [ ] **Step 4: Add the two forward SQL migrations**

The action migration must use the existing retry-safe `pg_enum` guard pattern. The structural migration must be one `BEGIN`/`COMMIT` unit, create both tables and foreign keys, add positive/version/action checks, and install this mutation barrier:

```sql
CREATE FUNCTION reject_lead_review_decision_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lead review decisions are immutable'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER reject_lead_review_decision_mutation
BEFORE UPDATE OR DELETE ON lead_review_decisions
FOR EACH ROW EXECUTE FUNCTION reject_lead_review_decision_mutation();
```

- [ ] **Step 5: Generate Prisma and run Task 1 tests GREEN**

Run:

```text
pnpm --filter @dev-cor/backend db:generate
pnpm --filter @dev-cor/backend test src/modules/leads/core-ld-migration.spec.ts src/access-control/organization.service.spec.ts src/access-control/role-template.controller.spec.ts src/access-control/role-template.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the persistence slice**

```text
git add backend/prisma backend/src/access-control backend/src/modules/leads/core-ld-migration.spec.ts
git commit -m "feat: add immutable client lead review records"
```

### Task 2: Client review DTOs and redacted query projections

**Files:**

- Create: `backend/src/modules/leads/client-lead-review.dto.ts`
- Create: `backend/src/modules/leads/client-lead.controller.spec.ts`
- Modify: `backend/src/modules/leads/client-lead-response.dto.ts`
- Modify: `backend/src/modules/leads/client-lead.controller.ts`
- Modify: `backend/src/modules/leads/client-lead.service.spec.ts`
- Modify: `backend/src/modules/leads/client-lead.service.ts`

**Interfaces:**

- Consumes: `LeadReviewDecision` from Task 1.
- Produces: `ClientLeadView = 'PENDING' | 'PROCESSED'` and `ClientLeadListQueryDto` with `view`, `page`, `pageSize`.
- Service signature: `list(actor, view, page, pageSize)`; the controller passes the validated values in that order.
- Produces: `ReviewClientLeadDto { result: 'INFRINGEMENT'; expectedVersion: number }`.
- Client response adds `version`, `reviewDecision: ClientLeadReviewDecisionResponseDto | null` and `capabilities: { review: boolean }` without internal fields.

- [ ] **Step 1: Write failing DTO, list-filter and projection tests**

Cover exact accepted/rejected inputs and header handling:

```ts
await expect(
  pipe.transform(
    { result: 'INFRINGEMENT', expectedVersion: 2 },
    { type: 'body', metatype: ReviewClientLeadDto },
  ),
).resolves.toEqual({ result: 'INFRINGEMENT', expectedVersion: 2 });

await expect(
  pipe.transform(
    { result: 'NO_INFRINGEMENT', expectedVersion: 2 },
    { type: 'body', metatype: ReviewClientLeadDto },
  ),
).rejects.toBeInstanceOf(BadRequestException);
```

Add query validation for `view=PENDING|PROCESSED` and rejection of every other value. Service tests must assert the pending and processed Prisma predicates, processed-decision projection, `capabilities.review`, and continued redaction of all internal fields.

- [ ] **Step 2: Run the contract tests RED**

Run:

```text
pnpm --filter @dev-cor/backend test src/modules/leads/client-lead.controller.spec.ts src/modules/leads/client-lead.service.spec.ts
```

Expected: FAIL because review DTOs, view filtering and decision projections do not exist.

- [ ] **Step 3: Implement DTOs and list-query delegation**

Use these request constraints:

```ts
export const CLIENT_LEAD_VIEWS = ['PENDING', 'PROCESSED'] as const;
export type ClientLeadView = (typeof CLIENT_LEAD_VIEWS)[number];

export class ReviewClientLeadDto {
  @ApiProperty({ enum: ['INFRINGEMENT'] })
  @IsIn(['INFRINGEMENT'])
  result!: 'INFRINGEMENT';

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
```

Add `ClientLeadListQueryDto` pagination fields using the same limits as `LeadListQueryDto`. Change the GET list controller to pass `query.view`, `query.page` and `query.pageSize`; do not add the POST route until Task 3 supplies a complete command implementation.

- [ ] **Step 4: Extend list/detail projections without enabling the command yet**

Include `reviewDecision` in `clientLeadInclude`. Map `PENDING` to pushed `WAITING_REVIEW`; map `PROCESSED` to pushed `WAITING_EVIDENCE_DECISION` plus `reviewDecision: { isNot: null }`. Detail accepts either condition for the same enterprise. Return:

```ts
reviewDecision: lead.reviewDecision
  ? {
      result: lead.reviewDecision.result,
      reviewerDisplayName:
        lead.reviewDecision.reviewerDisplayNameSnapshot,
      decidedAt: lead.reviewDecision.decidedAt.toISOString(),
    }
  : null,
capabilities: { review: lead.status === 'WAITING_REVIEW' },
```

The service still calls `assertClient` before every list/detail query. `WAITING_PUSH`, cross-enterprise and processed records without a decision remain invisible.

- [ ] **Step 5: Run the contract/query tests GREEN**

Run the Task 2 command again.

Expected: PASS for DTO validation and the two queue projections. The tree remains buildable and exposes no incomplete POST route.

- [ ] **Step 6: Commit the client contract slice**

```text
git add backend/src/modules/leads backend/src/core-ld-openapi.spec.ts
git commit -m "feat: expose client lead review contract"
```

### Task 3: Atomic client confirmation command and HTTP route

**Files:**

- Modify: `backend/src/modules/leads/client-lead.service.ts`
- Modify: `backend/src/modules/leads/client-lead.service.spec.ts`
- Modify: `backend/src/modules/leads/client-lead.controller.spec.ts`
- Modify: `backend/src/modules/leads/client-lead.controller.ts`
- Modify: `backend/src/core-ld-openapi.spec.ts`

**Interfaces:**

- Consumes: `ReviewClientLeadDto`, `LeadReviewDecision`, `ClientLeadReviewReceipt`.
- Produces: `ClientLeadReviewResult` with `id`, `businessNo`, `status`, `version`, and non-null review decision.
- HTTP route: `POST /api/v1/client/leads/:id/reviews`, requiring `Idempotency-Key` and returning `201 ClientLeadReviewResultDto`.
- Stable errors: `RESOURCE_NOT_FOUND`, `ACTION_FORBIDDEN`, `INVALID_STATE`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `INTERNAL_ERROR`.
- Fixed-capability action constant: `const CLIENT_LEAD_REVIEW_ACTION = 'client.lead.review' satisfies PermissionAction`; use it for every receipt lookup/write rather than an untyped duplicate string.

- [ ] **Step 1: Add failing command tests**

Use transaction mocks that cover:

- active client binding plus admitted customer succeeds;
- internal actor, inactive account/binding and non-admitted customer fail before state mutation;
- cross-enterprise and unpushed leads return `RESOURCE_NOT_FOUND`;
- wrong state returns `INVALID_STATE` and stale version returns `VERSION_CONFLICT`;
- same key/same fingerprint returns the exact first snapshot without update/create calls;
- same key/different request returns `IDEMPOTENCY_CONFLICT`;
- decision or receipt creation failure rejects and relies on transaction rollback;
- serialization retry is capped and two competing calls cannot both create decisions.

Controller tests must reject missing, blank and 129-character keys, trim a valid key, and call:

```ts
service.review(actor, leadId, 'review-key', {
  result: 'INFRINGEMENT',
  expectedVersion: 2,
});
```

OpenAPI must document the POST route with a `201` `ClientLeadReviewResultDto` response.

Assert the successful transaction writes exactly:

```ts
expect(transaction.leadReviewDecision.create).toHaveBeenCalledWith({
  data: expect.objectContaining({
    leadId: lead.id,
    customerId: actor.clientCustomerId,
    reviewerUserId: actor.userId,
    result: 'INFRINGEMENT',
    fromVersion: 2,
    toVersion: 3,
  }),
});
expect(transaction.clientLeadReviewReceipt.create).toHaveBeenCalledWith({
  data: expect.objectContaining({
    action: 'client.lead.review',
    idempotencyKey: 'review-key',
    resultLeadVersion: 3,
  }),
});
```

- [ ] **Step 2: Run command tests RED**

Run:

```text
pnpm --filter @dev-cor/backend test src/modules/leads/client-lead.service.spec.ts src/modules/leads/client-lead.controller.spec.ts src/core-ld-openapi.spec.ts
```

Expected: FAIL because the atomic command is absent.

- [ ] **Step 3: Implement current-binding validation reusable by reads and writes**

Change the private assertion to accept a transaction-capable reader and return stable facts:

```ts
type ClientBindingFacts = {
  id: string;
  customerId: string;
  reviewerDisplayName: string;
};

private async assertClient(
  actor: ActorContext,
  reader: Pick<Prisma.TransactionClient, 'customerAccountBinding'> =
    this.database,
): Promise<ClientBindingFacts> {
  if (actor.clientCustomerId === undefined) throw this.forbidden();
  const binding = await reader.customerAccountBinding.findFirst({
    where: {
      userId: actor.userId,
      customerId: actor.clientCustomerId,
      departmentId: actor.departmentId,
      active: true,
      user: { active: true, accountType: 'CLIENT' },
      customer: { profileStatus: 'ADMITTED' },
    },
    select: {
      id: true,
      customerId: true,
      user: { select: { displayName: true } },
    },
  });
  if (binding === null) throw this.forbidden();
  return {
    id: binding.id,
    customerId: binding.customerId,
    reviewerDisplayName: binding.user.displayName,
  };
}
```

- [ ] **Step 4: Implement the serializable review command**

Use `createHash('sha256')` over a stable JSON object `{ leadId, result, expectedVersion }`. In each attempt:

1. Begin a Serializable transaction.
2. Revalidate the current binding.
3. Read and validate a prior receipt before checking current state.
4. Lock the enterprise-scoped pushed lead using parameterized `FOR UPDATE`.
5. Load current status/version/push facts and reject invalid state/version.
6. `updateMany` with `status='WAITING_REVIEW'` and the expected version.
7. Create the decision, build the response snapshot and create the receipt.

The conditional update must be:

```ts
const changed = await transaction.lead.updateMany({
  where: {
    id,
    departmentId: actor.departmentId,
    customerId: binding.customerId,
    status: 'WAITING_REVIEW',
    version: input.expectedVersion,
    pushedAt: { not: null },
    pushedByUserId: { not: null },
  },
  data: {
    status: 'WAITING_EVIDENCE_DECISION',
    version: { increment: 1 },
  },
});
if (changed.count !== 1) throw this.versionConflict();
```

On `P2002`, revalidate the binding, read the winning receipt and apply the same fingerprint/snapshot validation. On serialization failure, retry at most three times; then return `VERSION_CONFLICT`.

- [ ] **Step 5: Add the complete POST route and run command/contract tests GREEN**

Add the controller POST only after `ClientLeadService.review` exists. Reuse the 1..128 trimmed key rule, annotate the response DTO, then run the Task 3 test command.

Expected: PASS with exact replay, rollback and concurrency assertions.

- [ ] **Step 6: Commit the atomic command**

```text
git add backend/src/modules/leads/client-lead.service.* backend/src/modules/leads/client-lead.controller.* backend/src/core-ld-openapi.spec.ts
git commit -m "feat: confirm client lead infringement atomically"
```

### Task 4: Operations reads the same decision

**Files:**

- Modify: `backend/src/modules/leads/lead.service.ts`
- Modify: `backend/src/modules/leads/lead.service.spec.ts`

**Interfaces:**

- Consumes: one-to-one `Lead.reviewDecision`.
- Produces: internal `LeadResponse.reviewDecision`, nullable for all leads that have no formal customer decision.
- Projection shape: `{ result: 'INFRINGEMENT'; reviewerDisplayName: string; decidedAt: string } | null`.

- [ ] **Step 1: Add failing internal projection tests**

Add `reviewDecision` to the fixture record and assert both a formal decision and the null case:

```ts
expect(result.reviewDecision).toEqual({
  result: 'INFRINGEMENT',
  reviewerDisplayName: '企业审核员',
  decidedAt: '2026-09-22T03:00:00.000Z',
});
```

Also assert the response uses the immutable display-name snapshot rather than a live account display name.

- [ ] **Step 2: Run the lead service tests RED**

Run:

```text
pnpm --filter @dev-cor/backend test src/modules/leads/lead.service.spec.ts
```

Expected: FAIL because internal projections omit the decision.

- [ ] **Step 3: Extend the existing include, response type, view and receipt snapshot parser**

Add to `leadInclude`:

```ts
reviewDecision: {
  select: {
    result: true,
    reviewerDisplayNameSnapshot: true,
    decidedAt: true,
  },
},
```

Map the response exactly as the client projection does. Update strict response guards and snapshots so create/edit/push receipts remain readable with `reviewDecision: null`; do not infer a decision from status alone.

- [ ] **Step 4: Run lead service and API tests GREEN**

Run:

```text
pnpm --filter @dev-cor/backend test src/modules/leads/lead.service.spec.ts src/modules/leads/lead.controller.spec.ts src/core-ld-openapi.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the shared read projection**

```text
git add backend/src/modules/leads/lead.service.*
git commit -m "feat: expose client review to operations"
```

### Task 5: Post-review screenshot authorization

**Files:**

- Modify: `backend/src/modules/materials/material.service.ts`
- Modify: `backend/src/modules/materials/material.service.spec.ts`

**Interfaces:**

- Client reads remain `operation='read'` and `ownerType='LEAD'` only.
- `WAITING_REVIEW` is readable with complete push facts.
- `WAITING_EVIDENCE_DECISION` is readable only when the lead has a formal `reviewDecision`.
- `WAITING_PUSH`, cross-enterprise, archived, other-owner reads and every client write remain denied.

- [ ] **Step 1: Add failing authorization tests**

Cover pending and processed success plus all rejected states. Assert the Prisma predicate includes enterprise and push facts:

```ts
where: {
  id: 'lead-1',
  departmentId: actor.departmentId,
  customerId,
  pushedAt: { not: null },
  pushedByUserId: { not: null },
  OR: [
    { status: 'WAITING_REVIEW' },
    {
      status: 'WAITING_EVIDENCE_DECISION',
      reviewDecision: { isNot: null },
    },
  ],
},
```

- [ ] **Step 2: Run material tests RED**

Run:

```text
pnpm --filter @dev-cor/backend test src/modules/materials/material.service.spec.ts
```

Expected: FAIL for processed-lead reads.

- [ ] **Step 3: Replace the single-status client predicate**

Update only the client branch of `authorizeOwner`; do not touch internal lead scope derivation, upload, delete, restore or material-reference checks.

- [ ] **Step 4: Run material tests GREEN**

Run the Task 5 test command.

Expected: PASS.

- [ ] **Step 5: Commit material authorization**

```text
git add backend/src/modules/materials/material.service.*
git commit -m "feat: preserve client screenshot access after review"
```

### Task 6: Strict frontend API for pending, processed and review

**Files:**

- Modify: `frontend/src/api/client-leads.ts`
- Modify: `frontend/src/api/client-leads.spec.ts`
- Modify: `frontend/src/api/leads.ts`
- Modify: `frontend/src/api/leads.spec.ts`

**Interfaces:**

- Produces: `ClientLeadView = 'PENDING' | 'PROCESSED'`.
- Produces: `ClientLead.status = 'WAITING_REVIEW' | 'WAITING_EVIDENCE_DECISION'`.
- Produces: `reviewClientLead(id, expectedVersion, idempotencyKey, options?)`.
- Internal `Lead` gains the same nullable `reviewDecision` projection.

- [ ] **Step 1: Write failing strict-decoder and POST tests**

Test pending and processed shapes, mismatched state/decision rejection, extra internal-field rejection and the exact request:

```ts
expect(http.requestJson).toHaveBeenCalledWith('/client/leads/lead-1/reviews', {
  method: 'POST',
  headers: { 'Idempotency-Key': 'review-key' },
  body: JSON.stringify({ result: 'INFRINGEMENT', expectedVersion: 2 }),
});
```

List tests must expect `view=PENDING` or `view=PROCESSED` in the query string.

- [ ] **Step 2: Run API tests RED**

Run:

```text
pnpm --filter @dev-cor/frontend test src/api/client-leads.spec.ts src/api/leads.spec.ts
```

Expected: FAIL because the new fields and review call are absent.

- [ ] **Step 3: Implement exact types and decoders**

Use a discriminated validation rule:

```ts
type ClientLeadReviewDecision = {
  result: 'INFRINGEMENT';
  reviewerDisplayName: string;
  decidedAt: string;
};

const decisionMatchesStatus =
  (value.status === 'WAITING_REVIEW' && value.reviewDecision === null) ||
  (value.status === 'WAITING_EVIDENCE_DECISION' &&
    isClientReviewDecision(value.reviewDecision));
```

Require `capabilities.review === true` only for `WAITING_REVIEW`, and `false` for processed results. Keep exact-key checks so server regressions cannot leak internal fields.

- [ ] **Step 4: Implement the review request**

```ts
export async function reviewClientLead(
  id: string,
  expectedVersion: number,
  idempotencyKey: string,
  options: RequestOptions = {},
): Promise<ClientLeadReviewResult> {
  const value = await requestJson(
    `/client/leads/${encodeURIComponent(id)}/reviews`,
    {
      ...options,
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ result: 'INFRINGEMENT', expectedVersion }),
    },
  );
  if (!isClientLeadReviewResult(value)) throw invalidResponse();
  return value;
}
```

- [ ] **Step 5: Run API tests GREEN**

Run the Task 6 test command.

Expected: PASS.

- [ ] **Step 6: Commit frontend contracts**

```text
git add frontend/src/api/client-leads.* frontend/src/api/leads.*
git commit -m "feat: add strict client review API"
```

### Task 7: Client pending and processed queues

**Files:**

- Modify: `frontend/src/modules/client/ClientLeadListPage.vue`
- Modify: `frontend/src/modules/client/ClientLeadListPage.spec.ts`
- Modify: `frontend/src/app/AppShell.vue`
- Modify: `frontend/src/app/AppShell.spec.ts`

**Interfaces:**

- URL contract: `/client/leads?view=pending&page=1` and `/client/leads?view=processed&page=1`; missing/invalid view normalizes to pending behavior.
- Visible labels: `待我审核` and `已处理`.
- Queue API mapping: pending → `PENDING`; processed → `PROCESSED`.

- [ ] **Step 1: Add failing queue interaction tests**

Assert default pending load, processed selection resetting to page 1, URL persistence and queue-specific empty copy:

```ts
expect(api.listClientLeads).toHaveBeenCalledWith(
  'PENDING',
  1,
  20,
  expect.objectContaining({ signal: expect.any(AbortSignal) }),
);
await wrapper.get('[data-test="client-view-processed"]').trigger('click');
await flushPromises();
expect(api.listClientLeads).toHaveBeenLastCalledWith(
  'PROCESSED',
  1,
  20,
  expect.anything(),
);
```

Processed rows must show `已确认侵权` and not render a confirm action.

- [ ] **Step 2: Run list/shell tests RED**

Run:

```text
pnpm --filter @dev-cor/frontend test src/modules/client/ClientLeadListPage.spec.ts src/app/AppShell.spec.ts
```

Expected: FAIL because there is one read-only queue.

- [ ] **Step 3: Implement the two-view queue**

Replace the read-only explanation with “在待我审核中确认结论；完成后可在已处理中回看”。 Add two buttons/tabs with `aria-current`, route-query updates and queue-specific headings. Keep one table and the existing pagination; preserve the active view while paging.

Update client navigation label from `待审核线索` to `线索审核`, without adding unrelated client portal navigation.

- [ ] **Step 4: Run list/shell tests GREEN**

Run the Task 7 command.

Expected: PASS.

- [ ] **Step 5: Commit the client queues**

```text
git add frontend/src/modules/client/ClientLeadListPage.* frontend/src/app/AppShell.*
git commit -m "feat: add client pending and processed queues"
```

### Task 8: Client confirmation and persisted result page

**Files:**

- Modify: `frontend/src/modules/client/ClientLeadDetailPage.vue`
- Modify: `frontend/src/modules/client/ClientLeadDetailPage.spec.ts`

**Interfaces:**

- Consumes: `ClientLead.capabilities.review`, `reviewClientLead`, and nullable `reviewDecision`.
- Produces: one consequential action button `确认侵权` only for reviewable pending leads.
- Produces: processed display with result, reviewer, time and next step; no CORE-LD-004/005/006 actions.

- [ ] **Step 1: Add failing action and result tests**

Cover:

- confirmation cancellation performs no request;
- confirmation copy contains `线索待确认`, `运营决定是否取证` and `当前入口不能撤回`;
- accepted confirmation sends current version and one stable idempotency key;
- button is disabled/loading while submitting;
- success reloads and renders the server decision;
- processed reload has no confirmation button and keeps screenshot download;
- `VERSION_CONFLICT`, `INVALID_STATE`, `IDEMPOTENCY_CONFLICT`, `ACTION_FORBIDDEN` and network failure map to stable copy without hiding loaded facts.

Use this success fixture:

```ts
const processedLead = {
  ...lead,
  status: 'WAITING_EVIDENCE_DECISION',
  version: 3,
  reviewDecision: {
    result: 'INFRINGEMENT',
    reviewerDisplayName: '企业审核员',
    decidedAt: '2026-09-22T03:00:00.000Z',
  },
  capabilities: { review: false },
};
```

- [ ] **Step 2: Run detail tests RED**

Run:

```text
pnpm --filter @dev-cor/frontend test src/modules/client/ClientLeadDetailPage.spec.ts
```

Expected: FAIL because the page is read-only.

- [ ] **Step 3: Implement confirmation, loading and error behavior**

Generate the key once per logical attempt and retain it after an unknown network result:

```ts
function makeReviewKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `client-lead-review-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}
```

On confirmed success, clear the key, show `已确认侵权，等待运营确认是否取证`, and call `load()`. On an explicit idempotency conflict, clear the key before a future user-initiated attempt; on `NETWORK_ERROR`, keep it so retry is safe.

- [ ] **Step 4: Render the processed decision and retain attachments**

Add a `data-test="client-review-record"` section showing:

```text
审核结论：确认侵权
审核人：{reviewerDisplayName}
审核时间：{Asia/Shanghai formatted decidedAt}
下一步：等待运营确认是否取证
```

The back link must preserve the originating queue or return processed records to `/client/leads?view=processed`.

- [ ] **Step 5: Run client component tests GREEN**

Run:

```text
pnpm --filter @dev-cor/frontend test src/modules/client
```

Expected: PASS.

- [ ] **Step 6: Commit the client review UI**

```text
git add frontend/src/modules/client
git commit -m "feat: let clients confirm lead infringement"
```

### Task 9: Operations detail shows the same review decision

**Files:**

- Modify: `frontend/src/modules/leads/LeadDetailPage.vue`
- Modify: `frontend/src/modules/leads/LeadDetailPage.spec.ts`

**Interfaces:**

- Consumes: `Lead.reviewDecision` from Task 6.
- Produces: read-only `客户审核记录` for formal decisions.
- Does not produce an evidence-decision command or button.

- [ ] **Step 1: Add failing operations display tests**

For a `WAITING_EVIDENCE_DECISION` lead, assert the status label is `线索待确认`, the record shows `确认侵权`, reviewer and time, and the raw reviewer UUID is absent. Assert no text/button for `确认取证`, `不取证` or `移交公证`.

- [ ] **Step 2: Run operations detail tests RED**

Run:

```text
pnpm --filter @dev-cor/frontend test src/modules/leads/LeadDetailPage.spec.ts
```

Expected: FAIL because review decisions are not rendered.

- [ ] **Step 3: Add the read-only review record**

Render a separate card only when `lead.reviewDecision !== null`, using the same labels and Asia/Shanghai timestamp as the client. Leave existing push record, edit/push capabilities and attachments unchanged.

- [ ] **Step 4: Run operations detail tests GREEN**

Run the Task 9 test command.

Expected: PASS.

- [ ] **Step 5: Commit operations visibility**

```text
git add frontend/src/modules/leads/LeadDetailPage.*
git commit -m "feat: show client review on lead detail"
```

### Task 10: PostgreSQL, migration and real-browser acceptance

**Files:**

- Modify: `tests/support/core-lead-database.mjs`
- Modify: `tests/support/core-lead-database.d.mts`
- Modify: `tests/e2e/core-leads.spec.ts`

**Interfaces:**

- Produces fixture helpers for counting/retrieving review decisions and receipts, fault injection, binding/account/customer revocation, and migration probes.
- Browser chain uses real password login, Cookie/CSRF session, PostgreSQL rows and real screenshot bytes.

- [ ] **Step 1: Add failing database helper and API integration assertions**

Add helpers with these stable names:

```ts
getLeadReviewDecision(leadId);
countLeadReviewDecisions(leadId);
countClientLeadReviewReceipts(leadId);
rejectLeadReviewDecisionWrites();
rejectClientLeadReviewReceiptWrites();
```

Before deleting leads, the isolated reset must execute exactly `TRUNCATE TABLE "client_lead_review_receipts", "lead_review_decisions"` after the existing `NODE_ENV=test`, isolated URL and actual database-name guards. `TRUNCATE` does not fire the production `DELETE` barrier and does not weaken normal application tests; do not use `CASCADE` or truncate any pre-existing business table.

- [ ] **Step 2: Extend migration execution tests**

Update `runCoreLeadMigrationTest()` to prove:

- empty-schema migration creates both review tables;
- previous supported schema upgrades without rewriting existing lead facts;
- action migration is retry-safe;
- structural migration failure rolls back both tables and trigger;
- decision `UPDATE` and `DELETE` return SQLSTATE `55000`;
- invalid version pairs and non-review receipt actions are rejected.

Run:

```text
pnpm test:e2e:core-ld -- --grep "core lead migrations"
```

Expected before implementation: FAIL for missing review migration results. Expected after helper/migration work: PASS.

- [ ] **Step 3: Add database-backed command coverage**

Extend the API test section to cover normal confirmation, cross-enterprise denial, hidden `WAITING_PUSH`, inactive account/binding, non-admitted customer, wrong state, stale version, same-key replay, same-key conflict, two-key concurrency, decision failure rollback, receipt failure rollback and immediate revocation.

For the concurrency case assert:

```ts
expect(responses.filter((response) => response.status() === 201)).toHaveLength(
  1,
);
expect(responses.filter((response) => response.status() === 409)).toHaveLength(
  1,
);
expect(await countLeadReviewDecisions(lead.id)).toBe(1);
expect(await countClientLeadReviewReceipts(lead.id)).toBe(1);
```

- [ ] **Step 4: Extend the real browser chain**

Continue the existing operator-login/client-account/push test after screenshot refresh:

1. Client sees the lead under `待我审核`.
2. Cancel confirmation once and observe no status change.
3. Accept confirmation and see `已确认侵权` plus the next-step explanation.
4. Reload and download the same screenshot.
5. Return to `已处理` and reopen the lead.
6. Log out, log in as the real operator, open `线索待确认`, and see the same reviewer and timestamp.

- [ ] **Step 5: Run focused database/browser acceptance GREEN**

Run:

```text
pnpm --filter @dev-cor/backend build
pnpm test:e2e:core-ld
```

Expected: all CORE-LD PostgreSQL and Chromium tests PASS with isolated test services only.

- [ ] **Step 6: Commit database and browser acceptance**

```text
git add tests/support/core-lead-database.* tests/e2e/core-leads.spec.ts
git commit -m "test: verify client infringement review end to end"
```

### Task 11: Independent review, Level 3 gates and state closure

**Files:**

- Modify: `docs/spec/v0.1/modules/leads.md`
- Modify: `docs/spec/v0.1/VALIDATION.md`
- Modify: `docs/feature-roadmap.md`
- Modify: `docs/project-status.md`
- Modify only if gate scope changes: `scripts/validation-scopes.mjs`
- Modify only if new files are omitted by formatting scope: `package.json`

**Interfaces:**

- Completion state only after formal pages, API, backend, PostgreSQL, migration, permissions, real account and browser acceptance all pass.
- On success: CORE-LD-003 complete, CORE-LD-004 sole Current, CORE-LD-005 sole Next.

- [ ] **Step 1: Run focused unit tests and fast gate**

Run:

```text
pnpm test:unit:core-ld
pnpm check:fast
```

Expected: PASS. Fix failures and rerun only affected focused tests until the tree is stable.

- [ ] **Step 2: Perform the required independent review**

Freeze the candidate commit/tree, then use one independent `gpt-6-sol` reviewer against the design commit `a9c87cbe36a31be39ae0184d40e414ae2af353bc` and current candidate. Review specifically for enterprise isolation, revocation timing, receipt replay ordering, serializable races, immutable-event enforcement, response redaction, post-review attachment scope and accidental LD-004/005/006 implementation.

Expected: no unresolved Critical or Important findings. Apply valid fixes, add regression tests, and repeat the focused checks affected by each fix.

- [ ] **Step 3: Run the formal stable-candidate gates**

With the reviewed tree unchanged, run:

```text
pnpm verify:slice:core-ld
pnpm verify
```

Expected: both PASS. Reuse results only while commit, tree, environment and inputs remain identical.

- [ ] **Step 4: Update living documentation with actual evidence**

In `leads.md`, record only the implemented infringement branch and keep the no-infringement and evidence branches pending. In `VALIDATION.md`, record exact commands, counts, review result, commit/tree and evidence path. Only after every gate passes, update roadmap/status to:

```text
Completed: CORE-LD-003
Current: CORE-LD-004
Next: CORE-LD-005
```

Do not mark LD-004 or evidence handling as implemented.

- [ ] **Step 5: Commit the implementation closure**

```text
git add docs/spec/v0.1/modules/leads.md docs/spec/v0.1/VALIDATION.md docs/feature-roadmap.md docs/project-status.md package.json scripts/validation-scopes.mjs
git commit -m "docs: close CORE-LD-003 validation"
```

Use pathspecs only for files actually changed; do not create empty or unrelated staged changes.

- [ ] **Step 6: Record and strictly verify context**

Run:

```text
pnpm context:record
pnpm context:check:strict
git status --short --branch
git rev-parse HEAD
git rev-parse 'HEAD^{tree}'
```

Expected: strict context check PASS and clean `codex/core-ld-003-client-confirm-infringement` worktree. Commit the generated context snapshot separately if `context:record` changes it:

```text
git add docs/context-snapshot.json
git commit -m "chore: record CORE-LD-003 context"
```

Report the final commit/tree, evidence location, actual test counts, review result, exclusions and Git status. Do not push or merge.
