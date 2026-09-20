# Role Template Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development while implementing each task, superpowers:systematic-debugging for unexpected failures, and superpowers:verification-before-completion before claiming completion. Execute the tasks in order because the permission migration and API contract are prerequisites for the UI and E2E work.

**Goal:** Deliver a real current-department workflow for copying an existing role template, configuring its fixed Grants, editing it with impact preview, and applying changes to assigned users on their next request.

**Architecture:** Add a distinct `ROLE_MANAGE / DEPARTMENT` authorization boundary and a focused `RoleTemplateService` inside the existing access-control module. Use full-set Grant commands, Serializable transactions, template optimistic versions, and authorization-revision invalidation. Extend the existing People & Access workspace with one compact role-template panel and one shared copy/edit form; do not add a policy language, approval workflow, cross-department administration, or template lifecycle controls.

**Tech Stack:** TypeScript 5.9, NestJS 11, Prisma 7, PostgreSQL 17, Vue 3.5, Element Plus 2.14, Jest 30, Vitest 4, Playwright 1.63, pnpm 11.27.

## Global Constraints

- Implement the approved design in `docs/superpowers/specs/2026-09-20-role-template-management-design.md` without widening its scope.
- Start every Node or pnpm process from the repository root after `. .\Use-ProjectRuntime.ps1`; expected Node is `v24.21.0` and pnpm is `11.27.0`.
- Use only `backend/.env.test` and the compose-managed `postgres-test` for database tests. Never reset, drop, or write production data.
- `ROLE_ASSIGN` remains assignment-only. Template writes require `ROLE_MANAGE / DEPARTMENT`, and every resulting Grant requires the actor's matching Action at `DEPARTMENT` scope.
- The UI must be direct: one prefilled form, checkbox plus scope select, automatic impact preview, and one save. Do not add reason fields, approval, repeated password entry, or a multi-step wizard.
- Every production behavior is test-first: observe the focused test fail for the missing behavior before implementing it.
- This is Level 3 and Q2 (`ASTRA_THEN_SPARK`): the fixed final candidate requires migration coverage, focused DB/browser E2E, full `pnpm verify`, and an independent Review with `ACCEPTED` and zero open findings.

---

### Task 1: Fix the Permission Contract and Forward Migrations

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260920030000_add_role_manage_action/migration.sql`
- Create: `backend/prisma/migrations/20260920040000_backfill_role_manage_grant/migration.sql`
- Modify: `backend/src/access-control/access-control.service.ts`
- Modify: `backend/src/access-control/prisma-access-control.store.ts`
- Modify: `backend/src/access-control/organization-response.dto.ts`
- Create: `backend/src/access-control/role-template-migration.spec.ts`
- Modify: `backend/src/auth/bootstrap-local-account.service.spec.ts`
- Modify: `frontend/src/api/organization.ts`
- Modify: `frontend/src/api/organization.spec.ts`
- Modify: `tests/support/customer-database.mjs`

**Interfaces:**

- Adds Prisma enum member `ROLE_MANAGE @map("role.manage")`.
- Adds application action `role.manage` and the complete Prisma-to-domain mapping.
- Preserves unknown-action rejection in backend types and strict frontend parsing.
- Backfills only the same structurally verified, unshared bootstrap role used by the existing management-action migration.

- [ ] **Step 1: Add RED contract and migration tests**

Add expectations that the generated/bootstrap action set contains `ROLE_MANAGE / DEPARTMENT`, the frontend accepts exactly `ROLE_MANAGE`, and migration fixtures prove:

```ts
expect(grants).toContainEqual({
  action: 'ROLE_MANAGE',
  scope: 'DEPARTMENT',
});
```

The migration contract test must verify the two ordered files, enum-only first phase, transaction and lock boundaries, structural bootstrap predicate, deterministic ID, conflict handling, and the absence of role-name or username selection. Actual upgrade fixtures for a shared role and a non-bootstrap role are added in Task 7 and must prove neither receives `role.manage`.

- [ ] **Step 2: Run the RED tests**

```powershell
pnpm --filter @dev-cor/backend test src/auth/bootstrap-local-account.service.spec.ts
pnpm --filter @dev-cor/frontend test src/api/organization.spec.ts
pnpm --filter @dev-cor/backend test src/access-control/role-template-migration.spec.ts
```

Expected: fail because `ROLE_MANAGE` and its migrations do not exist.

- [ ] **Step 3: Add the enum and application mappings**

Extend every exhaustive action list:

```prisma
ROLE_READ   @map("role.read")
ROLE_ASSIGN @map("role.assign")
ROLE_MANAGE @map("role.manage")
```

```ts
export type PermissionAction =
  // existing actions
  'role.read' | 'role.assign' | 'role.manage';
```

Keep the DTO and frontend sets explicit so unexpected server actions still produce `INVALID_RESPONSE`.

- [ ] **Step 4: Write the two forward migrations**

The first migration is enum-only and commits before any use:

```sql
BEGIN;
ALTER TYPE "permission_action" ADD VALUE 'role.manage';
COMMIT;
```

The second migration starts a new transaction, locks `department_memberships`, `role_assignments`, `role_templates`, `role_grants`, `local_credentials`, and `user_accounts`, reproduces the exact structural bootstrap predicate from `20260920020000_add_team_master_data`, inserts deterministic `role.manage / DEPARTMENT` Grants with `ON CONFLICT DO NOTHING`, and increments only the affected bootstrap accounts' authorization revisions. Never select by role name or username.

- [ ] **Step 5: Run generation and GREEN tests**

```powershell
pnpm prepare:prisma
pnpm --filter @dev-cor/backend test src/auth/bootstrap-local-account.service.spec.ts
pnpm --filter @dev-cor/frontend test src/api/organization.spec.ts
pnpm --filter @dev-cor/backend test src/access-control/role-template-migration.spec.ts
pnpm --filter @dev-cor/backend db:validate
```

- [ ] **Step 6: Commit the permission foundation**

```powershell
git add backend/prisma backend/src/access-control/access-control.service.ts backend/src/access-control/prisma-access-control.store.ts backend/src/access-control/organization-response.dto.ts backend/src/access-control/role-template-migration.spec.ts backend/src/auth/bootstrap-local-account.service.spec.ts frontend/src/api/organization.ts frontend/src/api/organization.spec.ts tests/support/customer-database.mjs
git commit -m "feat: add role template management permission"
```

---

### Task 2: Add the Role Template Read Model and Impact Preview

**Files:**

- Create: `backend/src/access-control/role-template.service.ts`
- Create: `backend/src/access-control/role-template.service.spec.ts`
- Create: `backend/src/access-control/role-template.controller.ts`
- Create: `backend/src/access-control/role-template.controller.spec.ts`
- Modify: `backend/src/access-control/access-control.module.ts`
- Modify: `backend/src/access-control/organization.service.ts`
- Modify: `backend/src/access-control/organization.service.spec.ts`
- Modify: `backend/src/access-control/organization-response.dto.ts`

**Interfaces:**

```ts
type PermissionCatalogItem = {
  action: PermissionAction;
  label: string;
  scopes: PermissionScope[];
};

type RoleTemplateImpact = {
  roleTemplateId: string;
  version: number;
  activeAssignmentCount: number;
  affectedUsers: Array<{ id: string; displayName: string }>;
};

class RoleTemplateService {
  getImpact(
    actor: ActorContext,
    roleTemplateId: string,
  ): Promise<RoleTemplateImpact>;
}
```

- [ ] **Step 1: Add RED service tests for read authorization**

Cover `ROLE_MANAGE / DEPARTMENT`, TEAM and SELF rejection, `ROLE_READ`-only summary access, inactive assignments excluded, duplicate assignments for one user counted once, and cross-department known UUID concealment. Assert the read model never exposes username, external subject, Team membership, other roles, or other-department data.

- [ ] **Step 2: Add RED management-context tests**

Expect `capabilities.manageRoleTemplates`, role `version`, role `activeAssignmentCount`, and a deterministic `permissionCatalog`. The catalog must enumerate only implemented enum actions, each once, with the three current scopes and a stable Chinese label.

- [ ] **Step 3: Run the focused RED tests**

```powershell
pnpm --filter @dev-cor/backend test src/access-control/role-template.service.spec.ts src/access-control/organization.service.spec.ts
```

- [ ] **Step 4: Implement the read model**

Register `RoleTemplateService` in `AccessControlModule`. Extend `OrganizationService.getManagementContext()` without duplicating authorization logic: derive `manageRoleTemplates` only from a live `ROLE_MANAGE / DEPARTMENT` Grant; query version and distinct active users in the current department; return the permission catalog from one frozen backend constant.

Implement:

```ts
@Get(':roleTemplateId/impact')
@ApiOkResponse({ type: RoleTemplateImpactResponseDto })
getImpact(
  @CurrentActor() actor: ActorContext,
  @Param('roleTemplateId', new ParseUUIDPipe()) roleTemplateId: string,
) {
  return this.roleTemplates.getImpact(actor, roleTemplateId);
}
```

Mount the controller at `organization/role-templates`, guarded by `ActorContextGuard` and `CsrfGuard` like the current organization controller.

- [ ] **Step 5: Add Controller contract tests and run GREEN**

Assert UUID validation, guard metadata, response shapes, and denied-attempt audit delegation. Then run:

```powershell
pnpm --filter @dev-cor/backend test src/access-control/role-template.service.spec.ts src/access-control/role-template.controller.spec.ts src/access-control/organization.service.spec.ts
```

- [ ] **Step 6: Commit the read path**

```powershell
git add backend/src/access-control
git commit -m "feat: expose role template impact preview"
```

---

### Task 3: Implement Atomic Template Copy

**Files:**

- Create: `backend/src/access-control/role-template.dto.ts`
- Modify: `backend/src/access-control/role-template.service.ts`
- Modify: `backend/src/access-control/role-template.service.spec.ts`
- Modify: `backend/src/access-control/role-template.controller.ts`
- Modify: `backend/src/access-control/role-template.controller.spec.ts`
- Modify: `backend/src/access-control/organization.service.ts`

**Interfaces:**

```ts
type RoleGrantInput = {
  action: PermissionAction;
  scope: PermissionScope;
};

type CopyRoleTemplateInput = {
  sourceRoleTemplateId: string;
  name: string;
  grants: RoleGrantInput[];
};

copy(actor: ActorContext, input: CopyRoleTemplateInput): Promise<RoleTemplateView>;
```

- [ ] **Step 1: Add RED validation and authorization tests**

Test trimmed name length 1–100, non-empty Grants, exact enum Action／Scope, duplicate tuple rejection, duplicate department name, inactive source, cross-department source, missing `ROLE_MANAGE`, TEAM／SELF management Grant rejection, actor missing the matching `DEPARTMENT` Grant, and concurrent actor revocation before the transaction lock.

Use stable assertions:

```ts
await expect(service.copy(actor, input)).rejects.toMatchObject({
  response: { code: 'ROLE_TEMPLATE_GRANT_NOT_COVERED' },
});
```

- [ ] **Step 2: Add a RED rollback test**

Inject an audit insert failure after template and Grant creation, then assert no new template or Grant remains. Verify a denial audit contains only operation plus stable code and does not serialize the foreign template UUID or submitted secrets.

- [ ] **Step 3: Run RED**

```powershell
pnpm --filter @dev-cor/backend test src/access-control/role-template.service.spec.ts src/access-control/role-template.controller.spec.ts
```

- [ ] **Step 4: Implement DTO and Serializable command**

The DTO uses nested validation and rejects extra fields through the existing global validation pipe. In `copy()`:

1. normalize and sort Grants before entering the transaction;
2. acquire the current department advisory/sequence lock used by `OrganizationService`;
3. reload actor account, active membership, and live Grants;
4. require `ROLE_MANAGE / DEPARTMENT` and matching `DEPARTMENT` coverage for every resulting Action;
5. lock and validate the active source template in the current department;
6. create template version 1, all Grants, and `role-template.created` audit in one transaction.

Expose the minimal existing lock/audit helpers as package-level collaborators rather than copying SQL or letting the Controller access Prisma.

- [ ] **Step 5: Add `POST /organization/role-templates` and run GREEN**

```ts
@Post()
@ApiCreatedResponse({ type: RoleTemplateResponseDto })
copy(@CurrentActor() actor: ActorContext, @Body() input: CopyRoleTemplateDto) {
  return this.execute(actor, 'role-template.copy', () =>
    this.roleTemplates.copy(actor, input),
  );
}
```

Run:

```powershell
pnpm --filter @dev-cor/backend test src/access-control/role-template.service.spec.ts src/access-control/role-template.controller.spec.ts
pnpm check:fast
```

- [ ] **Step 6: Commit template copy**

```powershell
git add backend/src/access-control
git commit -m "feat: copy role templates with grants"
```

---

### Task 4: Implement Versioned Template Editing and Immediate Invalidation

**Files:**

- Modify: `backend/src/access-control/role-template.dto.ts`
- Modify: `backend/src/access-control/role-template.service.ts`
- Modify: `backend/src/access-control/role-template.service.spec.ts`
- Modify: `backend/src/access-control/role-template.controller.ts`
- Modify: `backend/src/access-control/role-template.controller.spec.ts`
- Modify: `backend/src/auth/auth.service.spec.ts`

**Interfaces:**

```ts
type UpdateRoleTemplateInput = {
  name: string;
  grants: RoleGrantInput[];
  expectedVersion: number;
};

update(
  actor: ActorContext,
  roleTemplateId: string,
  input: UpdateRoleTemplateInput,
): Promise<RoleTemplateView>;
```

- [ ] **Step 1: Add RED version, impact, and rollback tests**

Cover successful full-set replacement, name-only update, `ROLE_TEMPLATE_VERSION_CONFLICT`, duplicate name, inactive/cross-department template, actor editing a template assigned to self, affected users deduplicated, inactive assignments excluded, each affected account revision incremented exactly once, and audit containing before／after Grant summaries plus affected count.

Inject failures during Grant creation, revision update, and audit insert separately; after each, assert the old name, Grants, version, revisions, and audits remain unchanged.

- [ ] **Step 2: Add RED concurrency tests**

Start two updates with the same `expectedVersion`; require one success and one 409. Add a lock-order test in which actor revocation wins before save, proving stale UI capability cannot authorize the command.

- [ ] **Step 3: Run RED**

```powershell
pnpm --filter @dev-cor/backend test src/access-control/role-template.service.spec.ts src/auth/auth.service.spec.ts
```

- [ ] **Step 4: Implement the update transaction**

Use the same actor and department locks as copy, then lock the template, its Grants, active assignments, and affected user accounts in deterministic UUID order. Compare `expectedVersion`, validate the complete resulting set, delete and recreate Grants inside the transaction, increment template version, increment every distinct affected account's authorization revision, and insert `role-template.updated` audit.

Do not revoke sessions directly: the existing auth request path already compares the session's captured authorization revision with the current account value, so the next request becomes unauthorized and re-login reads current Grants.

- [ ] **Step 5: Add PATCH contract and GREEN tests**

```ts
@Patch(':roleTemplateId')
@ApiOkResponse({ type: RoleTemplateResponseDto })
update(
  @CurrentActor() actor: ActorContext,
  @Param('roleTemplateId', new ParseUUIDPipe()) id: string,
  @Body() input: UpdateRoleTemplateDto,
) {
  return this.execute(actor, 'role-template.update', () =>
    this.roleTemplates.update(actor, id, input),
  );
}
```

Run focused backend tests and `pnpm check:fast`.

- [ ] **Step 6: Commit template editing**

```powershell
git add backend/src/access-control backend/src/auth/auth.service.spec.ts
git commit -m "feat: update role template grants atomically"
```

---

### Task 5: Extend the Strict Frontend API

**Files:**

- Modify: `frontend/src/api/organization.ts`
- Modify: `frontend/src/api/organization.spec.ts`

**Interfaces:**

```ts
export type OrganizationPermissionCatalogItem = {
  action: PermissionAction;
  label: string;
  scopes: PermissionScope[];
};

export function getRoleTemplateImpact(id: string): Promise<RoleTemplateImpact>;
export function copyRoleTemplate(
  input: CopyRoleTemplateInput,
): Promise<OrganizationRole>;
export function updateRoleTemplate(
  id: string,
  input: UpdateRoleTemplateInput,
): Promise<OrganizationRole>;
```

- [ ] **Step 1: Add RED parser and request tests**

Require exact keys for extended management context, role version/count, catalog entries, impact responses, and mutation responses. Test request method, encoded path, CSRF behavior through `requestJson`, and request bodies. Unknown Action, Scope, catalog extra field, malformed version, or duplicate catalog Action must reject as `INVALID_RESPONSE`.

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @dev-cor/frontend test src/api/organization.spec.ts
```

- [ ] **Step 3: Implement the types, parsers, and calls**

Keep a single exported literal tuple for known actions/scopes and derive both runtime Set and TypeScript union from it. Do not loosen parsing with `string`, `any`, an index signature, or partial acceptance.

- [ ] **Step 4: Run GREEN and static checks**

```powershell
pnpm --filter @dev-cor/frontend test src/api/organization.spec.ts
pnpm --filter @dev-cor/frontend typecheck
pnpm exec prettier frontend/src/api/organization.ts frontend/src/api/organization.spec.ts --check
```

- [ ] **Step 5: Commit the frontend contract**

```powershell
git add frontend/src/api/organization.ts frontend/src/api/organization.spec.ts
git commit -m "feat: add role template frontend api"
```

---

### Task 6: Build the Simple Copy/Edit Workspace

**Files:**

- Create: `frontend/src/modules/organization/RoleTemplatePanel.vue`
- Create: `frontend/src/modules/organization/RoleTemplatePanel.spec.ts`
- Create: `frontend/src/modules/organization/RoleTemplateEditor.vue`
- Create: `frontend/src/modules/organization/RoleTemplateEditor.spec.ts`
- Modify: `frontend/src/modules/organization/PeopleAccessPage.vue`
- Modify: `frontend/src/modules/organization/PeopleAccessPage.spec.ts`

**Behavior:**

- Lists template name, concise Grants, version, and affected count.
- `复制` opens a prefilled editor with a required new name.
- `编辑` opens the same editor and automatically requests impact.
- Each catalog Action is one checkbox and one scope select; unchecked Actions are omitted.
- One `保存` button performs the command. No reason field, approval, reauthentication, wizard step, or second confirmation.

- [ ] **Step 1: Add RED component tests**

Test capability-hidden write controls, readable list for read-only users, copy prefill, edit prefill, automatic preview loading, Action checkbox behavior, allowed scope options, non-empty selection validation, successful refresh, disabled submit while saving, 409 preserving inputs with refresh guidance, 403 message, and network failure preserving inputs.

```ts
expect(wrapper.find('[data-test="role-template-save"]').exists()).toBe(true);
expect(wrapper.find('[data-test="change-reason"]').exists()).toBe(false);
expect(wrapper.find('[data-test="approval-step"]').exists()).toBe(false);
```

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @dev-cor/frontend test src/modules/organization/RoleTemplateEditor.spec.ts src/modules/organization/RoleTemplatePanel.spec.ts src/modules/organization/PeopleAccessPage.spec.ts
```

- [ ] **Step 3: Implement the editor and panel**

Use existing Element Plus imports and visual conventions. Keep mutation state local to the role-template components; emit `saved` to make `PeopleAccessPage` reload its authoritative management context. Display only the minimal affected-person projection and count. For copy, do not call a create endpoint until the user clicks save.

- [ ] **Step 4: Add page integration and run GREEN**

Insert the panel into the existing page without changing the route or navigation. Run:

```powershell
pnpm --filter @dev-cor/frontend test src/modules/organization/RoleTemplateEditor.spec.ts src/modules/organization/RoleTemplatePanel.spec.ts src/modules/organization/PeopleAccessPage.spec.ts
pnpm --filter @dev-cor/frontend typecheck
pnpm exec prettier frontend/src/modules/organization/RoleTemplateEditor.vue frontend/src/modules/organization/RoleTemplateEditor.spec.ts frontend/src/modules/organization/RoleTemplatePanel.vue frontend/src/modules/organization/RoleTemplatePanel.spec.ts frontend/src/modules/organization/PeopleAccessPage.vue frontend/src/modules/organization/PeopleAccessPage.spec.ts --check
```

- [ ] **Step 5: Commit the UI**

```powershell
git add frontend/src/modules/organization
git commit -m "feat: manage role template grants in people workspace"
```

---

### Task 7: Prove the PostgreSQL and Browser Workflow

**Files:**

- Create: `tests/e2e/role-template-management.spec.ts`
- Modify: `tests/support/customer-database.mjs`
- Modify: `package.json`

**Acceptance flow:**

1. Administrator opens People & Access and copies an existing operator template.
2. The new template has selected Grants in PostgreSQL and appears in the existing role-assignment UI.
3. Administrator assigns it to a real second user; that user logs in and sees exactly the selected customer scope.
4. Administrator edits the template and sees the affected user preview.
5. The user's next authenticated request is rejected because the authorization revision changed.
6. After re-login, the user sees only the updated scope.

- [ ] **Step 1: Add a dedicated E2E script and fixtures**

Add `test:e2e:role-template` invoking `scripts/run-e2e.mjs tests/e2e/role-template-management.spec.ts`. Extend fixture reset with deterministic IDs and only the accounts, departments, teams, customers, templates, Grants, and assignments required by these tests.

- [ ] **Step 2: Add RED browser tests**

Cover the acceptance flow plus duplicate name, stale version, TEAM-only `ROLE_MANAGE`, uncovered Action, known cross-department template UUID, concurrent edits, and forced audit failure rollback. Add an upgrade probe that seeds the pre-migration state with one structurally valid bootstrap role, one shared role, and one non-bootstrap role; deploy the two migrations and assert only the verified bootstrap role receives `role.manage`. Direct API setup may create adversarial inputs, but the main success path must use the formal UI and must not insert the template under test directly.

- [ ] **Step 3: Run RED, finish only missing wiring, then run GREEN**

```powershell
pnpm db:test:up
pnpm db:test:migrate:deploy
pnpm test:e2e:role-template
```

Expected final result: all dedicated role-template browser tests pass against `postgres-test`, and DB assertions confirm versions, Grants, revisions, audit, and rollback.

- [ ] **Step 4: Run adjacent personnel regression**

```powershell
pnpm test:e2e:personnel-access
```

The existing create-person, assign-role, revoke/restore, reset-password, and Team flows must still pass with the extended management-context shape.

- [ ] **Step 5: Commit E2E acceptance**

```powershell
git add tests/e2e/role-template-management.spec.ts tests/support/customer-database.mjs package.json
git commit -m "test: verify role template management workflow"
```

---

### Task 8: Synchronize Living Specs and Fix the Final Candidate

**Files:**

- Modify: `docs/spec/v0.1/modules/settings.md`
- Modify: `docs/spec/v0.1/TECHNICAL-DESIGN.md`
- Modify: `docs/spec/v0.1/VALIDATION.md`
- Modify: `docs/feature-roadmap.md`
- Modify: `docs/project-status.md`
- Modify: `.context-memory.json`

- [ ] **Step 1: Update the authoritative specifications**

Record `ROLE_MANAGE / DEPARTMENT`, full-set copy/edit commands, automatic impact preview, optimistic template version, affected-account revision invalidation, migration backfill rule, and the exact exclusions. Preserve historical statements as historical evidence; do not rewrite them as if the feature existed earlier.

- [ ] **Step 2: Run focused pre-candidate checks**

```powershell
pnpm spec:check
pnpm check:fast
pnpm --filter @dev-cor/backend test src/access-control src/auth/bootstrap-local-account.service.spec.ts
pnpm --filter @dev-cor/frontend test src/api/organization.spec.ts src/modules/organization
pnpm test:e2e:role-template
pnpm test:e2e:personnel-access
```

Fix only failures caused by this Slice, rerunning the smallest affected checks until stable.

- [ ] **Step 3: Record context and freeze the candidate**

```powershell
pnpm context:record
git add .context-memory.json docs
git commit -m "docs: record role template management candidate"
git status --short
git rev-parse HEAD
git rev-parse HEAD^{tree}
```

The worktree must be clean before final evidence starts. If context recording changes after the commit, record and commit once more before verification.

- [ ] **Step 4: Run the Level 3 final gate once on the fixed tree**

```powershell
pnpm verify
pnpm test:e2e:role-template
pnpm test:e2e:personnel-access
git status --short
git rev-parse HEAD
git rev-parse HEAD^{tree}
```

Store exact counts, commit, tree, database target, and timestamps in `VALIDATION.md`. Do not claim a failed or pre-fix run for the final tree.

- [ ] **Step 5: Obtain independent Level 3 Review**

Review the fixed candidate against the approved design and repository rules, including migration safety, authorization escalation, cross-department concealment, concurrency, transaction rollback, strict parsers, and simple UX. Resolve every Critical／Important／Minor finding, rerun affected focused tests, then refreeze and repeat the final gate if the candidate tree changed.

- [ ] **Step 6: Close status only after all evidence exists**

When and only when the UI, API, PostgreSQL, authorization, migration, E2E, full verify, and Review are all successful:

- mark roadmap item 03 complete within its stated customer-domain boundary;
- clear Current Slice;
- retain “多联系人及客户关系维护” as the unique Next Slice;
- record Review `ACCEPTED`, zero open findings, final commit/tree, and current Git state.

Do not merge, push, publish, or apply production migrations without a separate explicit instruction.
