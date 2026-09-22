# Demo 风格正式前端壳层与线索页实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变正式 API、权限、文件存储和业务流转的前提下，建立 Demo 同款共享壳层，并迁移线索列表、新建／编辑和详情页。

**Architecture:** `AppShell.vue` 统一承担登录后侧栏、顶栏、面包屑、权限导航和线索计数；业务页只渲染内容。样式分为设计变量、壳层和 Demo 通用组件三层，避免将 Demo 的单体 HTML/CSS/JS 复制进正式工程。

**Tech Stack:** Vue 3.5、Vue Router 4.6、Pinia 3.0、Element Plus 2.14、TypeScript 5.9、Vitest 4.1、Playwright 1.63。

## Global Constraints

- 执行 Node/pnpm 命令前在仓库根目录运行 `. .\Use-ProjectRuntime.ps1`；版本必须为 Node `24.21.0`、pnpm `11.27.0`。
- 不新增 npm 依赖，继续使用已有 Element Plus 按需引入。
- 不复制 Demo 静态数据、`localStorage`、内联事件、未批准字段或未实现动作。
- 不修改后端契约、数据库、权限、工作流或文件存储语义。
- 一个视图最多一个主按钮；卡片无阴影；数字、日期、编号和金额使用等宽数字。
- 保留工作区中现有 5 个未提交的问题修复文件，先独立提交，不与 UI 重构混成一个提交。
- 每个任务遵循红—绿—重构：先运行新测试并看到预期失败，再写最小实现。

---

### Task 0: 固定已验证的上一轮问题修复

**Files:**

- Modify/commit: `frontend/index.html`
- Modify/commit: `frontend/src/modules/leads/LeadNewPage.vue`
- Modify/commit: `frontend/src/modules/leads/LeadNewPage.spec.ts`
- Modify/commit: `frontend/src/modules/organization/PeopleAccessPage.vue`
- Modify/commit: `frontend/src/modules/organization/PeopleAccessPage.spec.ts`

**Interfaces:**

- Consumes: 当前工作区中已完成的标题、无准入客户引导、人员错误清理和团队空值提示修复。
- Produces: UI 迁移的干净基线提交。

- [ ] **Step 1: 确认只有既定 5 个文件处于未提交状态**

```powershell
git status --short
git diff --check
```

Expected: 只列出上述 5 个前端文件，`git diff --check` 退出码为 0。

- [ ] **Step 2: 复跑直接回归**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/frontend test src/modules/organization/PeopleAccessPage.spec.ts src/modules/leads/LeadNewPage.spec.ts
```

Expected: 2 个测试文件全部通过。

- [ ] **Step 3: 独立提交上一轮修复**

```powershell
git add frontend/index.html frontend/src/modules/leads/LeadNewPage.vue frontend/src/modules/leads/LeadNewPage.spec.ts frontend/src/modules/organization/PeopleAccessPage.vue frontend/src/modules/organization/PeopleAccessPage.spec.ts
git commit -m "fix: improve frontend guidance and validation"
```

Expected: 提交只包含上述 5 个文件。

---

### Task 1: 建立 Demo 设计变量和可测试的共享壳层

**Files:**

- Create: `frontend/src/app/AppShell.vue`
- Create: `frontend/src/app/AppShell.spec.ts`
- Create: `frontend/src/styles/app-shell.css`
- Create: `frontend/src/styles/demo-components.css`
- Modify: `frontend/src/app/App.vue`
- Modify: `frontend/src/app/App.spec.ts`
- Modify: `frontend/src/app/router.ts`
- Modify: `frontend/src/styles/tokens.css`
- Modify: `frontend/src/styles/global.css`

**Interfaces:**

- Consumes: `useAuthStore()`、`getOrganizationManagementContext()`、`listLeads(page, pageSize, options, status?)`、Vue Router `route.meta`。
- Produces: `AppShell` 默认插槽；`data-test="app-shell"`、`mobile-nav-toggle`、`customer-nav`、`lead-nav`、`people-access-nav`、`lead-counter`、`logout`；路由 `meta.breadcrumbs` 和 `meta.section`。

- [ ] **Step 1: 先写壳层失败测试**

Add these cases to `AppShell.spec.ts` using a memory router, real Pinia auth store, and mocked organization/lead APIs:

```ts
it('renders the Demo shell with authorized navigation and route breadcrumbs', async () => {
  const { wrapper } = await mountShell('/leads');
  expect(wrapper.get('[data-test="app-shell"]').exists()).toBe(true);
  expect(wrapper.get('[data-test="lead-nav"]').classes()).toContain('active');
  expect(wrapper.get('[data-test="breadcrumbs"]').text()).toContain('线索');
  expect(wrapper.get('[data-test="people-access-nav"]').exists()).toBe(true);
});

it('uses real lead counts and route-backed status links', async () => {
  const { wrapper } = await mountShell('/leads');
  const counters = wrapper.findAll('[data-test="lead-counter"]');
  expect(counters).toHaveLength(4);
  expect(counters.map((item) => item.text())).toEqual([
    '待推送7',
    '线索待审核3',
    '线索待确认2',
    '线索已归档1',
  ]);
  expect(counters[0]!.attributes('href')).toContain('status=WAITING_PUSH');
});

it('opens and closes the mobile navigation drawer', async () => {
  const { wrapper } = await mountShell('/leads');
  expect(wrapper.get('[data-test="app-sidebar"]').attributes('data-open')).toBe(
    'false',
  );
  await wrapper.get('[data-test="mobile-nav-toggle"]').trigger('click');
  expect(wrapper.get('[data-test="app-sidebar"]').attributes('data-open')).toBe(
    'true',
  );
  await wrapper.get('[data-test="lead-nav"]').trigger('click');
  expect(wrapper.get('[data-test="app-sidebar"]').attributes('data-open')).toBe(
    'false',
  );
});
```

Update `App.spec.ts` so the signed-in branch expects `AppShell`, while the signed-out branch still renders the public route without a shell.

- [ ] **Step 2: 运行壳层测试并确认因组件缺失而失败**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/frontend test src/app/AppShell.spec.ts src/app/App.spec.ts
```

Expected: `AppShell.vue` 缺失或新壳层断言不成立，而不是测试语法错误。

- [ ] **Step 3: 为路由补齐壳层元数据**

In `router.ts`, give every authenticated route explicit metadata. Use these exact values:

```ts
{ path: '/customers', component: CustomerListPage, meta: { section: '客户', breadcrumbs: ['客户'] } }
{ path: '/customers/new', component: CustomerNewPage, meta: { section: '客户', breadcrumbs: ['客户', '新建客户'] } }
{ path: '/customers/:id/edit', component: CustomerEditPage, meta: { section: '客户', breadcrumbs: ['客户', '编辑客户'] } }
{ path: '/customers/:id', component: CustomerDetailPage, meta: { section: '客户', breadcrumbs: ['客户', '客户详情'] } }
{ path: '/leads', component: LeadListPage, meta: { section: '线索', breadcrumbs: ['线索'] } }
{ path: '/leads/new', component: LeadNewPage, meta: { section: '线索', breadcrumbs: ['线索', '新建线索'] } }
{ path: '/leads/:id/edit', component: LeadEditPage, meta: { section: '线索', breadcrumbs: ['线索', '编辑线索'] } }
{ path: '/leads/:id', component: LeadDetailPage, meta: { section: '线索', breadcrumbs: ['线索', '线索详情'] } }
{ path: '/settings/people-access', component: PeopleAccessPage, meta: { section: '设置', breadcrumbs: ['设置', '人员与权限'] } }
```

Rights-holder detail uses `section: '客户'` and `breadcrumbs: ['客户', '权利主体']`. Public routes keep `meta.public` and are never wrapped.

Keep the current route specificity order: `/customers/:id/edit` before `/customers/:id`, and `/leads/:id/edit` before `/leads/:id`, so edit URLs cannot be consumed by detail routes.

- [ ] **Step 4: 实现 `AppShell.vue` 的最小行为**

Use one default slot and the following state model:

```ts
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const drawerOpen = ref(false);
const canViewPeople = ref(false);
const leadCounts = ref<Record<LeadStatus, number> | null>(null);
const loggingOut = ref(false);
const logoutError = ref('');
const breadcrumbs = computed(() =>
  Array.isArray(route.meta.breadcrumbs)
    ? route.meta.breadcrumbs.filter(
        (item): item is string => typeof item === 'string',
      )
    : [],
);
const isLeadRoute = computed(
  () => route.path === '/leads' || route.path.startsWith('/leads/'),
);
```

Watch `auth.session.user.id`, `authorizationRevision`, and `route.fullPath`. Check management visibility through `getOrganizationManagementContext()`. When `isLeadRoute` is true, call `listLeads(1, 1, { signal })`; store only `result.counts`. If that read fails, set counts to `null` and render no numeric badge rather than a false zero. Abort both reads on replacement/unmount.

The template structure is fixed:

```vue
<div class="app-shell" data-test="app-shell">
  <aside class="app-sidebar" data-test="app-sidebar" :data-open="drawerOpen">
    <RouterLink class="app-brand" to="/customers">品维·知产</RouterLink>
    <nav aria-label="主要导航">
      <RouterLink data-test="customer-nav" to="/customers">客户</RouterLink>
      <RouterLink data-test="lead-nav" to="/leads">线索</RouterLink>
      <div v-if="isLeadRoute" class="app-subnav">
        <!-- 全部 + leadStatusCards；四个状态链接保留 data-test="lead-counter" -->
      </div>
      <RouterLink v-if="canViewPeople" data-test="people-access-nav" to="/settings/people-access">人员与权限</RouterLink>
    </nav>
    <footer class="app-user"><span>{{ auth.session?.user.displayName }}</span><button data-test="logout">退出</button></footer>
  </aside>
  <div class="app-main">
    <header class="app-topbar">
      <button data-test="mobile-nav-toggle" type="button" @click="drawerOpen = !drawerOpen">菜单</button>
      <nav data-test="breadcrumbs" aria-label="面包屑"><span v-for="item in breadcrumbs" :key="item">{{ item }}</span></nav>
    </header>
    <main class="app-content"><slot /></main>
  </div>
</div>
```

Use accessible inline SVG icons copied as shapes, not Demo event handlers. Route links close the mobile drawer. Logout preserves the current signed-in UI on failure and routes to `/login` only after `auth.logout()` succeeds.

- [ ] **Step 5: 接入 `App.vue`**

Replace the floating session bar with this structure:

```vue
<AppShell v-if="auth.session"><RouterView /></AppShell>
<RouterView v-else />
```

Move signed-in navigation/logout code from `App.vue` into `AppShell.vue`. Keep `App.vue` limited to selecting the authenticated or public layout.

- [ ] **Step 6: 扩充 tokens 并新增壳层样式**

Add the Demo values to `tokens.css`, including:

```css
--color-primary-active: #414bb0;
--color-primary-focus: rgb(94 106 210 / 32%);
--color-primary-subtle: rgb(94 106 210 / 10%);
--color-surface-3: #e9e9ec;
--color-ink-subtle: #8a8c93;
--color-ink-tertiary: #a9abb2;
--color-warning: #b45309;
--color-info: #2563eb;
--color-progress: #7c3aed;
--stage-done: #057a55;
--stage-active: #5e6ad2;
--stage-pending: #d2d2d8;
--s-1: 4px;
--s-2: 8px;
--s-3: 12px;
--s-4: 16px;
--s-5: 20px;
--s-6: 24px;
--s-8: 32px;
```

Create `app-shell.css` with the 232px/56px desktop grid, 1440px content cap, active navigation, account footer, sticky top bar, drawer overlay, and the exact breakpoints `<768`, `768–1279`, `1280–1679`, `>=1680`. Create `demo-components.css` with `.page-view`, `.page-head`, `.demo-card`, `.demo-table-wrap`, `.demo-table`, `.pill`, `.empty-state`, `.demo-form`, and `.form-section-title`. Import both immediately after `tokens.css` at the top of `global.css`.

- [ ] **Step 7: 运行壳层聚焦验证**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/frontend test src/app/AppShell.spec.ts src/app/App.spec.ts src/app/router.spec.ts
pnpm --filter @dev-cor/frontend typecheck
```

Expected: all selected tests and type checking pass.

- [ ] **Step 8: 提交壳层**

```powershell
git add frontend/src/app/AppShell.vue frontend/src/app/AppShell.spec.ts frontend/src/app/App.vue frontend/src/app/App.spec.ts frontend/src/app/router.ts frontend/src/styles/tokens.css frontend/src/styles/global.css frontend/src/styles/app-shell.css frontend/src/styles/demo-components.css
git commit -m "feat: add demo-aligned application shell"
```

---

### Task 2: 让所有现有业务页接入共享壳层

**Files:**

- Modify: `frontend/src/modules/customers/CustomerListPage.vue`
- Modify: `frontend/src/modules/customers/CustomerNewPage.vue`
- Modify: `frontend/src/modules/customers/CustomerDetailPage.vue`
- Modify: `frontend/src/modules/customers/CustomerEditPage.vue`
- Modify: `frontend/src/modules/customers/RightsHolderDetailPage.vue`
- Modify: `frontend/src/modules/leads/LeadListPage.vue`
- Modify: `frontend/src/modules/leads/LeadNewPage.vue`
- Modify: `frontend/src/modules/leads/LeadDetailPage.vue`
- Modify: `frontend/src/modules/leads/LeadEditPage.vue`
- Modify: `frontend/src/modules/organization/PeopleAccessPage.vue`
- Test: corresponding existing `*.spec.ts` files

**Interfaces:**

- Consumes: `AppShell` default slot and `.page-view`/`.page-view--narrow` content containers.
- Produces: authenticated pages without nested `workspace-header`, `workspace-shell`, or duplicate brand navigation.

- [ ] **Step 1: 在现有页面测试中增加外壳回归断言**

For one customer page, one lead page, and `PeopleAccessPage.spec.ts`, assert:

```ts
expect(wrapper.find('.workspace-header').exists()).toBe(false);
expect(wrapper.find('.workspace-shell').exists()).toBe(false);
expect(wrapper.get('.page-view').exists()).toBe(true);
```

The remaining pages follow the same component contract and are covered by the full frontend suite plus browser navigation.

- [ ] **Step 2: 运行测试并确认旧外壳断言失败**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/frontend test src/modules/customers/CustomerListPage.spec.ts src/modules/leads/LeadNewPage.spec.ts src/modules/organization/PeopleAccessPage.spec.ts
```

Expected: assertions find the current `workspace-*` wrappers.

- [ ] **Step 3: 机械移除重复外壳**

For each listed authenticated page:

```vue
<!-- before -->
<div class="workspace-shell">
  <header class="workspace-header">...</header>
  <main class="workspace-main workspace-main--narrow">...</main>
</div>

<!-- after -->
<div class="page-view page-view--narrow">...</div>
```

List pages use `.page-view`; form/detail pages use `.page-view.page-view--narrow` only when the design calls for a narrow reading measure. Do not alter API calls, form state, emitted payloads, permissions, or operation labels.

- [ ] **Step 4: 跑全部受影响页面测试**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/frontend test src/modules/customers src/modules/leads src/modules/organization
```

Expected: all selected component tests pass.

- [ ] **Step 5: 提交外壳接入**

```powershell
git add frontend/src/modules/customers frontend/src/modules/leads frontend/src/modules/organization
git commit -m "refactor: move authenticated pages into shared shell"
```

---

### Task 3: 迁移线索列表与状态导航

**Files:**

- Modify: `frontend/src/modules/leads/LeadListPage.vue`
- Modify: `frontend/src/modules/leads/LeadListPage.spec.ts`
- Modify: `frontend/src/styles/demo-components.css`
- Modify: `tests/e2e/core-leads.spec.ts`

**Interfaces:**

- Consumes: `Lead` fields `businessNo`, `status`, `platform`, `shopName`, `products`, `foundAt`, `updatedAt`; shell `lead-counter` links.
- Produces: `.demo-table` with fixed columns; `data-test="lead-row"`, `lead-product-count`, `create-lead`; URL-backed sidebar filters.

- [ ] **Step 1: 将列表测试改为新结构的失败测试**

Expand the `summary` fixture with `platform: 'TAOBAO'`, `foundAt`, and one complete `LeadProduct` fixture containing `id`, `position`, `url`, `title`, `quantity`, `unitPrice`, `commentCount`, and `estimatedAmount`. Replace the page-local counter expectation with:

```ts
expect(wrapper.findAll('[data-test="lead-counter"]')).toHaveLength(0);
expect(wrapper.get('[data-test="lead-row"]').text()).toContain(
  'LD-20260921-001',
);
expect(wrapper.get('[data-test="lead-row"]').text()).toContain('淘宝');
expect(wrapper.get('[data-test="lead-product-count"]').text()).toBe('1');
expect(wrapper.find('table.demo-table').exists()).toBe(true);
```

Keep pagination, retry, route-query, empty, and create-capability assertions.

- [ ] **Step 2: 运行列表测试并确认新表格断言失败**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/frontend test src/modules/leads/LeadListPage.spec.ts
```

Expected: missing `demo-table`/new row test attributes or old counter grid causes failure.

- [ ] **Step 3: 实现 Demo 紧凑列表**

Remove `lead-filter-row` and `lead-counter-grid` from the page. Keep `selectedStatus` and route watching because sidebar links still set `status`. Render:

```vue
<div v-else class="demo-table-wrap">
  <table class="demo-table">
    <thead><tr><th>操作／线索编号</th><th>状态</th><th>平台</th><th>店铺</th><th class="num">商品数</th><th>发现时间</th><th>最近更新</th></tr></thead>
    <tbody>
      <tr v-for="lead in items" :key="lead.id" data-test="lead-row">
        <td><RouterLink :to="`/leads/${lead.id}`">{{ lead.businessNo }}</RouterLink></td>
        <td><span class="pill">{{ leadStatusLabels[lead.status] }}</span></td>
        <td>{{ labelPlatform(lead.platform) }}</td>
        <td>{{ lead.shopName }}</td>
        <td class="num mono" data-test="lead-product-count">{{ lead.products.length }}</td>
        <td class="mono">{{ formatTime(lead.foundAt) }}</td>
        <td class="mono">{{ formatTime(lead.updatedAt) }}</td>
      </tr>
    </tbody>
  </table>
</div>
```

Add a complete `labelPlatform()` mapping by reusing exported lead option labels rather than duplicating a partial dictionary. If the current helper is not exported, export one label function from `lead-options.ts` and cover it in the list test.

- [ ] **Step 4: 保留 E2E 状态计数契约**

Update `core-leads.spec.ts` only where the selector moved. Keep exactly four `[data-test="lead-counter"]` elements in the shell and preserve the existing expected texts and status-filter URL behavior.

- [ ] **Step 5: 验证并提交线索列表**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/frontend test src/app/AppShell.spec.ts src/modules/leads/LeadListPage.spec.ts
pnpm --filter @dev-cor/frontend typecheck
git add frontend/src/modules/leads/LeadListPage.vue frontend/src/modules/leads/LeadListPage.spec.ts frontend/src/modules/leads/lead-options.ts frontend/src/styles/demo-components.css tests/e2e/core-leads.spec.ts
git commit -m "feat: align lead list with demo layout"
```

---

### Task 4: 迁移线索新建、编辑与共享表单

**Files:**

- Modify: `frontend/src/modules/leads/LeadForm.vue`
- Modify: `frontend/src/modules/leads/LeadForm.spec.ts`
- Modify: `frontend/src/modules/leads/LeadNewPage.vue`
- Modify: `frontend/src/modules/leads/LeadNewPage.spec.ts`
- Modify: `frontend/src/modules/leads/LeadEditPage.vue`
- Modify: `frontend/src/modules/leads/LeadEditPage.spec.ts`
- Modify: `frontend/src/styles/demo-components.css`

**Interfaces:**

- Consumes: current `LeadFormSubmission`, `LeadFormContext`, create idempotency/reserved owner handling, edit `expectedVersion` handling.
- Produces: `.demo-form`, `data-test="lead-facts-section"`, `products-section`, `screenshots-section`, existing input names and submit events unchanged.

- [ ] **Step 1: 写新表单结构失败测试**

Add to `LeadForm.spec.ts`:

```ts
it('groups the formal fields in the Demo-aligned form without changing control names', () => {
  const wrapper = mountForm();
  expect(wrapper.get('form').classes()).toContain('demo-form');
  expect(
    wrapper
      .get('[data-test="lead-facts-section"]')
      .find('select[name="customerId"]')
      .exists(),
  ).toBe(true);
  expect(
    wrapper
      .get('[data-test="products-section"]')
      .find('input[name="productTitle-0"]')
      .exists(),
  ).toBe(true);
  expect(
    wrapper
      .get('[data-test="screenshots-section"]')
      .find('input[name="screenshots"]')
      .exists(),
  ).toBe(true);
});
```

Keep all current validation, customer/rights-holder linkage, source/platform reset, product estimate, file validation, add/remove product, and submission assertions.

- [ ] **Step 2: 运行共享表单与新建／编辑测试，确认新结构断言失败**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/frontend test src/modules/leads/LeadForm.spec.ts src/modules/leads/LeadNewPage.spec.ts src/modules/leads/LeadEditPage.spec.ts
```

Expected: new section/class assertions fail; existing behavioral tests remain informative.

- [ ] **Step 3: 重组标记，不改表单状态或输出**

Use these sections inside the existing `<form @submit.prevent="submit">`:

```vue
<section class="demo-card demo-card--pad" data-test="lead-facts-section">
  <h2 class="form-section-title">线索基础</h2>
  <div class="demo-form-grid"><!-- current customer through shopExternalId labels --></div>
</section>
<section class="demo-card demo-card--pad" data-test="products-section">
  <h2 class="form-section-title">商品链接</h2>
  <!-- current products loop, compact seven-column desktop grid, same input names -->
</section>
<section class="demo-card demo-card--pad" data-test="screenshots-section">
  <h2 class="form-section-title">附件与备注</h2>
  <!-- current needDisclose, remark, file input, file errors -->
</section>
<footer
  class="demo-form-actions"
><slot name="cancel" /><ElButton type="primary" @click="submit">{{ submitLabel }}</ElButton></footer>
```

Keep every existing `name`, `v-model`, `data-test`, `@change`, error key, validation order, and emitted payload. The product estimate label uses `.mono`. The screenshot input is styled as a dashed upload surface but remains the existing native file input and handler.

- [ ] **Step 4: 改造新建／编辑页头和空状态**

Use `.page-head` with one title and one route-back action. Keep the confirmed no-admitted-customer block and `data-test="go-to-customers"`. Do not add a Demo modal or change the route. Keep progress and submit errors immediately above the form.

- [ ] **Step 5: 跑回归并提交表单迁移**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/frontend test src/modules/leads/LeadForm.spec.ts src/modules/leads/LeadNewPage.spec.ts src/modules/leads/LeadEditPage.spec.ts
pnpm --filter @dev-cor/frontend typecheck
git add frontend/src/modules/leads/LeadForm.vue frontend/src/modules/leads/LeadForm.spec.ts frontend/src/modules/leads/LeadNewPage.vue frontend/src/modules/leads/LeadNewPage.spec.ts frontend/src/modules/leads/LeadEditPage.vue frontend/src/modules/leads/LeadEditPage.spec.ts frontend/src/styles/demo-components.css
git commit -m "feat: align lead forms with demo layout"
```

---

### Task 5: 迁移线索详情

**Files:**

- Modify: `frontend/src/modules/leads/LeadDetailPage.vue`
- Modify: `frontend/src/modules/leads/LeadDetailPage.spec.ts`
- Modify: `frontend/src/styles/demo-components.css`

**Interfaces:**

- Consumes: current `LeadDetail`, customer/rights-holder fallbacks, material version filtering, download action, server `capabilities.edit`.
- Produces: `data-test="lead-facts"`, `lead-products-table`, `lead-attachments`, and Demo-aligned detail sections.

- [ ] **Step 1: 写详情结构失败测试**

Add to `LeadDetailPage.spec.ts`:

```ts
it('uses the Demo detail grid, product table and attachment section', async () => {
  const wrapper = await mountPage();
  expect(wrapper.get('[data-test="lead-facts"]').classes()).toContain(
    'demo-detail-grid',
  );
  expect(
    wrapper.get('[data-test="lead-products-table"]').find('table').exists(),
  ).toBe(true);
  expect(wrapper.get('[data-test="lead-attachments"]').text()).toContain(
    '侵权截图.png',
  );
});
```

Keep the existing tests for no push action, edit capability, refresh, exact referenced material versions, and downloads.

- [ ] **Step 2: 运行详情测试并确认新结构断言失败**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/frontend test src/modules/leads/LeadDetailPage.spec.ts
```

Expected: missing new detail classes/test attributes causes failure.

- [ ] **Step 3: 实现 Demo 详情结构**

Use a compact `.page-head`, a status `.pill`, and:

```vue
<section class="demo-card demo-card--pad" data-test="lead-facts">
  <dl class="demo-detail-grid"><!-- existing customer through remark facts --></dl>
</section>
<section class="demo-card" data-test="lead-products-table">
  <h2 class="card-section-title">商品及估算</h2>
  <div class="demo-table-wrap"><table class="demo-table"><!-- 名称／链接、数量、单价、评论数、估算额 --></table></div>
</section>
<section
  class="demo-card demo-card--pad"
  data-test="lead-attachments"
><!-- existing exact-version download list and error --></section>
<section
  class="demo-card demo-card--pad"
><!-- createdAt, updatedAt, version --></section>
```

Use existing `label()` and `formatTime()` behavior. Preserve the server-controlled edit link and do not add push/review actions.

- [ ] **Step 4: 验证并提交详情迁移**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/frontend test src/modules/leads/LeadDetailPage.spec.ts
pnpm --filter @dev-cor/frontend typecheck
git add frontend/src/modules/leads/LeadDetailPage.vue frontend/src/modules/leads/LeadDetailPage.spec.ts frontend/src/styles/demo-components.css
git commit -m "feat: align lead detail with demo layout"
```

---

### Task 6: 固化响应式壳层与真实浏览器验收

**Files:**

- Modify: `frontend/src/app/AppShell.spec.ts`
- Modify: `frontend/src/styles/app-shell.css`
- Modify: `frontend/src/styles/demo-components.css`
- Modify: `tests/e2e/core-leads.spec.ts`
- Modify: `docs/superpowers/specs/2026-09-22-demo-aligned-frontend-shell-leads-design.md`

**Interfaces:**

- Consumes: final shell and lead pages from Tasks 1–5.
- Produces: verified desktop/tablet/mobile behavior and design status `Implemented` only after gates pass.

- [ ] **Step 1: 先增加真实浏览器壳层测试**

Add one test to `core-leads.spec.ts` using the existing authenticated fixture:

```ts
test('Demo-aligned shell works on desktop and mobile', async ({ page }) => {
  await configureBrowser(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/leads');
  await expect(page.locator('[data-test="app-sidebar"]')).toBeVisible();
  await expect(page.locator('[data-test="mobile-nav-toggle"]')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-test="app-sidebar"]')).toBeHidden();
  await page.locator('[data-test="mobile-nav-toggle"]').click();
  await expect(page.locator('[data-test="app-sidebar"]')).toBeVisible();
  await page.locator('[data-test="lead-counter"]').first().click();
  await expect(page.locator('[data-test="app-sidebar"]')).toBeHidden();
});
```

- [ ] **Step 2: 运行该 E2E 并确认任何剩余响应式缺口**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm db:test:up
pnpm db:test:migrate:deploy
pnpm test:e2e:core-ld --grep "Demo-aligned shell"
```

Expected before final CSS completion: test fails only on an unmet visibility/drawer behavior assertion. If it already passes, do not add artificial behavior; retain it as regression coverage.

- [ ] **Step 3: 完成三个视口的 CSS 边界**

Ensure `app-shell.css` and `demo-components.css` contain exact behavior:

```css
@media (max-width: 767px) {
  .app-sidebar {
    transform: translateX(-100%);
  }
  .app-sidebar[data-open='true'] {
    transform: translateX(0);
  }
  .mobile-nav-toggle {
    display: inline-flex;
    min-width: 40px;
    min-height: 40px;
  }
  .demo-form-grid,
  .demo-detail-grid {
    grid-template-columns: 1fr;
  }
  .demo-table-wrap {
    overflow-x: auto;
  }
}
@media (min-width: 768px) {
  .mobile-nav-toggle {
    display: none;
  }
}
@media (min-width: 768px) and (max-width: 1279px) {
  .demo-detail-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (min-width: 1280px) {
  .app-shell {
    grid-template-columns: 232px minmax(0, 1fr);
  }
  .demo-detail-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (min-width: 1680px) {
  .app-content {
    max-width: 1440px;
    margin-inline: auto;
  }
}
```

- [ ] **Step 4: 运行前端候选检查**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm exec prettier frontend/src/app frontend/src/modules/leads frontend/src/modules/customers frontend/src/modules/organization frontend/src/styles tests/e2e/core-leads.spec.ts --check
pnpm --filter @dev-cor/frontend test
pnpm check:fast
git diff --check
```

Expected: formatting, 100% of frontend tests, architecture/type/lint checks, and diff whitespace checks pass.

- [ ] **Step 5: 运行真实数据库核心线索门禁**

```powershell
. .\Use-ProjectRuntime.ps1
pnpm verify:slice:core-ld
```

Expected: the complete formal core-lead validation scope passes on the unchanged final tree.

- [ ] **Step 6: 执行可视化验收**

Start the existing local environment, sign in with the local test administrator, and inspect these real routes at widths 1440, 1024, and 390:

```text
/leads
/leads/new
/leads/<fixture-id>
/leads/<fixture-id>/edit
/customers
/settings/people-access
```

For every width verify: no overlapping shell, no duplicate header, correct sidebar/drawer behavior, table horizontal scrolling, one-column mobile forms, visible focus states, readable empty/error state, and zero new console errors/warnings. Do not fabricate a fixture through direct database insertion for this visual check; use the formal browser/database fixture.

- [ ] **Step 7: 收口设计文档并提交最终候选**

After all checks pass, change the design document status line from `已确认，待生成实施计划` to `已实现并通过验收` and add the fixed commit/tree plus validation-evidence path. Then run:

```powershell
git add frontend tests/e2e/core-leads.spec.ts docs/superpowers/specs/2026-09-22-demo-aligned-frontend-shell-leads-design.md
git commit -m "test: verify demo-aligned lead frontend"
git status --short --branch
```

Expected: the final commit contains only verification/documentation adjustments not already committed by Tasks 1–5; the working tree is clean. Do not push or publish without a separate explicit user request.
