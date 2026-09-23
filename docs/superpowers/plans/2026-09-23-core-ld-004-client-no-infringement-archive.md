# CORE-LD-004 Client No-Infringement Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Project `docs/ai-coding.md` and the user's model/reviewer routing override generic per-task reviewer defaults: only high-risk tasks get independent `gpt-6-sol` review; ordinary `gpt-6-luna` tasks use self-review.

**Goal:** Let a real enterprise-bound client give a reasoned `NO_INFRINGEMENT` decision on its own pushed lead, atomically archive it, and let the client and authorized operator read the immutable result and allowed screenshots.

**Architecture:** Extend the existing client review Command and immutable `LeadReviewDecision`, not a parallel archive endpoint or workflow engine. Store `reason`, `archiveType` and `archivedAt` on the immutable decision, keep `Lead` as current state/version only, and extend the exact enterprise-scoped processed query and material read policy. Preserve the byte-for-byte legacy infringement fingerprint and replay snapshot shape.

**Tech Stack:** Node 24.21.0, pnpm 11.27.0, NestJS 11, Prisma 7/PostgreSQL 17, Vue 3/Element Plus, Jest, Vitest and Playwright/Chromium.

## Global Constraints

- Scope is only `WAITING_REVIEW → ARCHIVED` for `result=NO_INFRINGEMENT`; `reason` is trimmed LongText of 1–5000 characters. `archiveType=NO_INFRINGEMENT` and `archivedAt` are server-authored facts.
- CORE-LD-007, the immediate Next slice, will later deliver operator application followed by confirmation from an active authorized account of the original customer enterprise; this plan must not add retraction/reopen UI or Command, erase the original decision, or claim the correction loop complete.
- The client actor must remain a real active `CLIENT` account with active binding to the same admitted customer and department. Never derive client scope from internal `SELF/TEAM/DEPARTMENT` grants; no internal role grant is added.
- Each Command rechecks identity, binding, admission, push facts, status and `expectedVersion` inside the Serializable transaction. State, immutable decision and immutable receipt commit or roll back together.
- Existing `INFRINGEMENT` payload, fingerprint, response and historical receipt replay remain compatible. A reused key with a different result, normalized reason or version conflicts.
- Client list/detail/screenshot access to `ARCHIVED` must require `reviewDecision.result=NO_INFRINGEMENT` and matching enterprise; bare `ARCHIVED` is insufficient. Internal read remains scoped by existing `lead.read`.
- Use only new forward migrations; do not edit executed migration SQL or reset the development/production database or persistent volumes. Database tests use the isolated database selected by `backend/.env.test`.
- Use existing auth/CSRF, error response, request helpers, immutable decision/receipt, material version authorization and Demo-aligned components. Do not add a dependency or a general permission/workflow platform.
- Every new PowerShell process running Node/pnpm first dot-loads `Use-ProjectRuntime.ps1` at repo root and checks the locked versions. Keep this task branch local; no push, merge, publish or production migration without new authorization.
- Task 1–3 are high risk (`gpt-6-sol` implementer plus separate `gpt-6-sol` focused reviewer before integration). Task 4–5 are bounded execution tasks (`gpt-6-luna`, self-review, focused tests, concise completion report); escalate immediately on contract, security, migration or transaction conflicts. After integration, an independent `gpt-6-sol` Final Review precedes the Level 3 full gates. Avoid duplicate tests on an unchanged tree.

## File/contract map

| Unit                                                                                             | Responsibility                                                                                                   |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `backend/prisma/schema.prisma`, two new migrations                                               | Add result/archive fact fields and result-specific database CHECK without changing prior migrations or old rows. |
| `backend/src/modules/leads/client-lead-review.dto.ts`, `client-lead.service.ts`                  | Validate/normalize the new request; preserve legacy replay; perform the atomic decision.                         |
| `backend/src/modules/leads/client-lead-response.dto.ts`, `client-lead.service.ts`                | Expose only permitted client decision data and both exact processed states.                                      |
| `backend/src/modules/materials/material.service.ts`, `backend/src/modules/leads/lead.service.ts` | Reauthorize archived screenshot reads; project the same archive facts to scoped operators.                       |
| `frontend/src/api/client-leads.ts`, `frontend/src/api/leads.ts`                                  | Decode the disjoint decision shapes and send the new request without changing the old public function.           |
| `frontend/src/modules/client/*`, `frontend/src/modules/leads/LeadDetailPage.vue`                 | Reason form, consequential confirmation, stable feedback, processed list and operator read-only record.          |
| `tests/support/core-lead-database.*`, `tests/e2e/core-leads.spec.ts`                             | Isolated-PostgreSQL migration/concurrency/rollback and real two-account Chromium chain.                          |

---

### Task 1: Forward migration and immutable archive fact contract

**Model/risk:** `gpt-6-sol`; high-risk schema/migration. Review by a second `gpt-6-sol` before integration.

**Files:** Modify `backend/prisma/schema.prisma`, `backend/src/modules/leads/core-ld-migration.spec.ts`, `tests/support/core-lead-database.mjs`, `tests/support/core-lead-database.d.mts`, and the migration assertion in `tests/e2e/core-leads.spec.ts`; create `backend/prisma/migrations/20260923010000_add_no_infringement_review_result/migration.sql`, `backend/prisma/migrations/20260923011000_add_no_infringement_archive_facts/migration.sql`.

**Interfaces:** Produces Prisma `LeadReviewResult.NO_INFRINGEMENT`, `LeadArchiveType.NO_INFRINGEMENT`, and nullable `LeadReviewDecision.reason: string | null`, `archiveType: LeadArchiveType | null`, `archivedAt: Date | null`. The existing `LeadReviewDecision.leadId` unique constraint stays until CORE-LD-007.

- [ ] **Step 1: Add a failing migration-order/constraint test.** In the existing “hardens review identities” test, replace its `slice(-2)` assertion with the following ordered-neighbor assertion:

```ts
const oldReviewIndex = migrations.indexOf(clientReviewSchemaMigrationName);
expect(migrations.slice(oldReviewIndex, oldReviewIndex + 2)).toEqual([
  clientReviewSchemaMigrationName,
  clientReviewIntegrityMigrationName,
]);
```

Then add these constants alongside the existing migration names and append the new test:

```ts
const resultMigration = '20260923010000_add_no_infringement_review_result';
const archiveMigration = '20260923011000_add_no_infringement_archive_facts';
it('extends immutable review facts in two forward phases', () => {
  expect(migrations.slice(-2)).toEqual([resultMigration, archiveMigration]);
  expect(readMigration(resultMigration)).toContain(
    "ADD VALUE 'NO_INFRINGEMENT'",
  );
  const sql = readMigration(archiveMigration);
  expect(sql).toContain('CREATE TYPE "lead_archive_type"');
  expect(sql).toContain('"reason" TEXT');
  expect(sql).toContain('"archive_type" "lead_archive_type"');
  expect(sql).toContain('"archived_at" TIMESTAMPTZ(3)');
  expect(sql).toContain('lead_review_decisions_result_archive_check');
  expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|DELETE FROM/);
});
```

Run `pnpm --filter @dev-cor/backend test src/modules/leads/core-ld-migration.spec.ts`; expect RED because the two migration files do not exist.

- [ ] **Step 2: Add the exact schema and SQL phases.** Extend the existing Prisma enums/model with these fields; do not remove any existing relation or uniqueness:

```prisma
enum LeadReviewResult {
  INFRINGEMENT
  NO_INFRINGEMENT
  @@map("lead_review_result")
}
enum LeadArchiveType {
  NO_INFRINGEMENT
  @@map("lead_archive_type")
}
// Inside model LeadReviewDecision:
reason      String?          @db.Text
archiveType LeadArchiveType? @map("archive_type")
archivedAt  DateTime?        @map("archived_at") @db.Timestamptz(3)
```

`20260923010000.../migration.sql` contains only `ALTER TYPE "lead_review_result" ADD VALUE 'NO_INFRINGEMENT';`. The second migration contains this complete new SQL (existing columns/keys are untouched):

```sql
BEGIN;
CREATE TYPE "lead_archive_type" AS ENUM ('NO_INFRINGEMENT');
ALTER TABLE "lead_review_decisions"
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "archive_type" "lead_archive_type",
  ADD COLUMN "archived_at" TIMESTAMPTZ(3),
  ADD CONSTRAINT "lead_review_decisions_result_archive_check" CHECK (
    ("result" = 'INFRINGEMENT' AND "reason" IS NULL
      AND "archive_type" IS NULL AND "archived_at" IS NULL)
    OR
    ("result" = 'NO_INFRINGEMENT' AND "reason" IS NOT NULL
      AND "reason" = BTRIM("reason")
      AND CHAR_LENGTH("reason") BETWEEN 1 AND 5000
      AND "archive_type" IS NOT NULL
      AND "archive_type" = 'NO_INFRINGEMENT' AND "archived_at" IS NOT NULL)
  );
COMMIT;
```

- [ ] **Step 3: Probe the real migration path in the existing isolated-schema helper.** Extend `exerciseCoreLeadMigration` with a random schema upgraded from `20260922013000_harden_client_lead_review_integrity`: insert a valid old `INFRINGEMENT` decision and receipt, apply the two new migrations, then assert its `result_snapshot` and fingerprint are identical, the three new fact fields are null, and the old receipt still joins its decision. In the same random schema, use `SAVEPOINT`-protected INSERTs to prove a valid `NO_INFRINGEMENT` row succeeds while blank, overlong, missing archive type/time and mismatched archive facts fail with SQLSTATE `23514`. Existing UPDATE/DELETE immutability probes still reject. Inject a collision in a separate random schema before the second migration and assert transaction rollback leaves no new fact columns or CHECK. Add the resulting booleans to `core-lead-database.d.mts` and assert them in the existing E2E migration test; never operate on `backend/.env` or a persistent volume.
- [ ] **Step 4: Generate and check.** Run `pnpm --filter @dev-cor/backend db:validate`, `pnpm prepare:prisma`, and the migration spec; expect PASS. With the independent `postgres-test` healthy, run `pnpm test:e2e:core-ld --grep "core lead migrations"`; expect PASS in the isolated test DB. The enum phase must commit before the CHECK can compare against its new value. Do not run `prisma migrate dev` against the development DB.
- [ ] **Step 5: Independent reviewer examines SQL/Prisma parity, PostgreSQL enum phase, old INFRINGEMENT rows, CHECK null semantics and forward-upgrade safety.** Fix findings and rerun only affected checks. Commit with `git add backend/prisma/schema.prisma backend/prisma/migrations/20260923010000_add_no_infringement_review_result backend/prisma/migrations/20260923011000_add_no_infringement_archive_facts backend/src/modules/leads/core-ld-migration.spec.ts tests/support/core-lead-database.mjs tests/support/core-lead-database.d.mts tests/e2e/core-leads.spec.ts` and `git commit -m "feat: persist no-infringement archive facts"`.

### Task 2: Client review Command and old-receipt compatibility

**Model/risk:** `gpt-6-sol`; high-risk identity, transaction, concurrency and idempotency. Separate `gpt-6-sol` focused review before integration.

**Files:** Modify `backend/src/modules/leads/client-lead-review.dto.ts`, `client-lead-response.dto.ts`, `client-lead.service.ts`, `client-lead.controller.spec.ts`, `client-lead.service.spec.ts`, `backend/src/core-ld-openapi.spec.ts`.

**Interfaces:** `ReviewClientLeadDto` accepts `{result:'INFRINGEMENT',expectedVersion}` unchanged or `{result:'NO_INFRINGEMENT',reason:string,expectedVersion}`. `ClientLeadService.review(actor,id,key,input)` returns the legacy infringement snapshot or the exact new `ARCHIVED` snapshot. No new route or permission action.

- [ ] **Step 1: Write RED DTO/service tests.** In controller tests accept the new request after trim, reject missing/blank/over-5000/non-string reasons and reject a reason attached to `INFRINGEMENT`; retain old infringement acceptance. In service tests assert a no-infringement success writes `Lead.status='ARCHIVED'`, version `+1`, one decision with normalized reason/type/timestamp and one receipt; exact-key replay returns the first snapshot; same key with a different reason or result conflicts; legacy INFRINGEMENT receipt replay still returns its original five-key snapshot; decision/receipt failure rolls state back. Concrete assertions:

```ts
expect(result).toMatchObject({
  status: 'ARCHIVED',
  version: 3,
  reviewDecision: {
    result: 'NO_INFRINGEMENT',
    reason: '不构成侵权',
    archiveType: 'NO_INFRINGEMENT',
  },
});
expect(transaction.lead.updateMany).toHaveBeenCalledWith(
  expect.objectContaining({
    where: expect.objectContaining({ status: 'WAITING_REVIEW', version: 2 }),
    data: { status: 'ARCHIVED', version: { increment: 1 } },
  }),
);
expect(transaction.clientLeadReviewReceipt.create).toHaveBeenCalledTimes(1);
```

Run `pnpm --filter @dev-cor/backend test src/modules/leads/client-lead.controller.spec.ts src/modules/leads/client-lead.service.spec.ts src/core-ld-openapi.spec.ts`; expect RED on the new assertions.

- [ ] **Step 2: Validate the input and preserve historical fingerprint bytes.** Keep `expectedVersion` integer `>=1`; in `ReviewClientLeadDto` add these exact decorators, using the same safe string-only trim pattern as `lead.dto.ts`:

```ts
@ApiProperty({enum: ['INFRINGEMENT', 'NO_INFRINGEMENT']})
@IsIn(['INFRINGEMENT', 'NO_INFRINGEMENT'])
result!: 'INFRINGEMENT' | 'NO_INFRINGEMENT';

@ApiPropertyOptional({maxLength: 5000})
@Transform(({value}: {value: unknown}) =>
  typeof value === 'string' ? value.trim() : value)
@IsOptional()
@IsString()
@MaxLength(5000)
reason?: string;
```

In `ClientLeadService.review`, reject an absent/empty reason for `NO_INFRINGEMENT` and any supplied reason for `INFRINGEMENT` with `{code:'VALIDATION_ERROR'}`; then compute the fingerprint with the exact existing JSON field order for the old branch:

```ts
const request =
  input.result === 'INFRINGEMENT'
    ? {
        leadId: id,
        result: input.result,
        expectedVersion: input.expectedVersion,
      }
    : {
        leadId: id,
        result: input.result,
        reason: input.reason!.trim(),
        expectedVersion: input.expectedVersion,
      };
const fingerprint = createHash('sha256')
  .update(JSON.stringify(request))
  .digest('hex');
```

- [ ] **Step 3: Complete one transactional branch, not a parallel Command.** After the existing `assertClient`, receipt lookup, lead row lock and state/version checks, choose `nextStatus` by result. Use `const decidedAt = new Date()` once; write `decidedAt`, and for no-infringement set `reason`, `archiveType:'NO_INFRINGEMENT'`, `archivedAt:decidedAt` in the immutable decision. The conditional update and receipt remain in the same Serializable transaction:

```ts
const nextStatus =
  input.result === 'INFRINGEMENT' ? 'WAITING_EVIDENCE_DECISION' : 'ARCHIVED';
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
  data: { status: nextStatus, version: { increment: 1 } },
});
if (changed.count !== 1) throw this.versionConflict();
```

Use the existing composite-bound decision/receipt create calls and immutable response snapshot. Update `reviewReceiptResult` to validate both disjoint shapes while accepting unchanged historical INFRINGEMENT snapshots; never fabricate archive fields into an old replay. Keep unique/serialization conflict normalization and post-failure active-binding recheck.

- [ ] **Step 4: Run focused Jest and prepared typecheck.** Run the Step 1 test command, then `pnpm --filter @dev-cor/backend typecheck:prepared`; expect PASS. The independent reviewer checks fingerprint backward compatibility, recheck order, result-specific validation, exactly-once writes, error stability and lack of internal role escalation. Fix findings before integration and commit `backend/src/modules/leads/client-lead-*` plus `backend/src/core-ld-openapi.spec.ts` as `feat: archive no-infringement client reviews`.

### Task 3: Enterprise-scoped processed read and screenshot access

**Model/risk:** `gpt-6-sol`; high-risk tenant isolation and material authorization. Separate `gpt-6-sol` focused review before integration.

**Files:** Modify `backend/src/modules/leads/client-lead.service.ts`, `client-lead-response.dto.ts`, `lead.service.ts`, `lead.service.spec.ts`, `client-lead.service.spec.ts`, `backend/src/modules/materials/material.service.ts`, `material.service.spec.ts`.

**Interfaces:** Client `PROCESSED` is exactly `WAITING_EVIDENCE_DECISION` with `INFRINGEMENT` decision OR `ARCHIVED` with `NO_INFRINGEMENT` decision and archive facts. Client detail and `LEAD_SCREENSHOT` authorization use the same predicate; operator detail continues to require existing `lead.read` scope.

- [ ] **Step 1: Write RED scope/projection tests.** Add one processed INFRINGEMENT and one archived NO_INFRINGEMENT lead, and an archived lead with no matching decision. Assert list/detail/material download return only the first two for their bound enterprise; cross-enterprise, `WAITING_PUSH` and unrelated archived materials remain not-found. Assert operator detail contains the same reason/type/time but not a new write capability. Keep all existing redaction assertions. For example:

```ts
expect(result.items.map((item) => item.status)).toEqual([
  'ARCHIVED',
  'WAITING_EVIDENCE_DECISION',
]);
expect(result.items[0].reviewDecision).toMatchObject({
  result: 'NO_INFRINGEMENT',
  reason: '不构成侵权',
  archiveType: 'NO_INFRINGEMENT',
});
expect(JSON.stringify(result.items[0])).not.toContain('operator-secret');
```

Run `pnpm --filter @dev-cor/backend test src/modules/leads/client-lead.service.spec.ts src/modules/leads/lead.service.spec.ts src/modules/materials/material.service.spec.ts`; expect RED for archived visibility and authorized download.

- [ ] **Step 2: Use one exact predicate at each server read gate.** Keep `departmentId`, bound `customerId`, `pushedAt` and `pushedByUserId` in all client queries. The processed OR and material-owner OR must include result-specific clauses, not `{status:'ARCHIVED'}` alone:

```ts
OR: [
  { status: 'WAITING_EVIDENCE_DECISION',
    reviewDecision: {is: {result: 'INFRINGEMENT'}} },
  { status: 'ARCHIVED',
    reviewDecision: {is: {result: 'NO_INFRINGEMENT',
      archiveType: 'NO_INFRINGEMENT', archivedAt: {not: null}}} },
],
```

The client detail adds the existing `WAITING_REVIEW` arm. The material gate repeats the exact three visible state/decision arms and still restricts owner type to `LEAD`, operation to `read`, and downstream version to current `LEAD_SCREENSHOT` references.

- [ ] **Step 3: Project a disjoint public decision.** Extend both lead includes to select `reason`, `archiveType`, `archivedAt`. Return the old three-key decision for `INFRINGEMENT`; for `NO_INFRINGEMENT` return exactly `{result,reason,reviewerDisplayName,decidedAt,archiveType,archivedAt}`. Update `LeadService.responseSnapshot` and `isLeadResponse` to accept both shapes without rejecting older valid creation/push receipts. Add the no-infringement union branch to the Swagger DTO; no internal user IDs, department/team data or raw audit fields enter the client DTO.
- [ ] **Step 4: Run the focused Jest command from Step 1 and `pnpm --filter @dev-cor/backend typecheck:prepared`; expect PASS.** Reviewer checks each query/material path for tenant scope and archive-type leakage. Commit the backend read/material files and tests as `feat: expose archived client review to its enterprise`.

### Task 4: Typed client request and low-friction review UI

**Model/risk:** `gpt-6-luna`; ordinary API type/UI wiring after Tasks 1–3 contracts are fixed. Self-review; escalate on any new permission or public contract decision.

**Files:** Modify `frontend/src/api/client-leads.ts`, `client-leads.spec.ts`, `frontend/src/api/leads.ts`, `leads.spec.ts`, `frontend/src/modules/client/ClientLeadDetailPage.vue`, `ClientLeadDetailPage.spec.ts`, `ClientLeadListPage.vue`, `ClientLeadListPage.spec.ts`, `frontend/src/modules/leads/LeadDetailPage.vue`, `LeadDetailPage.spec.ts`.

**Interfaces:** Keep `reviewClientLead(id,expectedVersion,key,options)` for infringement callers. Add `reviewClientLeadNoInfringement(id,expectedVersion,reason,key,options)` that posts to the same URL with `result:'NO_INFRINGEMENT'`. Both return the discriminated `ClientLeadReviewResult` union. Keep existing `RequiredFieldMark` and request/error helpers.

- [ ] **Step 1: Write RED Vitest cases.** Assert the new API sends trimmed reason plus same CSRF/session request layer and idempotency header; old `reviewClientLead` still sends only `{result:'INFRINGEMENT',expectedVersion}`. Reject malformed archived decision (`reason` blank, missing `archivedAt`, wrong archive type) and accept the old three-key infringement receipt. UI tests assert required mark, blank reason blocked, cancel leaves no write, confirm sends the form reason, pending state disables both actions, unknown network result retries with the same key/reason, key conflict clears the key, and refreshed archived detail/processed list/operator record display reason and date. Run:

```text
pnpm --filter @dev-cor/frontend test src/api/client-leads.spec.ts src/api/leads.spec.ts src/modules/client/ClientLeadDetailPage.spec.ts src/modules/client/ClientLeadListPage.spec.ts src/modules/leads/LeadDetailPage.spec.ts
```

Expected: RED on new API, form and archived projection cases.

- [ ] **Step 2: Implement exact-key decoder branches and separate send helper.** Preserve the existing `reviewClientLead` signature; add:

```ts
export async function reviewClientLeadNoInfringement(
  id: string,
  expectedVersion: number,
  reason: string,
  idempotencyKey: string,
  options: RequestOptions = {},
): Promise<ClientLeadReviewResult> {
  const value = await requestJson(
    `/client/leads/${encodeURIComponent(id)}/reviews`,
    {
      ...options,
      method: 'POST',
      headers: { ...options.headers, 'Idempotency-Key': idempotencyKey },
      body: {
        result: 'NO_INFRINGEMENT',
        reason: reason.trim(),
        expectedVersion,
      },
    },
  );
  if (!isClientLeadReviewResult(value, expectedVersion))
    throw invalidResponse();
  return value;
}
```

Use a discriminated `ClientLeadReviewDecision` union: old three keys for infringement, six keys for no-infringement. Permit `ARCHIVED` in `PROCESSED` only when the latter decision validates; retain `WAITING_REVIEW` only in `PENDING`. Extend internal `LeadReviewDecision` decoder with the same union.

- [ ] **Step 3: Implement the two real choices without a fake undo.** Use the existing client detail card and shared required mark; add this form fragment only while `lead.capabilities.review && lead.status === 'WAITING_REVIEW'`:

```vue
<label for="no-infringement-reason">不侵权原因<RequiredFieldMark /></label>
<textarea
  id="no-infringement-reason"
  v-model="noInfringementReason"
  data-test="no-infringement-reason"
  maxlength="5000"
/>
<ElButton
  data-test="confirm-no-infringement"
  type="primary"
  :loading="reviewing"
  :disabled="reviewing || !noInfringementReason.trim()"
  @click="confirmNoInfringement"
>判定不侵权并归档</ElButton>
```

On click confirm with `window.confirm('提交后线索将归档，当前版本不能在页面直接撤回。确定判定不侵权吗？')`; keep a separate pending key and frozen normalized reason for this branch until success or definite conflict. After `NETWORK_ERROR`/`TIMEOUT`, preserve and lock that reason for same-key retry or offer refresh to learn the outcome; do not silently send a changed reason under the same key. Refresh after success, and show stable version/state/authorization feedback using the existing review error pattern. The processed list labels the two outcomes by `reviewDecision.result`; client and operator details show the immutable reason and `archivedAt` only for the no-infringement branch. Do not render any CORE-LD-007 control.

- [ ] **Step 4: Run the Step 1 focused Vitest command and `pnpm --filter @dev-cor/frontend typecheck:prepared`; expect PASS.** Self-review changed files, exact-key parsing and error-key retention; report any contract risk to the main agent. Commit these frontend files as `feat: let clients archive no-infringement leads`.

### Task 5: Isolated database/browser proof and candidate closure

**Model/risk:** `gpt-6-luna` for bounded test implementation and evidence collection; migration/transaction/security findings go to `gpt-6-sol` immediately. Main agent owns integration and final status.

**Files:** Modify `tests/e2e/core-leads.spec.ts`; after verified candidate only, modify `docs/spec/v0.1/modules/leads.md`, `docs/feature-roadmap.md`, `docs/project-status.md`, `docs/spec/v0.1/VALIDATION.md`, `docs/context-snapshot.json`.

**Interfaces:** Extend existing `reviewLead` test helper to accept `result` and `reason` while preserving default infringement behavior. Task 1 already proves empty/upgrade/rollback migration in `exerciseCoreLeadMigration`; Task 5 does not change the DB runner. Isolated test DSN remains the only writable database.

- [ ] **Step 1: Add failing real-DB E2E assertions.** Extend the existing `reviewLead` helper without changing its old callers; the new request body is explicit:

```ts
function reviewLead(
  request: APIRequestContext,
  leadId: string,
  expectedVersion: number,
  csrfToken: string,
  key = randomUUID(),
  result: 'INFRINGEMENT' | 'NO_INFRINGEMENT' = 'INFRINGEMENT',
  reason?: string,
) {
  const input =
    result === 'INFRINGEMENT'
      ? { result, expectedVersion }
      : { result, reason, expectedVersion };
  return request.post(`/api/v1/client/leads/${leadId}/reviews`, {
    headers: { 'Idempotency-Key': key, 'X-CSRF-Token': csrfToken },
    data: input,
  });
}
```

Test real client login and push → no-infringement with trimmed reason → `ARCHIVED` and persisted decision type/time → same-key replay and different-reason conflict → client processed/detail/screenshot → operator scoped read. Also test foreign customer, unpushed lead, invalid/blank/overlong reason, old version, wrong state, two keys racing, account/binding/admission revocation, and injected decision/receipt failures leaving `WAITING_REVIEW` and zero new facts. Existing infringement E2E remains in the suite. Use the existing `coreLeadFixtures`, `getLeadReviewDecision`, `countLeadReviewDecisions`, `rejectLeadReviewDecisionWrites` and `rejectClientLeadReviewReceiptWrites`; do not create seeded `ARCHIVED` records to fake the main chain.

- [ ] **Step 2: Extend the browser chain.** Follow the existing real-browser chain in `core-leads.spec.ts`, including creation and binding of a real customer account: operator pushes, client signs in, enters the reason and confirms, refreshes, switches to “已处理”, downloads the actual screenshot bytes, signs out, operator signs in and sees the same result. Assert `data-test="client-review-record"` contains the reason and archived timestamp, and `data-test="confirm-no-infringement"` is absent after refresh. Migration probes are owned and independently reviewed in Task 1; do not duplicate them here.
- [ ] **Step 3: Run only the focused database suite during development.** With the independent `postgres-test` healthy and `backend/.env.test` selected by the runner, run `pnpm test:e2e:core-ld`; expect PASS for old and new chains, migrations and rollback. Run `pnpm check:fast` after Tasks 1–4 integration. Capture failures by category; do not repeatedly rerun a passed unchanged check. Commit the E2E test change as `test: cover no-infringement archive end to end`.
- [ ] **Step 4: Freeze the integrated code candidate and request independent `gpt-6-sol` Final Review.** Reviewer reads the approved design, actual full branch diff and focused results, specifically the new archived material gate, old receipt fingerprint/snapshot, SQL constraints, migration upgrade and UI ambiguity. Fix findings, rerun only affected tests and obtain `ACCEPTED` with no blocking findings before final gates.
- [ ] **Step 5: Run Level 3 gates on the stable candidate.** First run `pnpm context:record` and `pnpm context:check:strict` after all code/spec changes, commit the snapshot and confirm a clean fixed HEAD/tree. Then run `pnpm verify` and `pnpm test:e2e:full` once on that candidate; the latter includes real isolated PostgreSQL/Chromium and migration coverage. Do not also run `verify:slice:core-ld` solely to duplicate the same unchanged checks unless its Evidence v2 is an explicit delivery requirement. Record exact commit/tree and outputs; no production DB or release action.
- [ ] **Step 6: Close only the proven slice.** When formal UI/API/backend/PostgreSQL/isolation/migration/browser gates all pass, mark CORE-LD-004 complete, set CORE-LD-007 as sole Current and CORE-LD-005 as sole Next, and record the exact tested tree in `VALIDATION.md`/`project-status.md`. State explicitly that retraction is not yet implemented. Run `pnpm spec:check`, `pnpm context:record`, `pnpm context:check:strict`, check `git diff --check`, and commit the documentary closeout. If any required evidence fails, keep CORE-LD-004 Current and report the blocker instead of advancing it.

## Plan self-check

- The migration/Command/read/UI/E2E tasks cover every current-slice requirement in the approved design; CORE-LD-007 is a mandatory next task, not an invented current implementation.
- Existing infringement replay compatibility is tested in Tasks 2, 4 and 5; tenant/material scope in Tasks 3 and 5; transaction/rollback/concurrency in Tasks 2 and 5; empty/upgrade migration in Tasks 1 and 5.
- Task reports follow `docs/ai-coding.md`: Task, Model, Commit, changed files, tests, PASS/FAIL, contract changes, self-review findings, known risks and Requires Sol attention. High-risk reviews occur before integration; ordinary task review is not repeated by the main agent without a risk signal.
