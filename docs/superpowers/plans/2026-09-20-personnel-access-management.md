# Personnel Access Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a real administrator workflow for creating a second internal user, assigning current-department membership and an existing role, then safely managing account, membership, Team, password, and role-assignment lifecycle.

**Architecture:** Extend the existing `OrganizationService` as the single transaction and authorization boundary, expose it through one guarded organization controller, and add one Vue management workspace backed by a strictly parsed API client. Reuse local-auth password rules, opaque sessions, Team constraints, Grant Boundary, audit events, and authorization revision invalidation; do not add schema, dependencies, role-template editing, or cross-department account administration.

**Tech Stack:** TypeScript 5.9, NestJS 11, Prisma 7, PostgreSQL 17, Vue 3.5, Pinia 3, Element Plus 2.14, Jest 30, Vitest 4, Playwright 1.63, pnpm 11.27.

## Global Constraints

- Implement the approved design in `docs/superpowers/specs/2026-09-20-personnel-access-management-design.md` without widening its scope.
- Every Node or pnpm process starts after `. .\Use-ProjectRuntime.ps1` and verifies Node `v24.21.0` plus pnpm `11.27.0`.
- Use `backend/.env.test` and compose-managed `postgres-test` for database tests; never reset, drop, or write production data.
- No self-management, role-name checks, first-user bypasses, frontend-only authorization, role-template editing, MFA, OIDC, invitation, or second-department membership creation.
- All production behavior is test-first: observe the focused test fail for the missing behavior before implementation.
- This is Level 3: final candidate needs complete `pnpm verify`, identity/authorization database E2E, and Review `ACCEPTED` with zero open findings.

---

### Task 1: Management Read Model and Guarded HTTP Contract

**Files:**

- Create: `backend/src/access-control/organization.dto.ts`
- Create: `backend/src/access-control/organization.controller.ts`
- Create: `backend/src/access-control/organization.controller.spec.ts`
- Modify: `backend/src/access-control/organization.service.ts`
- Modify: `backend/src/access-control/organization.service.spec.ts`
- Modify: `backend/src/access-control/access-control.module.ts`

**Interfaces:**

- Produces `OrganizationService.getManagementContext(actor): Promise<ManagementContext>`.
- Produces `GET /api/v1/organization/management-context` guarded by `ActorContextGuard` and `CsrfGuard`.
- `ManagementContext` contains `capabilities`, authorized `users`, visible `teams`, and only active role templates that the actor could grant.

- [ ] **Step 1: Add failing service tests for read scope and safe projection**

```ts
it('returns only same-Team users to a TEAM-scoped reader', async () => {
  const fixture = createFixture({
    actorTeamId: 'team-a',
    actorGrants: [
      { action: 'USER_READ', scope: 'TEAM' },
      { action: 'TEAM_READ', scope: 'TEAM' },
      { action: 'ROLE_READ', scope: 'TEAM' },
      { action: 'ROLE_ASSIGN', scope: 'TEAM' },
      { action: 'CUSTOMER_READ', scope: 'TEAM' },
    ],
  });

  const result = await fixture.service.getManagementContext(actor);

  expect(result.users.map((user) => user.id)).toEqual([
    'actor-user',
    'same-team-user',
  ]);
  expect(result.teams.map((team) => team.id)).toEqual(['team-a']);
  expect(result.roles.map((role) => role.id)).toEqual(['covered-team-role']);
});
```

Add separate tests for DEPARTMENT, SELF, inactive Team, missing read grants, inactive templates, uncovered grants, and responses that omit `passwordHash`, sessions, external subject, and other-department data.

- [ ] **Step 2: Run the focused RED test**

Run:

```powershell
pnpm --filter @dev-cor/backend test src/access-control/organization.service.spec.ts
```

Expected: FAIL because `getManagementContext` does not exist.

- [ ] **Step 3: Implement the management read model**

Add explicit exported view types and a single query method. Load the actor through `loadCurrentActorGrants`, then issue Prisma queries already constrained to `actor.departmentId`; apply these exact scope rules:

```ts
type ManagementCapabilities = {
  createUser: boolean;
  manageUsers: boolean;
  createTeam: boolean;
  manageTeams: boolean;
  assignDepartmentRoles: boolean;
  assignTeamRoles: boolean;
};

type ManagementContext = {
  capabilities: ManagementCapabilities;
  users: Array<{
    id: string;
    displayName: string;
    username: string;
    accountActive: boolean;
    membership: { id: string; active: boolean; teamId: string | null };
    assignments: Array<{
      id: string;
      roleTemplateId: string;
      roleName: string;
      teamId: string | null;
      active: boolean;
      version: number;
    }>;
  }>;
  teams: Array<{ id: string; name: string; status: 'ACTIVE' | 'INACTIVE' }>;
  roles: Array<{
    id: string;
    name: string;
    grants: Array<{ action: PermissionAction; scope: PermissionScope }>;
  }>;
};
```

Never query users without a current-department membership join. USER_READ/TEAM filters to the actor's active Team, USER_READ/SELF returns only the actor, TEAM_READ/TEAM returns only the actor Team, and missing read permission returns an empty projection plus false capabilities. Role results require `ROLE_READ`, active templates, and complete coverage through `coversAssignedGrant` for a valid target scope.

- [ ] **Step 4: Add DTOs and controller contract tests first**

```ts
it('forwards the trusted actor to the management context query', async () => {
  const service = {
    getManagementContext: jest.fn().mockResolvedValue(context),
  };
  const controller = new OrganizationController(service as never);

  await expect(controller.getManagementContext(actor)).resolves.toBe(context);
  expect(service.getManagementContext).toHaveBeenCalledWith(actor);
});
```

Also assert all routes reject a missing trusted actor through the real Nest test app and that invalid UUID/body input fails before service invocation.

- [ ] **Step 5: Implement and register the controller**

```ts
@ApiTags('organization')
@ApiBearerAuth()
@Controller('organization')
@UseGuards(ActorContextGuard, CsrfGuard)
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  @Get('management-context')
  getManagementContext(@CurrentActor() actor: ActorContext) {
    return this.organization.getManagementContext(actor);
  }
}
```

Register the controller in `AccessControlModule`; export only the service, not Prisma.

- [ ] **Step 6: Verify Task 1 and commit**

Run the organization service/controller tests and `pnpm check:fast`. Expected: PASS with no warnings.

Commit:

```powershell
git add backend/src/access-control
git commit -m "feat: expose personnel management context"
```

### Task 2: Atomic Personnel Creation

**Files:**

- Modify: `backend/src/access-control/organization.dto.ts`
- Modify: `backend/src/access-control/organization.controller.ts`
- Modify: `backend/src/access-control/organization.controller.spec.ts`
- Modify: `backend/src/access-control/organization.service.ts`
- Modify: `backend/src/access-control/organization.service.spec.ts`
- Modify: `backend/src/auth/password.ts`
- Modify: `backend/src/auth/password.spec.ts`

**Interfaces:**

- Produces `OrganizationService.createUser(actor, input)`.
- Produces `POST /api/v1/organization/users`.
- Input is `{ displayName, username, password, teamId?, roleTemplateId }`; output omits password and authentication internals.

- [ ] **Step 1: Add failing tests for reusable credential normalization**

Export a helper with this contract:

```ts
export function prepareLocalCredential(
  username: string,
  password: string,
): {
  username: string;
  passwordHash: Promise<string>;
};
```

Test normalized username, 12/128 Unicode password boundaries, and invalid input without changing `verifyPassword` behavior. Run `password.spec.ts` and confirm RED.

- [ ] **Step 2: Implement the minimal password helper and make its tests green**

The helper must call existing `normalizeUsername` and `hashPassword`; it must not log or retain plaintext beyond the request lifetime.

- [ ] **Step 3: Add failing atomic create tests**

```ts
it('creates account, credential, membership, assignment, and audit in one transaction', async () => {
  const fixture = createFixture({
    actorGrants: [
      departmentGrant('USER_MANAGE'),
      departmentGrant('ROLE_ASSIGN'),
      departmentGrant('CUSTOMER_READ'),
    ],
  });

  await fixture.service.createUser(actor, {
    displayName: '运营乙',
    username: 'operator.b',
    password: 'temporary-pass-123',
    teamId: null,
    roleTemplateId: 'target-role',
  });

  expect(fixture.transaction.userAccount.create).toHaveBeenCalledTimes(1);
  expect(fixture.transaction.localCredential.create).toHaveBeenCalledTimes(1);
  expect(fixture.transaction.departmentMembership.create).toHaveBeenCalledTimes(
    1,
  );
  expect(fixture.transaction.roleAssignment.create).toHaveBeenCalledTimes(1);
  expect(fixture.transaction.auditEvent.create).toHaveBeenCalled();
  expect(fixture.database.$transaction).toHaveBeenCalledTimes(1);
});
```

Add tests for missing department USER_MANAGE, self/role escalation, inactive or cross-department Team, TEAM role without Team, duplicate username mapping to `USERNAME_ALREADY_EXISTS`, blank/overlong display name, and injected failure proving no outer partial commit.

- [ ] **Step 4: Refactor role assignment into a transaction-local helper**

Keep public behavior:

```ts
async assignRole(actor: ActorContext, command: AssignRoleCommand) {
  return this.database.$transaction(
    (transaction) => this.assignRoleInTransaction(transaction, actor, command),
    { isolationLevel: 'Serializable' },
  );
}
```

`createUser` must call the same Grant Boundary logic with the newly created target membership and the same transaction. It must not call public `assignRole()` or open a nested transaction.

- [ ] **Step 5: Implement DTO/controller and make create tests green**

Use class-validator DTOs with trimmed display name, username length 3–64, password length 12–128, UUID v4 role/Team IDs, and `teamId` optional. Map Prisma unique conflict `P2002` on username to `409 USERNAME_ALREADY_EXISTS`; do not expose Prisma metadata.

- [ ] **Step 6: Verify Task 2 and commit**

Run password, organization service, and organization controller tests plus `pnpm check:fast`. Expected: PASS.

Commit:

```powershell
git add backend/src/access-control backend/src/auth/password.ts backend/src/auth/password.spec.ts
git commit -m "feat: create personnel atomically"
```

### Task 3: Account, Membership, Password, and Role Lifecycle

**Files:**

- Modify: `backend/src/access-control/organization.dto.ts`
- Modify: `backend/src/access-control/organization.controller.ts`
- Modify: `backend/src/access-control/organization.controller.spec.ts`
- Modify: `backend/src/access-control/organization.service.ts`
- Modify: `backend/src/access-control/organization.service.spec.ts`

**Interfaces:**

- Produces `setUserStatus`, `resetUserPassword`, `updateMembership`, and `setRoleAssignmentStatus`.
- Produces the four lifecycle routes fixed by the design.

- [ ] **Step 1: Add RED tests for account status and multi-department safety**

Cover self-target denial, department USER_MANAGE requirement, exactly-one-active-membership requirement, all-session revocation on deactivate, authorization revision increment, re-enable not restoring sessions, required reason, and `GLOBAL_ACCOUNT_MANAGEMENT_REQUIRED`.

Expected call shape:

```ts
await service.setUserStatus(actor, 'target-user', {
  active: false,
  reason: '离职停用',
});
```

- [ ] **Step 2: Implement account lifecycle and make focused tests green**

Lock actor, target account, current membership, target memberships, assignments, and sessions in the fixed order. Deactivation updates the account, increments revision, revokes every unrevoked target session, and audits the reason in one transaction. Activation never clears `revokedAt`.

- [ ] **Step 3: Add RED tests for password reset with reauthentication**

Cover wrong actor password, actor credential changed between verification and transaction, target multi-department denial, invalid new password, target sessions revoked, target revision incremented, target password changed, and no password material in audit calls.

```ts
await service.resetUserPassword(actor, 'target-user', {
  currentPassword: 'admin-current-pass',
  newPassword: 'target-new-pass-123',
  reason: '本人无法登录',
});
```

- [ ] **Step 4: Implement safe password reset**

Verify actor password outside the transaction, retain the exact verified credential hash/version, then lock and require the stored credential to be unchanged inside the transaction. Hash the target password outside the transaction. A mismatch returns `REAUTHENTICATION_FAILED`; success updates `passwordHash` and `passwordChangedAt`, revokes target sessions, increments revision, and audits only the reason.

- [ ] **Step 5: Add RED tests for membership and role lifecycle**

Cover membership deactivate/reactivate, department-session revocation, self-target denial, Team change using the existing active-team-assignment conflict, role revoke, already-inactive conflict, restore through full Grant Boundary, stale/non-target assignment denial, revision increments, and required reasons.

- [ ] **Step 6: Implement membership and role lifecycle**

Use these signatures:

```ts
updateMembership(actor, targetUserId, {
  active?: boolean;
  teamId?: string | null;
  reason: string;
})

setRoleAssignmentStatus(actor, targetUserId, assignmentId, {
  active: boolean;
  reason: string;
})
```

Reject a DTO that supplies neither `active` nor `teamId`; do not use truthiness to distinguish an explicit `null` Team. Restore routes reuse the current role and stored Team through `assignRoleInTransaction` and therefore recheck every grant.

- [ ] **Step 7: Wire DTO/controller routes, verify, and commit**

Run all access-control and auth unit/contract tests plus `pnpm check:fast`. Expected: PASS.

Commit:

```powershell
git add backend/src/access-control
git commit -m "feat: manage personnel lifecycle"
```

### Task 4: Team Lifecycle and Durable Denial Audit

**Files:**

- Modify: `backend/src/access-control/organization.dto.ts`
- Modify: `backend/src/access-control/organization.controller.ts`
- Modify: `backend/src/access-control/organization.controller.spec.ts`
- Modify: `backend/src/access-control/organization.service.ts`
- Modify: `backend/src/access-control/organization.service.spec.ts`

**Interfaces:**

- Exposes existing `createTeam` and `setTeamStatus` through HTTP.
- Produces sanitized durable `access-control.denied` audit events for self-escalation, uncovered grants, and cross-department attempts.

- [ ] **Step 1: Add failing Team HTTP contract tests**

Assert `POST /organization/teams` and `PATCH /organization/teams/:teamId/status` validate DTOs, forward actor/UUID, require CSRF for session writes, and preserve 403/409 service errors.

- [ ] **Step 2: Add failing rejection-audit tests**

```ts
await expect(
  fixture.service.assignRole(actor, {
    targetUserId: 'other-department-user',
    roleTemplateId: 'target-role',
    teamId: null,
  }),
).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });

expect(fixture.database.$transaction).toHaveBeenCalledTimes(2);
expect(fixture.transaction.auditEvent.create).toHaveBeenCalledWith({
  data: expect.objectContaining({
    departmentId: actor.departmentId,
    actorUserId: actor.userId,
    resourceType: 'access-control-attempt',
    resourceId: 'membership-actor',
    action: 'access-control.denied',
    details: { operation: 'role.assign', code: 'FORBIDDEN' },
  }),
});
```

Assert details contain no target ID, username, password, token, or Prisma error. Audit failure must still return the original denial and invoke the service logger with a sanitized audit-failure event.

- [ ] **Step 3: Implement a bounded command wrapper**

Catch only known authorization denials from public management commands. After the failed business transaction, persist a separate current-department audit using the actor membership as resource. Never convert validation, conflict, database, or programmer errors into authorization denials.

- [ ] **Step 4: Verify Task 4 and commit**

Run organization tests and `pnpm check:fast`. Expected: PASS.

Commit:

```powershell
git add backend/src/access-control
git commit -m "feat: audit denied personnel changes"
```

### Task 5: Typed Frontend API and Personnel Workspace

**Files:**

- Create: `frontend/src/api/organization.ts`
- Create: `frontend/src/api/organization.spec.ts`
- Create: `frontend/src/modules/settings/PeopleAccessPage.vue`
- Create: `frontend/src/modules/settings/PeopleAccessPage.spec.ts`
- Modify: `frontend/src/app/App.vue`
- Modify: `frontend/src/app/App.spec.ts`
- Modify: `frontend/src/app/router.ts`
- Modify: `frontend/src/app/router.spec.ts`
- Modify: `frontend/src/styles.css`

**Interfaces:**

- Produces a strict parser and one function for every organization endpoint.
- Produces route `/settings/people-access` and a capability-controlled navigation link.

- [ ] **Step 1: Add RED API parser tests**

Test a full valid management context and reject malformed capability booleans, missing membership, invalid Team status, malformed grants, password-bearing unexpected shapes, and lifecycle responses missing required fields.

```ts
expect(await getManagementContext()).toEqual(validContext);
expect(fetch).toHaveBeenCalledWith(
  '/api/v1/organization/management-context',
  expect.objectContaining({ credentials: 'same-origin' }),
);
```

- [ ] **Step 2: Implement the typed API client**

Export `getManagementContext`, `createUser`, `setUserStatus`, `resetUserPassword`, `updateMembership`, `assignRole`, `setRoleAssignmentStatus`, `createTeam`, and `setTeamStatus`. Route parameters use `encodeURIComponent`; write functions use existing `requestJson` so CSRF and 401 recovery remain centralized.

- [ ] **Step 3: Add RED page tests for the opening flow**

Mount with a memory router and mock only the typed API boundary. Assert loading/error/retry, authorized list projection, create form submission, TEAM-required guidance, password clearing after request, new user appearing after reload, and no controls when capabilities are false.

- [ ] **Step 4: Implement opening-flow UI**

Use Element Plus imports from component subpaths. Keep one page with a people ledger, Team panel, and dialogs; do not introduce a second state library. Abort in-flight context requests on unmount. Preserve form values on 409 except password fields, which are always cleared.

- [ ] **Step 5: Add RED lifecycle interaction tests**

Cover account/membership status reason dialog, reset requiring current and new password, role revoke/restore, Team create/status, active-Team-role conflict guidance, forbidden state, and 401 delegating to the existing auth store.

- [ ] **Step 6: Implement lifecycle interactions and navigation**

`App.vue` loads only the minimal management context needed to decide navigation visibility, caches it for the current authorization revision, and clears it when the session changes. Direct routing remains possible; the page handles 403 explicitly.

- [ ] **Step 7: Verify Task 5 and commit**

Run focused API/page/router/App Vitest suites and `pnpm check:fast`. Expected: PASS.

Commit:

```powershell
git add frontend/src/api/organization.* frontend/src/modules/settings frontend/src/app frontend/src/styles.css
git commit -m "feat: add personnel access workspace"
```

### Task 6: Real PostgreSQL and Browser Acceptance

**Files:**

- Create: `tests/e2e/personnel-access.spec.ts`
- Create: `tests/support/personnel-access-database.mjs`
- Modify: `tests/support/customer-database.mjs`
- Modify: `package.json`

**Interfaces:**

- Produces `test:e2e:personnel-access` using the existing `scripts/run-e2e.mjs` wrapper.
- Proves UI → API → service → PostgreSQL → session/authorization behavior without direct insertion of the person being accepted.

- [ ] **Step 1: Add a focused E2E entry and a failing opening-flow test**

Add:

```json
"test:e2e:personnel-access": "node scripts/run-e2e.mjs tests/e2e/personnel-access.spec.ts"
```

The test bootstraps only the initial administrator and fixed role/Team fixtures, then uses the UI to create the accepted person:

```ts
test('administrator creates a person who logs in with the assigned scope', async ({
  page,
}) => {
  await loginAsBootstrapAdministrator(page);
  await page.goto('/settings/people-access');
  await page.getByTestId('create-person').click();
  await page.getByLabel('姓名').fill('运营乙');
  await page.getByLabel('用户名').fill('operator.b');
  await page.getByLabel('初始密码').fill('temporary-pass-123');
  await page.getByLabel('角色').selectOption(roleId);
  await page.getByRole('button', { name: '创建人员' }).click();
  await logout(page);
  await login(page, 'operator.b', 'temporary-pass-123');
  await expect(page).toHaveURL('/customers');
  await expect(page.getByText('仅本人客户')).toBeVisible();
});
```

Run and confirm RED because the route/API does not yet satisfy the real chain or fixtures are incomplete.

- [ ] **Step 2: Add database probes and make the opening path green**

Probe that account, credential, membership, assignment, and audit rows exist after UI creation, and that no plaintext password appears in audit or logs. Do not insert the accepted person directly.

- [ ] **Step 3: Add lifecycle and negative acceptance tests**

Cover role revoke, Team conflict then explicit revoke-and-move, membership deactivate/reactivate, account deactivate/reactivate, password reset with wrong and correct administrator reauthentication, old password/session invalidation, multi-department global-operation denial, cross-department known UUID, self-target, uncovered role, and transaction fault rollback.

- [ ] **Step 4: Run focused database/browser E2E and commit**

Run `pnpm test:e2e:personnel-access`; expected PASS. Then rerun focused auth E2E because password/session behavior changed; expected PASS.

Commit:

```powershell
git add tests/e2e/personnel-access.spec.ts tests/support package.json
git commit -m "test: verify personnel access lifecycle"
```

### Task 7: Specifications, Final Candidate, and Level 3 Gates

**Files:**

- Modify: `docs/spec/v0.1/modules/settings.md`
- Modify: `docs/spec/v0.1/TECHNICAL-DESIGN.md`
- Modify: `docs/spec/v0.1/VALIDATION.md`
- Modify: `docs/feature-roadmap.md`
- Modify: `docs/project-status.md`
- Modify: `docs/deferred-design.md`

**Interfaces:**

- Records only implemented facts and keeps role-template editing, MFA, recovery, OIDC, cross-department global administration, push, release, and production work out of scope.

- [ ] **Step 1: Update affected living facts before freezing the candidate**

Mark roadmap 07 complete only if UI, API, database, authorization, session invalidation, browser acceptance, and Review evidence all exist. Otherwise record the exact partial state. Update REQ-SY-004 and technical design without claiming role-template editing is complete.

- [ ] **Step 2: Run focused checks on the final working tree**

Run backend organization/auth suites, frontend organization/page/router suites, `pnpm check:fast`, affected Prettier checks, `pnpm spec:check`, `pnpm test:e2e:personnel-access`, and `pnpm test:e2e:auth`. Expected: all PASS.

- [ ] **Step 3: Freeze a clean candidate and execute full Level 3 verification**

Commit the final docs, confirm clean status, and record HEAD/tree. Run:

```powershell
pnpm verify
pnpm test:e2e:full
```

Expected: PASS on the same clean candidate and locked environment. Do not refresh or reinterpret evidence after changing the tree.

- [ ] **Step 4: Obtain required Review and close findings**

Review against the approved design, final diff, test evidence, transaction boundaries, multi-department safety, session invalidation, rejection audit, and frontend authorization. Required result: `ACCEPTED`, Critical 0, Important 0, Minor 0. Any fix creates a new candidate and invalidates affected evidence.

- [ ] **Step 5: Deliver without push or release**

Report candidate commit/tree, completed behavior, verification evidence, Review result, known risks, and clean Git status. Do not merge, push, publish, migrate production, or process real users without new authorization.
