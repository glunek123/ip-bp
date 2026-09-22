# Rapid Onboarding UX Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the implemented customer-to-client lead flow understandable and predictable for first-time users without changing its business states, authorization, or data isolation.

**Architecture:** Add two small app-level UX helpers for required-field semantics and dirty-form protection, then update the existing customer, lead, client, and organization components in place. Keep the current APIs except for one additive lead projection, `pushedByDisplayName`, derived by the backend from the bound user relation.

**Tech Stack:** Vue 3, Vue Router 4, Pinia, Element Plus, Vitest/Vue Test Utils, NestJS, Prisma/PostgreSQL, Jest/Supertest, Playwright.

## Global Constraints

- Preserve the four approved principles in `docs/superpowers/specs/2026-09-22-rapid-onboarding-ux-hardening-design.md`.
- Do not change the customer/rights-holder/lead/account relationship or the `WAITING_PUSH → WAITING_REVIEW` transition.
- Do not implement CORE-LD-003/004, evidence decisions, notary transfer, or a complete client portal.
- Add no dependency and do not introduce a generic form DSL.
- Backend authorization and validation remain authoritative; UI hints and confirmation never replace them.
- Use existing shared CSS variables and the Demo-aligned visual language; defer broad typography/card/color redesign.
- Follow TDD for every behavior change: run the focused test and observe the expected failure before production edits.

---

## File Structure

- Create `frontend/src/app/RequiredFieldMark.vue`: accessible reusable red required mark.
- Create `frontend/src/app/RequiredFieldMark.spec.ts`: required-mark visual and screen-reader contract.
- Create `frontend/src/app/use-unsaved-form.ts`: Vue Router and `beforeunload` protection for dirty forms.
- Create `frontend/src/app/use-unsaved-form.spec.ts`: navigation and unload behavior.
- Create `frontend/src/modules/customers/customer-labels.ts`: customer enum-to-Chinese labels only.
- Create `frontend/src/modules/customers/customer-labels.spec.ts`: strict label mapping tests.
- Modify existing customer, lead, client, and organization Vue files in place; do not split their business state.
- Modify `backend/src/modules/leads/lead.service.ts` and response DTOs only for `pushedByDisplayName`.
- Extend existing unit/component/E2E tests beside the affected modules.
- Update `docs/spec/v0.1/DECISIONS.md`, `docs/spec/v0.1/VALIDATION.md`, `docs/project-status.md`, and context snapshot during final closure.

---

### Task 1: Shared Required-Field and Dirty-Form Primitives

**Files:**

- Create: `frontend/src/app/RequiredFieldMark.vue`
- Create: `frontend/src/app/RequiredFieldMark.spec.ts`
- Create: `frontend/src/app/use-unsaved-form.ts`
- Create: `frontend/src/app/use-unsaved-form.spec.ts`
- Modify: `frontend/src/styles/global.css`

**Interfaces:**

- Produces: `<RequiredFieldMark />` with visible `*` and screen-reader text `必填`.
- Produces: `useUnsavedForm(isDirty: Readonly<Ref<boolean>>, message?: string): void`.

- [ ] **Step 1: Write failing primitive tests**

```ts
it('renders a visual star and an accessible required label', () => {
  const wrapper = mount(RequiredFieldMark);
  expect(wrapper.get('[aria-hidden="true"]').text()).toBe('*');
  expect(wrapper.get('.sr-only').text()).toBe('必填');
});

it('blocks dirty route navigation and allows a confirmed leave', async () => {
  const dirty = ref(true);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { router } = await mountHarness(dirty);
  await router.push('/next');
  expect(router.currentRoute.value.path).toBe('/form');
  confirm.mockReturnValue(true);
  await router.push('/next');
  expect(router.currentRoute.value.path).toBe('/next');
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @dev-cor/frontend test src/app/RequiredFieldMark.spec.ts src/app/use-unsaved-form.spec.ts`

Expected: FAIL because both modules do not exist.

- [ ] **Step 3: Implement the minimal primitives**

```vue
<template>
  <span class="required-mark" title="必填">
    <span aria-hidden="true">*</span><span class="sr-only">必填</span>
  </span>
</template>
```

```ts
export function useUnsavedForm(
  isDirty: Readonly<Ref<boolean>>,
  message = '当前填写内容尚未保存，确认离开吗？',
): void {
  onBeforeRouteLeave(() => !isDirty.value || window.confirm(message));
  const warn = (event: BeforeUnloadEvent) => {
    if (!isDirty.value) return;
    event.preventDefault();
    event.returnValue = '';
  };
  onMounted(() => window.addEventListener('beforeunload', warn));
  onBeforeUnmount(() => window.removeEventListener('beforeunload', warn));
}
```

Add `.required-mark { color: var(--color-danger); margin-left: 0.25rem; }` and a standard `.field-guidance` style using existing variables.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `pnpm --filter @dev-cor/frontend test src/app/RequiredFieldMark.spec.ts src/app/use-unsaved-form.spec.ts`

Expected: both files PASS without warnings.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/app/RequiredFieldMark.vue frontend/src/app/RequiredFieldMark.spec.ts frontend/src/app/use-unsaved-form.ts frontend/src/app/use-unsaved-form.spec.ts frontend/src/styles/global.css
git commit -m "feat: add rapid onboarding form helpers"
```

### Task 2: Customer Terminology, Required Guidance, and Account Consequences

**Files:**

- Create: `frontend/src/modules/customers/customer-labels.ts`
- Create: `frontend/src/modules/customers/customer-labels.spec.ts`
- Modify/Test: `frontend/src/modules/customers/CustomerNewPage.vue` and `.spec.ts`
- Modify/Test: `frontend/src/modules/customers/CustomerEditPage.vue` and `.spec.ts`
- Modify/Test: `frontend/src/modules/customers/CustomerAdmissionPanel.vue` and `.spec.ts`
- Modify/Test: `frontend/src/modules/customers/CustomerRightsHolderPanel.vue` and `.spec.ts`
- Modify/Test: `frontend/src/modules/customers/CustomerAccountPanel.vue` and `.spec.ts`
- Modify/Test: `frontend/src/modules/customers/CustomerDetailPage.vue` and `.spec.ts`

**Interfaces:**

- Produces: `labelCustomerType(value)` and `labelIdentityType(value)` returning approved Chinese labels or `未填写`.
- Consumes: `<RequiredFieldMark />` and `useUnsavedForm` from Task 1.

- [ ] **Step 1: Write failing customer UX tests**

```ts
expect(wrapper.text()).toContain('客户组织类型');
expect(wrapper.text()).toContain('身份证明类型');
expect(wrapper.text()).not.toContain('Client access');
expect(wrapper.text()).not.toContain('ENTERPRISE');
expect(wrapper.text()).toContain('企业');
expect(wrapper.findAllComponents(RequiredFieldMark).length).toBeGreaterThan(0);
```

Extend `CustomerAccountPanel.spec.ts`:

```ts
it('explains account requirements and confirms immediate revocation', async () => {
  api.listClientAccounts.mockResolvedValue([activeAccount]);
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  const wrapper = mount(CustomerAccountPanel, { props: admittedProps });
  await flushPromises();
  expect(wrapper.text()).toContain('用户名至少 3 个字符');
  expect(wrapper.text()).toContain('初始密码至少 12 个字符');
  await wrapper.get('[data-test="toggle-client-user-1"]').trigger('click');
  expect(api.setClientAccountStatus).not.toHaveBeenCalled();
  expect(window.confirm).toHaveBeenCalledWith(
    expect.stringContaining('现有登录会立即失效'),
  );
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @dev-cor/frontend test src/modules/customers src/app/RequiredFieldMark.spec.ts`

Expected: FAIL on old terminology, missing required marks, raw enums, missing guidance, and missing confirmation.

- [ ] **Step 3: Implement customer UX changes**

Implement strict dictionaries:

```ts
const customerTypes = {
  ENTERPRISE: '企业',
  SOLE_PROPRIETOR: '个体工商户',
  NATURAL_PERSON: '自然人',
  PUBLIC_INSTITUTION: '事业单位',
  SOCIAL_ORGANIZATION: '社会组织',
  OTHER_ORGANIZATION: '其他组织',
} as const;

export function labelCustomerType(value: string | null): string {
  return value === null
    ? '未填写'
    : (customerTypes[value as keyof typeof customerTypes] ?? '未填写');
}
```

Apply these copy rules:

- `客户主体类型` → `客户组织类型`
- `身份证件类型` → `身份证明类型`
- `补齐主体证明后直接准入` → `补齐客户身份证明并准入`
- `权利主体` → `权利人` plus `知识产权实际所属方`
- `Client access` → `企业登录账号`
- `姓名` in account form → `客户侧使用人姓名`

Use `RequiredFieldMark` on true required fields. Replace the one-option material-purpose select with visible text `完整身份证明材料`. Add account rule text and set `data-test="toggle-client-${account.id}"`.

Before disabling an active client account:

```ts
if (
  account.bindingActive &&
  !window.confirm(
    `确认停用“${account.displayName}”吗？该账号现有登录会立即失效，下一次请求将不能访问本企业线索。`,
  )
)
  return;
```

Add page-section IDs and a small anchor navigation for `客户资料 / 权利人 / 身份材料 / 企业账号 / 办理历史`; do not create a tab system.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `pnpm --filter @dev-cor/frontend test src/modules/customers src/app/RequiredFieldMark.spec.ts src/app/use-unsaved-form.spec.ts`

Expected: customer tests PASS; no raw enum or English kicker assertion remains.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/modules/customers frontend/src/app frontend/src/styles/main.css
git commit -m "feat: clarify customer onboarding actions"
```

### Task 3: Lead Form Semantics, Automatic Choices, and Safe Navigation

**Files:**

- Modify/Test: `frontend/src/modules/leads/LeadForm.vue` and `.spec.ts`
- Modify/Test: `frontend/src/modules/leads/LeadNewPage.vue` and `.spec.ts`
- Modify/Test: `frontend/src/modules/leads/LeadEditPage.vue` and `.spec.ts`
- Modify: `frontend/src/styles/demo-components.css`

**Interfaces:**

- `LeadForm` additionally emits `dirty` after the first user edit.
- New/edit pages consume `useUnsavedForm`; they clear dirty state after a successful save.

- [ ] **Step 1: Write failing lead-form tests**

```ts
it('automatically selects the only rights holder and requires a choice for many', async () => {
  const wrapper = mount(LeadForm, { props: { context } });
  await wrapper.get('select[name="customerId"]').setValue('customer-b');
  expect(
    (wrapper.get('select[name="rightsHolderId"]').element as HTMLSelectElement)
      .value,
  ).toBe('holder-c');
  expect(wrapper.text()).toContain('已按客户自动带出');
  await wrapper.get('select[name="customerId"]').setValue('customer-a');
  expect(
    (wrapper.get('select[name="rightsHolderId"]').element as HTMLSelectElement)
      .value,
  ).toBe('');
});

it('uses business wording and explains the estimate', () => {
  const wrapper = mount(LeadForm, { props: { context } });
  expect(wrapper.text()).toContain('权利人');
  expect(wrapper.text()).toContain('拟办理业务类型');
  expect(wrapper.text()).toContain('平台店铺ID（选填）');
  expect(wrapper.text()).toContain('销量');
  expect(wrapper.text()).toContain('预估销售额（元）');
  expect(wrapper.text()).toContain('销量为 0 时使用评论数');
  expect(wrapper.text()).toContain('申请披露店铺经营者信息');
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @dev-cor/frontend test src/modules/leads/LeadForm.spec.ts src/modules/leads/LeadNewPage.spec.ts src/modules/leads/LeadEditPage.spec.ts`

Expected: FAIL because the old labels remain and a sole rights holder stays unselected.

- [ ] **Step 3: Implement minimal lead-form changes**

Update customer selection logic:

```ts
const available = selectedCustomer.value?.rightsHolders ?? [];
rightsHolderId.value = available.length === 1 ? available[0]!.id : '';
```

Show one of three states beside the field: auto-selected, choose among multiple, or `该客户尚未维护权利人，请先前往客户详情添加后再创建线索。` Use required marks on the current unconditional fields and product numeric fields. Rename only visible labels; preserve request property names.

Add the estimate guidance exactly:

```html
<p class="field-guidance">
  预估销售额 = 单价 × 销量；销量为 0
  时使用评论数。该金额仅供线索评估，不代表真实成交金额。
</p>
```

Remove sticky/fixed positioning from `.demo-form-actions`; keep it as the final normal-flow action row so it cannot cover fields.

Emit `dirty` from the form on user input and protect new/edit pages with `useUnsavedForm`. Set dirty false before routing after a successful create/update.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `pnpm --filter @dev-cor/frontend test src/modules/leads/LeadForm.spec.ts src/modules/leads/LeadNewPage.spec.ts src/modules/leads/LeadEditPage.spec.ts`

Expected: all three files PASS.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/modules/leads frontend/src/styles/demo-components.css
git commit -m "feat: streamline lead data entry"
```

### Task 4: Push Confirmation and Human Operator Display

**Files:**

- Modify/Test: `backend/src/modules/leads/lead.service.ts` and `lead.service.spec.ts`
- Modify/Test: `backend/src/modules/leads/lead-push-response.dto.ts`
- Modify/Test: `backend/src/core-ld-openapi.spec.ts`
- Modify/Test: `frontend/src/api/leads.ts` and `leads.spec.ts`
- Modify/Test: `frontend/src/modules/leads/LeadDetailPage.vue` and `.spec.ts`

**Interfaces:**

- Additive response field: `pushedByDisplayName: string | null` on lead records and `string` on successful push response.
- The field is backend-derived from `UserAccount.displayName`; requests never accept it.

- [ ] **Step 1: Write failing backend and frontend tests**

Backend service assertion:

```ts
expect(result).toMatchObject({
  pushedByUserId: actor.userId,
  pushedByDisplayName: '运营甲',
});
```

Frontend detail assertions:

```ts
it('requires confirmation before pushing and does nothing when cancelled', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  const wrapper = await mountPage();
  await wrapper.get('[data-test="push-lead"]').trigger('click');
  expect(window.confirm).toHaveBeenCalledWith(
    expect.stringContaining('状态将变为“线索待审核”'),
  );
  expect(leadApi.pushLead).not.toHaveBeenCalled();
});

expect(wrapper.get('[data-test="push-record"]').text()).toContain('运营甲');
expect(wrapper.get('[data-test="push-record"]').text()).not.toContain(
  'user-uuid',
);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @dev-cor/backend test src/modules/leads/lead.service.spec.ts src/core-ld-openapi.spec.ts && pnpm --filter @dev-cor/frontend test src/api/leads.spec.ts src/modules/leads/LeadDetailPage.spec.ts`

Expected: FAIL for the missing display-name property and missing confirmation.

- [ ] **Step 3: Implement the additive projection and confirmation**

Extend `leadInclude`:

```ts
const leadInclude = {
  products: { orderBy: { position: 'asc' as const } },
  infringements: { orderBy: { type: 'asc' as const } },
  pushedBy: { select: { displayName: true } },
} satisfies Prisma.LeadInclude;
```

Map `pushedByDisplayName: record.pushedBy?.displayName ?? null`. Include the display name in new receipt snapshots; when reading an older `WAITING_PUSH` create/update receipt with no field, normalize it to `null` so replay remains backward compatible. Extend DTO/OpenAPI and strict frontend decoding.

Before `pushLead`, call `window.confirm` with the loaded customer name and the exact effects: next state, immediate client visibility, and no editing in the current stage. On cancellation, do not allocate an idempotency key or send a request.

- [ ] **Step 4: Run tests and verify GREEN**

Run the same backend/frontend command from Step 2.

Expected: all selected tests PASS, including old receipt replay tests.

- [ ] **Step 5: Commit**

```powershell
git add backend/src/modules/leads backend/src/core-ld-openapi.spec.ts frontend/src/api/leads.ts frontend/src/api/leads.spec.ts frontend/src/modules/leads/LeadDetailPage.vue frontend/src/modules/leads/LeadDetailPage.spec.ts
git commit -m "feat: explain and identify lead pushes"
```

### Task 5: Personnel and Role Action Clarity

**Files:**

- Modify/Test: `frontend/src/modules/organization/PeopleAccessPage.vue` and `.spec.ts`
- Modify/Test: `frontend/src/modules/organization/RoleTemplateEditor.vue` and `.spec.ts`

**Interfaces:**

- Consumes `<RequiredFieldMark />` from Task 1.
- No API changes.

- [ ] **Step 1: Write failing organization UX tests**

```ts
expect(wrapper.text()).toContain('初始密码至少 12 个字符');
expect(wrapper.text()).toContain('本人：仅本人负责的数据');
expect(wrapper.text()).not.toContain('CUSTOMER_READ');

vi.spyOn(window, 'confirm').mockReturnValue(false);
await stopAccountButton.trigger('click');
expect(window.confirm).toHaveBeenCalledWith(
  expect.stringContaining('现有登录会立即失效'),
);
expect(api.setOrganizationUserStatus).not.toHaveBeenCalled();
```

Add equivalent cancellation assertions for membership, role assignment, and team deactivation.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @dev-cor/frontend test src/modules/organization/PeopleAccessPage.spec.ts src/modules/organization/RoleTemplateEditor.spec.ts`

Expected: FAIL on missing rules, raw Action codes, and unconfirmed status changes.

- [ ] **Step 3: Implement scoped explanations and confirmations**

- Mark name, username, password, and initial role as required.
- Show `用户名至少 3 个字符；初始密码至少 12 个字符。`
- Add scope copy: `本人：仅本人负责的数据；团队：当前团队数据；部门：本部门数据。`
- Remove raw Action code from the primary grant row; retain it only in `title` for troubleshooting.
- Confirm deactivation only; reactivation remains one click with clear resulting text.
- Use operation-specific messages: account revokes sessions, membership blocks department work, role removes that permission set, team prevents new bindings but retains history.

- [ ] **Step 4: Run tests and verify GREEN**

Run the same organization command from Step 2.

Expected: both files PASS.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/modules/organization
git commit -m "feat: explain personnel access changes"
```

### Task 6: Client Copy, Decision Record, and Real Browser Regression

**Files:**

- Modify/Test: `frontend/src/modules/client/ClientLeadListPage.vue` and `.spec.ts`
- Modify/Test: `frontend/src/modules/client/ClientLeadDetailPage.vue` and `.spec.ts`
- Modify/Test: `tests/e2e/core-leads.spec.ts`
- Modify: `docs/spec/v0.1/DECISIONS.md`
- Modify: `docs/spec/v0.1/VALIDATION.md`
- Modify: `docs/project-status.md`
- Modify: `docs/context-snapshot.json`

**Interfaces:**

- No new endpoint or state.
- Adds SD-38 containing the four approved rapid-onboarding principles.

- [ ] **Step 1: Write failing client and browser assertions**

```ts
expect(wrapper.text()).not.toContain('Enterprise review');
expect(wrapper.text()).not.toContain('后续切片');
expect(wrapper.text()).toContain('当前可查看线索内容');
```

Extend the real CORE-LD browser path to assert visible required marks, auto-selected sole rights holder, account password guidance, cancelled push leaves `WAITING_PUSH`, confirmed push reaches `WAITING_REVIEW`, and push record shows a human name.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @dev-cor/frontend test src/modules/client src/modules/leads/LeadDetailPage.spec.ts src/modules/customers/CustomerAccountPanel.spec.ts`

Expected: FAIL on the old development copy and missing new browser affordances.

- [ ] **Step 3: Implement client copy and formal decision**

Replace development copy with:

- kicker: `企业线索审核`
- detail note: `当前可查看线索内容；如需补充或反馈，请联系负责运营。`

Append SD-38 to `DECISIONS.md` with the four principles verbatim and state that they do not relax backend authorization or business validation. Do not move CORE-LD-003/004 status.

- [ ] **Step 4: Run focused suites and fast gate**

Run:

```powershell
pnpm test:unit:core-ld
pnpm check:fast
pnpm format:check:slice:core-ld
```

Expected: all commands exit 0.

- [ ] **Step 5: Run stable-candidate database/browser validation**

Run:

```powershell
pnpm verify:slice:core-ld
```

Expected: unit/contract/static/build steps and isolated PostgreSQL Chromium CORE-LD tests all exit 0. Inspect desktop 1440 and mobile 390 screenshots for required marks, guidance, confirmation copy, and non-overlapping actions.

- [ ] **Step 6: Record closure and commit**

Update `VALIDATION.md` and `project-status.md` with exact counts and candidate tree without changing roadmap Current. Then run:

```powershell
pnpm context:record
pnpm context:check:strict
git diff --check
git add docs frontend tests backend
git commit -m "chore: close rapid onboarding ux hardening"
```

Expected: clean worktree on `codex/core-ld-002-client-push`; no push, merge, release, or production operation.

---

## Plan Self-Review

- Spec coverage: all design sections 4.1–4.7 map to Tasks 1–6; pure visual redesign remains explicitly excluded.
- Placeholder scan: no TBD/TODO/generic “add tests” steps remain; each behavior has a named test and command.
- Type consistency: `pushedByDisplayName` is nullable on lead records, required on successful push response, and backend-derived in every case.
- Execution mode: use inline single-agent execution because the user required default single-Agent work; do not dispatch implementation subagents.
