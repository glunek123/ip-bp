import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '../api/auth';
import { ApiError } from '../api/http';
import { useAuthStore } from '../stores/auth';
import AppShell from './AppShell.vue';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  notifyCalendarSummaryRead,
  workflowChangedEvent,
} from './workflow-events';

const api = vi.hoisted(() => ({
  getOrganizationManagementContext: vi.fn(),
  listLeads: vi.fn(),
  listNotaryOffices: vi.fn(),
  listNotaryMatters: vi.fn(),
  listCases: vi.fn(),
  listLawyerAccounts: vi.fn(),
  listLawyerCases: vi.fn(),
  getCalendarSummary: vi.fn(),
  getSettlementContext: vi.fn(),
  listEvidence: vi.fn(),
}));
const mountedShells: Array<ReturnType<typeof mount>> = [];
vi.mock('../api/settlements', () => ({
  getSettlementContext: api.getSettlementContext,
}));
vi.mock('../api/evidence', () => ({ listEvidence: api.listEvidence }));

vi.mock('../api/organization', () => ({
  getOrganizationManagementContext: api.getOrganizationManagementContext,
}));
vi.mock('../api/calendar', () => ({
  getCalendarSummary: api.getCalendarSummary,
}));
vi.mock('../api/lawyer-accounts', () => ({
  listLawyerAccounts: api.listLawyerAccounts,
}));
vi.mock('../api/leads', () => ({ listLeads: api.listLeads }));
vi.mock('../api/notary', () => ({
  listNotaryOffices: api.listNotaryOffices,
  listNotaryMatters: api.listNotaryMatters,
}));
vi.mock('../api/cases', () => ({
  listCases: api.listCases,
  listLawyerCases: api.listLawyerCases,
}));

const session = {
  principalType: 'INTERNAL' as const,
  user: { id: 'user-1', displayName: '管理员', username: 'admin' },
  department: { id: 'department-1', name: '知产部' },
  departments: [{ id: 'department-1', name: '知产部' }],
  customer: null,
  notaryOffice: null,
  authorizationRevision: 1,
  expiresAt: '2026-09-18T00:00:00.000Z',
  csrfToken: 'csrf-token',
};

beforeEach(() => {
  vi.resetAllMocks();
  api.getSettlementContext.mockResolvedValue({ read: false, feeRead: false });
  api.listEvidence.mockRejectedValue(
    new ApiError('denied', 403, 'ACTION_FORBIDDEN'),
  );
  api.getCalendarSummary.mockResolvedValue({
    metrics: { next30: { count: 0 } },
  });
  api.getOrganizationManagementContext.mockResolvedValue({});
  api.listLawyerAccounts.mockRejectedValue({ status: 403 });
  api.listLawyerCases.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 1,
    counts: {
      PENDING_MATCH: 0,
      WAITING_COMPLAINT: 0,
      WAITING_COMPLAINT_CONFIRMATION: 0,
      WAITING_COMPLAINT_STAMP: 0,
      WAITING_FILING: 0,
      WAITING_FORMAL_ACCEPTANCE: 0,
      WAITING_HEARING: 0,
      WAITING_JUDGMENT: 0,
      SECOND_INSTANCE: 0,
      WAITING_EXECUTION_DOCUMENTS: 0,
      WAITING_EXECUTION_CONFIRMATION: 0,
      WAITING_EXECUTION_STAMP: 0,
      WAITING_EXECUTION_FILING: 0,
      EXECUTING: 0,
      WAITING_ARCHIVE: 0,
      ARCHIVED: 0,
    },
  });
  api.listNotaryOffices.mockResolvedValue({
    items: [],
    capabilities: { create: false },
  });
  api.listNotaryMatters.mockResolvedValue({
    items: [],
    total: 4,
    page: 1,
    pageSize: 1,
    counts: {
      PENDING_EVIDENCE: 2,
      WAITING_UNBOX: 1,
      UNBOX_REVIEW: 1,
      ISSUANCE_DECISION: 1,
      WAITING_CERTIFICATE: 0,
      WAITING_RETURN: 0,
      ARCHIVED: 0,
    },
  });
  api.listLeads.mockResolvedValue({
    items: [],
    total: 13,
    page: 1,
    pageSize: 1,
    counts: {
      WAITING_PUSH: 7,
      WAITING_REVIEW: 3,
      WAITING_EVIDENCE_DECISION: 2,
      TRANSFERRED_TO_NOTARY: 0,
      ARCHIVED: 1,
    },
    capabilities: { create: true },
  });
  api.listCases.mockResolvedValue({
    items: [],
    total: 5,
    page: 1,
    pageSize: 1,
    counts: {
      PENDING_MATCH: 3,
      WAITING_COMPLAINT: 2,
      WAITING_COMPLAINT_CONFIRMATION: 1,
      WAITING_COMPLAINT_STAMP: 1,
      WAITING_FILING: 1,
      WAITING_FORMAL_ACCEPTANCE: 2,
      WAITING_HEARING: 1,
      WAITING_JUDGMENT: 3,
      SECOND_INSTANCE: 2,
      WAITING_EXECUTION_DOCUMENTS: 1,
      WAITING_EXECUTION_CONFIRMATION: 2,
      WAITING_EXECUTION_STAMP: 0,
      WAITING_EXECUTION_FILING: 0,
      EXECUTING: 0,
      WAITING_ARCHIVE: 0,
      ARCHIVED: 0,
    },
  });
});
afterEach(() => {
  for (const wrapper of mountedShells.splice(0)) wrapper.unmount();
});

async function mountShell(
  path = '/leads',
  activeSession: AuthSession = session,
) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore(pinia);
  auth.session = activeSession;
  auth.restored = true;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/evidence',
        component: { template: '<div />' },
        meta: { section: '证物', breadcrumbs: ['证物'] },
      },
      {
        path: '/settlements',
        component: { template: '<div />' },
        meta: { section: '结算中心', breadcrumbs: ['结算中心'] },
      },
      {
        path: '/customers',
        component: { template: '<div />' },
        meta: { section: '客户', breadcrumbs: ['客户'] },
      },
      {
        path: '/cases',
        component: { template: '<div />' },
        meta: { section: '案件', breadcrumbs: ['案件'] },
      },
      {
        path: '/cases/:id',
        component: { template: '<div />' },
        meta: {
          caseWorkspace: true,
          section: '案件',
          breadcrumbs: ['案件', '案件详情'],
        },
      },
      {
        path: '/lawyer/cases',
        component: { template: '<div />' },
        meta: { section: '案件', breadcrumbs: ['案件'] },
      },
      {
        path: '/lawyer/calendar',
        component: { template: '<div />' },
        meta: { section: '日期事件', breadcrumbs: ['日期事件'] },
      },
      {
        path: '/leads',
        component: { template: '<div />' },
        meta: { section: '线索', breadcrumbs: ['线索'] },
      },
      {
        path: '/notary-matters',
        component: { template: '<div />' },
        meta: { section: '公证阶段', breadcrumbs: ['公证阶段'] },
      },
      {
        path: '/notary-matters/:id',
        component: { template: '<div />' },
        meta: { section: '公证阶段', breadcrumbs: ['公证阶段', '事项详情'] },
      },
      {
        path: '/notary-portal/matters',
        component: { template: '<div />' },
        meta: { section: '待开箱', breadcrumbs: ['待开箱'] },
      },
      {
        path: '/settings/people-access',
        component: { template: '<div />' },
        meta: { section: '设置', breadcrumbs: ['设置', '人员与权限'] },
      },
      {
        path: '/notary-offices',
        component: { template: '<div />' },
        meta: { section: '设置', breadcrumbs: ['设置', '公证处'] },
      },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(AppShell, {
    slots: { default: '<div data-test="page-content">页面内容</div>' },
    global: { plugins: [pinia, router] },
  });
  mountedShells.push(wrapper);
  await flushPromises();
  return { wrapper, router };
}

describe('AppShell', () => {
  it('uses the current calendar read for its badge and rejects an older summary response', async () => {
    let resolveOld:
      ((value: { metrics: { next30: { count: number } } }) => void) | undefined;
    api.getCalendarSummary.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const { wrapper } = await mountShell();
    const identity = JSON.stringify([
      session.user.id,
      session.principalType,
      session.department.id,
      undefined,
      session.authorizationRevision,
    ]);
    notifyCalendarSummaryRead(identity, 3);
    await flushPromises();
    expect(wrapper.get('[data-test="calendar-count"]').text()).toBe('3');
    resolveOld?.({ metrics: { next30: { count: 99 } } });
    await flushPromises();
    expect(wrapper.get('[data-test="calendar-count"]').text()).toBe('3');
    notifyCalendarSummaryRead('other-user', 8);
    await flushPromises();
    expect(wrapper.get('[data-test="calendar-count"]').text()).toBe('3');
    notifyCalendarSummaryRead(identity, 0);
    await flushPromises();
    expect(wrapper.get('[data-test="calendar-count"]').text()).toBe('0');
    notifyCalendarSummaryRead(identity, null);
    await flushPromises();
    expect(wrapper.find('[data-test="calendar-count"]').exists()).toBe(false);
  });

  it('uses the visible date summary for the calendar badge and preserves real zero', async () => {
    const { wrapper } = await mountShell();
    expect(wrapper.get('[data-test="calendar-nav"]').attributes('href')).toBe(
      '/calendar',
    );
    expect(wrapper.get('[data-test="calendar-count"]').text()).toBe('0');
    expect(api.getCalendarSummary).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
  });

  it('does not disguise a failed calendar summary as a zero count', async () => {
    api.getCalendarSummary.mockRejectedValue(
      new ApiError('没有权限', 403, 'ACTION_FORBIDDEN'),
    );
    const { wrapper } = await mountShell();
    expect(wrapper.find('[data-test="calendar-count"]').exists()).toBe(false);
  });

  it('discards a late calendar count after a department change', async () => {
    let resolveOld:
      ((value: { metrics: { next30: { count: number } } }) => void) | undefined;
    api.getCalendarSummary.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const { wrapper } = await mountShell();
    const oldSignal = api.getCalendarSummary.mock.calls[0][0].signal;
    api.getCalendarSummary.mockResolvedValueOnce({
      metrics: { next30: { count: 2 } },
    });
    const auth = useAuthStore();
    auth.session = {
      ...session,
      department: { id: 'department-2', name: '品维部' },
    };
    await flushPromises();
    expect(oldSignal.aborted).toBe(true);
    expect(wrapper.get('[data-test="calendar-count"]').text()).toBe('2');
    resolveOld?.({ metrics: { next30: { count: 99 } } });
    await flushPromises();
    expect(wrapper.get('[data-test="calendar-count"]').text()).toBe('2');
  });
  it('adds one formal acceptance stage link with its current count', async () => {
    const { wrapper } = await mountShell();
    await wrapper.get('[data-test="case-expand"]').trigger('click');
    const stages = wrapper.findAll('[data-test="case-stage"]');
    expect(stages.map((link) => link.text())).toContain('待正式立案2');
    expect(stages.map((link) => link.text())).toContain('待开庭1');
    expect(stages.map((link) => link.text())).toContain('待判决3');
    expect(stages).toHaveLength(10);
    expect(
      wrapper.get('[data-test="execution-preparation-nav"]').text(),
    ).toContain('准备执行文书3');
    expect(
      wrapper
        .get('[data-test="execution-preparation-stage"]')
        .attributes('href'),
    ).toContain('stageGroup=EXECUTION_PREPARATION');
    expect(
      wrapper
        .get('[data-test="execution-preparation-stage"]')
        .attributes('href'),
    ).not.toContain('stage=');
    expect(wrapper.get('[data-test="case-nav"]').text()).toContain('19');
  });

  it('renders a minimal, distinct navigation for notary accounts', async () => {
    const notarySession: AuthSession = {
      ...session,
      principalType: 'NOTARY',
      department: null,
      departments: [],
      notaryOffice: { id: 'office-1', name: '南方公证处' },
    };
    const { wrapper } = await mountShell(
      '/notary-portal/matters',
      notarySession,
    );
    expect(wrapper.get('[data-test="notary-portal-nav"]').text()).toContain(
      '公证事项',
    );
    expect(wrapper.find('[data-test="lead-nav"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="notary-nav"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="customer-nav"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="case-nav"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="calendar-nav"]').exists()).toBe(false);
    expect(api.getCalendarSummary).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="settings-expand"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('南方公证处');
  });

  it('keeps the lawyer shell on本人案件 and never requests internal lists', async () => {
    const lawyerSession: AuthSession = {
      ...session,
      principalType: 'LAWYER',
      department: null,
      departments: [],
      customer: null,
      notaryOffice: null,
    };
    api.listLawyerCases.mockResolvedValueOnce({
      items: [],
      total: 1,
      page: 1,
      pageSize: 1,
      counts: {
        PENDING_MATCH: 0,
        WAITING_COMPLAINT: 0,
        WAITING_COMPLAINT_CONFIRMATION: 0,
        WAITING_COMPLAINT_STAMP: 0,
        WAITING_FILING: 0,
        WAITING_FORMAL_ACCEPTANCE: 0,
        WAITING_HEARING: 0,
        WAITING_JUDGMENT: 0,
        SECOND_INSTANCE: 0,
        WAITING_EXECUTION_DOCUMENTS: 1,
        WAITING_EXECUTION_CONFIRMATION: 2,
        WAITING_EXECUTION_STAMP: 0,
        WAITING_EXECUTION_FILING: 0,
        EXECUTING: 0,
        WAITING_ARCHIVE: 0,
        ARCHIVED: 0,
      },
    });
    const { wrapper } = await mountShell('/lawyer/cases', lawyerSession);
    expect(wrapper.get('[data-test="lawyer-case-nav"]').text()).toContain(
      '本人案件',
    );
    expect(wrapper.find('[data-test="case-nav"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="lead-nav"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="customer-nav"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="settings-expand"]').exists()).toBe(false);
    expect(api.listLawyerCases).toHaveBeenCalled();
    expect(
      wrapper.get('[data-test="lawyer-execution-preparation-nav"]').text(),
    ).toContain('准备执行文书3');
    expect(
      wrapper
        .get('[data-test="execution-preparation-stage"]')
        .attributes('href'),
    ).toContain('stageGroup=EXECUTION_PREPARATION');
    expect(api.listCases).not.toHaveBeenCalled();
    expect(api.listLeads).not.toHaveBeenCalled();
    expect(api.listNotaryMatters).not.toHaveBeenCalled();
  });

  it('renders authorized navigation and route breadcrumbs', async () => {
    const { wrapper } = await mountShell();

    expect(wrapper.get('[data-test="app-shell"]')).toBeDefined();
    expect(wrapper.get('[data-test="lead-nav"]').classes()).toContain('active');
    expect(wrapper.get('[data-test="breadcrumbs"]').text()).toContain('线索');
    await wrapper.get('[data-test="settings-expand"]').trigger('click');
    expect(wrapper.get('[data-test="people-access-nav"]')).toBeDefined();
    expect(wrapper.get('[data-test="notary-offices-nav"]')).toBeDefined();
    expect(wrapper.get('[data-test="page-content"]').text()).toBe('页面内容');
    expect(wrapper.get('[data-test="customer-nav"]').text()).toContain(
      '客户管理',
    );
    expect(api.listLeads).toHaveBeenCalledWith(
      1,
      1,
      expect.any(Object),
      undefined,
      'LIBRARY',
    );
  });

  it('shows the internal case entry without exposing it to clients', async () => {
    const { wrapper } = await mountShell();
    expect(wrapper.get('[data-test="case-nav"]').attributes('href')).toBe(
      '/cases',
    );
    const client = {
      ...session,
      principalType: 'CLIENT' as const,
      customer: { id: 'customer-1', name: '客户甲' },
      department: null,
      departments: [],
    };
    const clientShell = await mountShell('/client/leads', client);
    expect(clientShell.wrapper.find('[data-test="case-nav"]').exists()).toBe(
      false,
    );
    expect(
      clientShell.wrapper
        .get('[data-test="client-case-nav"]')
        .attributes('href'),
    ).toBe('/client/cases');
  });

  it('offers one case stage directory under the selected personal or department view', async () => {
    const { wrapper, router } = await mountShell('/cases?view=department');
    expect(
      wrapper.get('[data-test="case-view-department"]').classes(),
    ).toContain('active');
    expect(
      wrapper.get('[data-test="case-view-mine"]').attributes('href'),
    ).toContain('view=mine');
    expect(wrapper.findAll('[data-test="case-stage"]')).toHaveLength(10);
    expect(wrapper.get('[data-test="case-nav"]').text()).toContain('19');
    expect(api.listCases).toHaveBeenCalledWith(1, 1, {
      signal: expect.any(AbortSignal),
      view: 'department',
    });
    await router.push('/cases?view=mine&stage=WAITING_COMPLAINT');
    await flushPromises();
    expect(wrapper.get('[data-test="case-view-mine"]').classes()).toContain(
      'active',
    );
    expect(
      wrapper.get('[data-test="complaint-preparation-stage"]').classes(),
    ).toContain('active');
    expect(
      wrapper.get('[data-test="complaint-preparation-stage"]').text(),
    ).toBe('准备起诉文书4');
    expect(router.currentRoute.value.query.stage).toBe('WAITING_COMPLAINT');
    expect(
      wrapper.get('[data-test="case-view-department"]').attributes('href'),
    ).toContain('stage=WAITING_COMPLAINT');
    expect(wrapper.text()).not.toContain('诉状待盖章');
  });

  it('shows the notary office entry only when the office list is authorized', async () => {
    api.listNotaryOffices.mockRejectedValueOnce(new Error('forbidden'));
    const { wrapper } = await mountShell();
    expect(wrapper.find('[data-test="notary-offices-nav"]').exists()).toBe(
      false,
    );
  });

  it('uses real lead counts and route-backed status links', async () => {
    const { wrapper } = await mountShell();
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

  it('opens the notary group on a matter route with matter counts', async () => {
    const { wrapper } = await mountShell('/notary-matters/matter-1');
    expect(wrapper.get('[data-test="notary-nav"]').classes()).toContain(
      'active',
    );
    expect(wrapper.get('[data-test="breadcrumbs"]').text()).toContain(
      '公证阶段',
    );
    expect(
      wrapper
        .findAll('[data-test="notary-counter"]')
        .map((item) => item.text()),
    ).toEqual([
      '待取证2',
      '待取件开箱1',
      '开箱待审核1',
      '开箱待确认1',
      '待出证0',
      '待退货0',
      '已归档0',
    ]);
    expect(wrapper.find('[data-test="lead-counter"]').exists()).toBe(false);
  });

  it('keeps the sidebar notary stages as route-backed filters', async () => {
    const { wrapper, router } = await mountShell(
      '/notary-matters?stage=ISSUANCE_DECISION',
    );
    const stages = wrapper.findAll('[data-test="notary-counter"]');
    const selected = stages.find((item) =>
      item.text().startsWith('开箱待确认'),
    );
    const waitingReturn = stages.find((item) =>
      item.text().startsWith('待退货'),
    );

    expect(selected?.classes()).toContain('active');
    expect(selected?.attributes('href')).toBe(
      '/notary-matters?stage=ISSUANCE_DECISION',
    );
    await waitingReturn!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.stage).toBe('WAITING_RETURN');
  });

  it('does not show the matter group when its scoped list is forbidden', async () => {
    api.listNotaryMatters.mockRejectedValueOnce(new Error('forbidden'));
    const { wrapper } = await mountShell();
    expect(wrapper.find('[data-test="notary-nav"]').exists()).toBe(false);
  });

  it('hides denied internal case navigation and stops counter reads until authorization changes', async () => {
    api.listCases.mockRejectedValue(
      new ApiError('revoked', 403, 'ACTION_FORBIDDEN'),
    );
    const { wrapper, router } = await mountShell('/cases/case-1');
    expect(wrapper.find('[data-test="case-nav"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="case-expand"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="案件范围与阶段"]').exists()).toBe(false);
    expect(api.listCases).toHaveBeenCalledTimes(1);
    await router.push('/cases?view=department');
    window.dispatchEvent(new Event(workflowChangedEvent));
    await flushPromises();
    expect(api.listCases).toHaveBeenCalledTimes(1);
    const auth = useAuthStore();
    auth.session = { ...session, authorizationRevision: 2 };
    await flushPromises();
    expect(api.listCases).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-test="case-nav"]').exists()).toBe(false);
  });

  it('keeps case navigation for an authorized read-only empty list', async () => {
    const base = await api.listCases();
    api.listCases.mockClear();
    api.listCases.mockResolvedValue({ ...base, total: 0, items: [] });
    const { wrapper } = await mountShell('/cases');
    expect(wrapper.get('[data-test="case-nav"]').text()).toContain('案件');
    expect(wrapper.get('[data-test="case-view-department"]').text()).toBe(
      '本部门全部',
    );
  });

  it.each([
    new ApiError('unavailable', 500, 'INTERNAL_ERROR'),
    new TypeError('Failed to fetch'),
    new ApiError('timed out', 0, 'TIMEOUT'),
  ])(
    'offers an explicit case navigation retry after an initial recoverable error %s',
    async (error) => {
      const base = await api.listCases();
      api.listCases.mockClear();
      api.listCases.mockRejectedValueOnce(error);
      const { wrapper } = await mountShell('/cases');
      expect(wrapper.find('[data-test="case-nav"]').exists()).toBe(false);
      expect(wrapper.get('[data-test="case-nav-error"]').text()).toContain(
        '暂时无法读取',
      );
      expect(api.listCases).toHaveBeenCalledTimes(1);
      const leadCalls = api.listLeads.mock.calls.length;
      const notaryCalls = api.listNotaryMatters.mock.calls.length;
      api.listCases.mockResolvedValueOnce(base);
      await wrapper.get('[data-test="case-nav-retry"]').trigger('click');
      await flushPromises();
      expect(api.listCases).toHaveBeenCalledTimes(2);
      expect(api.listLeads).toHaveBeenCalledTimes(leadCalls);
      expect(api.listNotaryMatters).toHaveBeenCalledTimes(notaryCalls);
      expect(wrapper.get('[data-test="case-nav"]').text()).toContain('案件');
      expect(wrapper.find('[data-test="case-nav-error"]').exists()).toBe(false);
    },
  );

  it('retains a known readable entry on server failure and obeys a denied retry', async () => {
    const { wrapper, router } = await mountShell('/cases');
    api.listCases.mockRejectedValueOnce(
      new ApiError('unavailable', 500, 'INTERNAL_ERROR'),
    );
    await router.push('/cases?view=department');
    await flushPromises();
    expect(wrapper.get('[data-test="case-nav"]').text()).toBe('案件');
    expect(wrapper.get('[data-test="case-nav-error"]').text()).toContain(
      '暂时无法读取',
    );
    api.listCases.mockRejectedValue(
      new ApiError('revoked', 403, 'ACTION_FORBIDDEN'),
    );
    await wrapper.get('[data-test="case-nav-retry"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="case-nav"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="case-nav-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="case-nav-retry"]').exists()).toBe(false);
    const calls = api.listCases.mock.calls.length;
    window.dispatchEvent(new Event(workflowChangedEvent));
    await flushPromises();
    expect(api.listCases).toHaveBeenCalledTimes(calls);
  });

  it('does not clear a new identity failure with a late successful response', async () => {
    const base = await api.listCases();
    let resolveOld!: (value: unknown) => void;
    api.listCases.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    const { wrapper } = await mountShell('/cases');
    api.listCases.mockRejectedValue(new TypeError('Failed to fetch'));
    const auth = useAuthStore();
    auth.session = { ...session, authorizationRevision: 2 };
    await flushPromises();
    expect(wrapper.get('[data-test="case-nav-error"]').text()).toContain(
      '暂时无法读取',
    );
    resolveOld(base);
    await flushPromises();
    expect(wrapper.get('[data-test="case-nav-error"]').text()).toContain(
      '暂时无法读取',
    );
    expect(wrapper.find('[data-test="case-nav"]').exists()).toBe(false);
  });

  it('disables an in-flight explicit retry without starting another read', async () => {
    const base = await api.listCases();
    api.listCases.mockClear();
    api.listCases.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { wrapper } = await mountShell('/cases');
    let finish!: (value: unknown) => void;
    api.listCases.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await wrapper.get('[data-test="case-nav-retry"]').trigger('click');
    await flushPromises();
    expect(
      wrapper.get('[data-test="case-nav-retry"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('[data-test="case-nav-retry"]').trigger('click');
    await flushPromises();
    expect(api.listCases).toHaveBeenCalledTimes(2);
    finish(base);
    await flushPromises();
    expect(wrapper.find('[data-test="case-nav-error"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="case-nav"]').text()).toContain('案件');
  });

  it.each([
    new ApiError('unavailable', 500, 'INTERNAL_ERROR'),
    new DOMException('aborted', 'AbortError'),
  ])(
    'ignores a late obsolete identity error %s after current success',
    async (error) => {
      let failOld!: (reason: unknown) => void;
      api.listCases.mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          failOld = reject;
        }),
      );
      const { wrapper } = await mountShell('/cases');
      const signal = api.listCases.mock.calls.at(-1)![2].signal as AbortSignal;
      const auth = useAuthStore();
      auth.session = { ...session, authorizationRevision: 2 };
      await flushPromises();
      expect(signal.aborted).toBe(true);
      failOld(error);
      await flushPromises();
      expect(wrapper.get('[data-test="case-nav"]').text()).toContain('案件');
      expect(wrapper.find('[data-test="case-nav-error"]').exists()).toBe(false);
    },
  );

  it('aborts on unmount and cannot attach its late error to the next shell', async () => {
    let failOld!: (reason: unknown) => void;
    api.listCases.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        failOld = reject;
      }),
    );
    const old = await mountShell('/cases');
    const signal = api.listCases.mock.calls.at(-1)![2].signal as AbortSignal;
    old.wrapper.unmount();
    expect(signal.aborted).toBe(true);
    const current = await mountShell('/cases');
    failOld(new DOMException('aborted', 'AbortError'));
    await flushPromises();
    expect(current.wrapper.get('[data-test="case-nav"]').text()).toContain(
      '案件',
    );
    expect(current.wrapper.find('[data-test="case-nav-error"]').exists()).toBe(
      false,
    );
  });

  it('refreshes workflow counters after an in-place stage change', async () => {
    const { wrapper } = await mountShell('/notary-matters/matter-1');
    expect(wrapper.get('[data-test="notary-nav"]').text()).toContain('5');
    api.listNotaryMatters.mockResolvedValueOnce({
      items: [],
      total: 3,
      page: 1,
      pageSize: 1,
      counts: {
        PENDING_EVIDENCE: 1,
        WAITING_UNBOX: 1,
        UNBOX_REVIEW: 1,
        ISSUANCE_DECISION: 0,
        WAITING_CERTIFICATE: 0,
        WAITING_RETURN: 0,
        ARCHIVED: 0,
      },
    });
    window.dispatchEvent(new Event('dev-cor:workflow-changed'));
    await flushPromises();
    expect(wrapper.get('[data-test="notary-nav"]').text()).toContain('3');
  });

  it('opens and closes the mobile navigation drawer', async () => {
    const { wrapper } = await mountShell();

    expect(
      wrapper.get('[data-test="app-sidebar"]').attributes('data-open'),
    ).toBe('false');
    await wrapper.get('[data-test="mobile-nav-toggle"]').trigger('click');
    expect(
      wrapper.get('[data-test="app-sidebar"]').attributes('data-open'),
    ).toBe('true');
    await wrapper.get('[data-test="lead-nav"]').trigger('click');
    expect(
      wrapper.get('[data-test="app-sidebar"]').attributes('data-open'),
    ).toBe('false');
  });

  it('hides a closed sidebar immediately at the mobile breakpoint and keeps desktop layout outside it', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync(
      resolve(import.meta.dirname, '../styles/app-shell.css'),
      'utf8',
    );
    document.head.append(style);
    try {
      const rules = Array.from(style.sheet!.cssRules);
      const mobile = rules
        .filter(
          (rule): rule is CSSMediaRule => rule.type === CSSRule.MEDIA_RULE,
        )
        .find((rule) => rule.media.mediaText === '(max-width: 767px)')!;
      const mobileRules = Array.from(mobile.cssRules).filter(
        (rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE,
      );
      const closed = mobileRules.find(
        (rule) => rule.selectorText === '.app-sidebar',
      )!;
      expect(closed.style.getPropertyValue('visibility')).toBe('hidden');
      expect(closed.style.getPropertyValue('transform')).toBe(
        'translateX(-100%)',
      );
      expect(closed.style.getPropertyValue('transition')).toBe('none');
      const opened = mobileRules.find(
        (rule) =>
          rule.selectorText.replaceAll('"', "'") ===
          ".app-sidebar[data-open='true']",
      )!;
      expect(opened.style.getPropertyValue('visibility')).toBe('visible');
      expect(opened.style.getPropertyValue('transform')).toBe('translateX(0)');
      const desktop = rules
        .filter(
          (rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE,
        )
        .find((rule) => rule.selectorText === '.app-sidebar')!;
      expect(desktop.style.getPropertyValue('position')).toBe('sticky');
      expect(desktop.style.getPropertyValue('visibility')).toBe('');
      expect(desktop.style.getPropertyValue('transform')).toBe('');
    } finally {
      style.remove();
    }
  });

  it('allows the notary branch to be reopened from the mobile drawer', async () => {
    const { wrapper } = await mountShell('/notary-matters');
    await wrapper.get('[data-test="mobile-nav-toggle"]').trigger('click');
    expect(
      wrapper.get('[data-test="notary-expand"]').attributes('aria-expanded'),
    ).toBe('true');
    await wrapper.get('[data-test="notary-expand"]').trigger('click');
    expect(wrapper.find('[data-test="notary-counter"]').exists()).toBe(false);
    await wrapper.get('[data-test="notary-expand"]').trigger('click');
    expect(wrapper.findAll('[data-test="notary-counter"]')).toHaveLength(7);
  });

  it('labels the client navigation for both review queues', async () => {
    const clientSession = {
      ...session,
      principalType: 'CLIENT' as const,
      customer: { id: 'customer-1', name: '客户甲' },
      department: null,
      departments: [],
    };
    const { wrapper } = await mountShell('/client/leads', clientSession);

    expect(wrapper.get('[data-test="client-lead-nav"]').text()).toContain(
      '线索审核',
    );
    expect(wrapper.get('[data-test="client-notary-nav"]').text()).toContain(
      '公证审核',
    );
    expect(
      wrapper.get('[data-test="client-notary-nav"]').attributes('href'),
    ).toBe('/client/notary-matters');
    expect(wrapper.text()).not.toContain('待审核线索');
    expect(wrapper.find('[data-test="lead-nav"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="customer-nav"]').exists()).toBe(false);
  });
});

it('links the real WAITING_ARCHIVE count without implying financial completion', async () => {
  const result = await api.listCases();
  api.listCases.mockClear();
  api.listCases.mockResolvedValue({
    ...result,
    counts: { ...result.counts, WAITING_ARCHIVE: 2 },
  });
  const { wrapper } = await mountShell('/cases?stage=WAITING_ARCHIVE');
  const link = wrapper
    .findAll('[data-test="case-stage"]')
    .find((entry) => entry.text() === '待归档2');
  expect(link?.attributes('href')).toContain('stage=WAITING_ARCHIVE');
  expect(link?.classes()).toContain('active');
  expect(wrapper.text()).not.toContain('已结清');
  expect(wrapper.text()).not.toContain('已结算');
});

const navigationLabels = [
  '全部阶段',
  '案件待匹配',
  '准备起诉文书',
  '待提交立案',
  '待正式立案',
  '待开庭',
  '待判决',
  '二审',
  '准备执行文书',
  '待申请执行',
  '强制执行中',
  '待归档',
  '已归档',
];
const lawyerSession: AuthSession = { ...session, principalType: 'LAWYER' };
describe('case route context', () => {
  it.each(['/cases?view=mine', '/cases?view=department', '/lawyer/cases'])(
    'refreshes the real archived count in the current scope after workflow changes in %s',
    async (path) => {
      const lawyer = path.startsWith('/lawyer');
      const listApi = lawyer ? api.listLawyerCases : api.listCases;
      const base = await listApi();
      listApi.mockClear();
      listApi.mockResolvedValue({
        ...base,
        counts: { ...base.counts, ARCHIVED: 2 },
      });
      const { wrapper } = await mountShell(
        `${path}${path.includes('?') ? '&' : '?'}stage=ARCHIVED`,
        lawyer ? lawyerSession : session,
      );
      const archivedLink = () =>
        wrapper
          .findAll('[data-test="case-stage"]')
          .find((link) => link.get('span').text() === '已归档')!;
      expect(archivedLink().text()).toBe('已归档2');
      expect(archivedLink().classes()).toContain('active');
      listApi.mockResolvedValue({
        ...base,
        counts: { ...base.counts, ARCHIVED: 3 },
      });
      window.dispatchEvent(new Event(workflowChangedEvent));
      await flushPromises();
      expect(archivedLink().text()).toBe('已归档3');
      if (lawyer) {
        expect(listApi).toHaveBeenLastCalledWith(
          1,
          1,
          undefined,
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
        expect(api.listCases).not.toHaveBeenCalled();
      } else {
        expect(listApi).toHaveBeenLastCalledWith(
          1,
          1,
          expect.objectContaining({
            view: path.includes('department') ? 'department' : 'mine',
          }),
        );
      }
      expect(wrapper.text()).not.toContain('已结清');
    },
  );
  it.each([
    ['PENDING_MATCH', '案件待匹配'],
    ['WAITING_FILING', '待提交立案'],
    ['WAITING_FORMAL_ACCEPTANCE', '待正式立案'],
    ['WAITING_HEARING', '待开庭'],
    ['WAITING_JUDGMENT', '待判决'],
    ['SECOND_INSTANCE', '二审'],
    ['WAITING_EXECUTION_FILING', '待申请执行'],
    ['EXECUTING', '强制执行中'],
    ['WAITING_ARCHIVE', '待归档'],
    ['ARCHIVED', '已归档'],
  ])(
    'selects only the bookmarked atomic stage %s in both case shells',
    async (stage, label) => {
      for (const path of [
        '/cases?view=mine',
        '/cases?view=department',
        '/lawyer/cases',
      ]) {
        const isLawyer = path.startsWith('/lawyer');
        const { wrapper, router } = await mountShell(
          `${path}${path.includes('?') ? '&' : '?'}stage=${stage}&page=3`,
          isLawyer ? lawyerSession : session,
        );
        const nav = wrapper.get(
          isLawyer
            ? '[aria-label="本人案件阶段"]'
            : '[aria-label="案件范围与阶段"]',
        );
        const active = nav
          .findAll('a.active')
          .filter(
            (link) => !link.attributes('data-test')?.startsWith('case-view-'),
          );
        expect(active).toHaveLength(1);
        expect(active[0].get('span').text()).toBe(label);
        expect(router.currentRoute.value.query.stage).toBe(stage);
        expect(router.currentRoute.value.query.page).toBe('3');
      }
    },
  );
  it.each([
    '/notary-matters?stage=ARCHIVED&view=department&page=3',
    '/notary-matters?stage=WAITING_HEARING&stageGroup=COMPLAINT_PREPARATION&view=department&page=3',
    '/leads?status=ARCHIVED&stageGroup=EXECUTION_PREPARATION&view=department&page=3',
    '/customers?stage=WAITING_HEARING&view=department&page=3',
  ])('drops foreign case filters when entering cases from %s', async (path) => {
    const { wrapper, router } = await mountShell(path);
    await wrapper.get('[data-test="case-expand"]').trigger('click');
    const nav = wrapper.get('[aria-label="案件范围与阶段"]');
    expect(nav.findAll('a.active')).toHaveLength(0);
    for (const view of ['mine', 'department']) {
      expect(
        wrapper.get(`[data-test="case-view-${view}"]`).attributes('href'),
      ).toBe(`/cases?view=${view}`);
    }
    expect(
      wrapper
        .get('[data-test="complaint-preparation-stage"]')
        .attributes('href'),
    ).toBe('/cases?view=mine&stageGroup=COMPLAINT_PREPARATION');
    await wrapper.get('[data-test="case-view-department"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/cases');
    expect(router.currentRoute.value.query).toEqual({ view: 'department' });
    expect(nav.findAll('a.active').map((link) => link.text())).toEqual([
      '本部门全部',
      '全部阶段19',
    ]);
    expect(api.listCases).toHaveBeenLastCalledWith(1, 1, {
      signal: expect.any(AbortSignal),
      view: 'department',
    });
  });

  it('applies compact density only to the internal case workspace and clears it on list navigation', async () => {
    const { wrapper, router } = await mountShell('/cases/case-1?tab=files');
    expect(wrapper.get('.app-content').classes()).toContain(
      'app-content--case-workspace',
    );
    for (const path of ['/cases', '/customers', '/leads']) {
      await router.push(path);
      await flushPromises();
      expect(wrapper.get('.app-content').classes()).not.toContain(
        'app-content--case-workspace',
      );
    }
    await router.push('/cases/case-2?tab=fees');
    await flushPromises();
    expect(wrapper.get('.app-content').classes()).toContain(
      'app-content--case-workspace',
    );
  });

  it.each(['details', 'files', 'fees'])(
    'drops the %s workspace tab when returning through case scope navigation',
    async (tab) => {
      for (const filter of [
        'stage=WAITING_HEARING',
        'stageGroup=EXECUTION_PREPARATION',
      ]) {
        const listFilter = Object.fromEntries(new URLSearchParams(filter));
        const query = new URLSearchParams({
          ...listFilter,
          tab,
          view: 'mine',
          page: '3',
        });
        const { wrapper, router } = await mountShell(`/cases/case-1?${query}`);
        await wrapper
          .get('[data-test="case-view-department"]')
          .trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/cases');
        expect(router.currentRoute.value.query).toEqual({
          ...listFilter,
          view: 'department',
        });
        expect(router.currentRoute.value.meta.caseWorkspace).not.toBe(true);
      }
    },
  );

  it.each([
    'stage=WAITING_HEARING',
    'stage=WAITING_COMPLAINT_CONFIRMATION',
    'stage=WAITING_EXECUTION_STAMP',
    'stageGroup=COMPLAINT_PREPARATION',
    'stageGroup=EXECUTION_PREPARATION',
    'stage=all',
    'stage=all&stageGroup=EXECUTION_PREPARATION',
  ])(
    'preserves the case bookmark and resets pagination for %s',
    async (filter) => {
      const { wrapper, router } = await mountShell(
        `/cases?view=mine&${filter}&page=3`,
      );
      const filters = { ...router.currentRoute.value.query };
      delete filters.page;
      const nav = wrapper.get('[aria-label="案件范围与阶段"]');
      const activeStages = () =>
        nav
          .findAll('a.active')
          .filter(
            (link) => !link.attributes('data-test')?.startsWith('case-view-'),
          );
      expect(activeStages()).toHaveLength(1);
      const selectedLabel = activeStages()[0].text();
      for (const view of ['department', 'mine']) {
        await wrapper.get(`[data-test="case-view-${view}"]`).trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.query).toEqual({ ...filters, view });
        expect(activeStages()).toHaveLength(1);
        expect(activeStages()[0].text()).toBe(selectedLabel);
      }
      await wrapper
        .get('[data-test="execution-preparation-stage"]')
        .trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.query).toEqual({
        view: 'mine',
        stageGroup: 'EXECUTION_PREPARATION',
      });
    },
  );

  it.each([
    'stage=UNKNOWN',
    'stage=WAITING_HEARING&stage=WAITING_JUDGMENT',
    'stage',
    'stageGroup=UNKNOWN',
    'stageGroup=COMPLAINT_PREPARATION&stageGroup=EXECUTION_PREPARATION',
    'stageGroup',
  ])(
    'preserves rejected case filters on scope switches for %s',
    async (filter) => {
      const { wrapper, router } = await mountShell(`/cases?${filter}&page=3`);
      const filters = { ...router.currentRoute.value.query };
      delete filters.page;
      const nav = wrapper.get('[aria-label="案件范围与阶段"]');
      expect(
        nav
          .findAll('a.active')
          .filter(
            (link) => !link.attributes('data-test')?.startsWith('case-view-'),
          ),
      ).toHaveLength(0);
      for (const view of ['department', 'mine']) {
        await wrapper.get(`[data-test="case-view-${view}"]`).trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.query).toEqual({ ...filters, view });
      }
    },
  );

  it('does not select a lawyer case stage from a foreign route', async () => {
    const { wrapper, router } = await mountShell(
      '/lawyer/calendar?stage=WAITING_HEARING&stageGroup=EXECUTION_PREPARATION&page=3',
      lawyerSession,
    );
    const nav = wrapper.get('[aria-label="本人案件阶段"]');
    expect(nav.findAll('a.active')).toHaveLength(0);
    await wrapper
      .get('[data-test="execution-preparation-stage"]')
      .trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/lawyer/cases');
    expect(router.currentRoute.value.query).toEqual({
      stageGroup: 'EXECUTION_PREPARATION',
    });
    expect(nav.findAll('a.active')).toHaveLength(1);
  });

  it.each(['/cases', '/lawyer/cases'])(
    'keeps the current URL unchanged and resets page on explicit stage navigation in %s',
    async (path) => {
      const original = `${path}?stage=ARCHIVED&page=3`;
      const { wrapper, router } = await mountShell(
        original,
        path.startsWith('/lawyer') ? lawyerSession : session,
      );
      expect(router.currentRoute.value.fullPath).toBe(original);
      await wrapper
        .get('[data-test="complaint-preparation-stage"]')
        .trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.query).toEqual({
        ...(path === '/cases' ? { view: 'mine' } : {}),
        stageGroup: 'COMPLAINT_PREPARATION',
      });
      await router.push(`${path}?stageGroup=EXECUTION_PREPARATION&page=3`);
      await flushPromises();
      const hearing = wrapper
        .findAll('[data-test="case-stage"]')
        .find((link) => link.text().startsWith('待开庭'));
      await hearing!.trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.query).toEqual({
        ...(path === '/cases' ? { view: 'mine' } : {}),
        stage: 'WAITING_HEARING',
      });
      await router.push(`${path}?stage=WAITING_HEARING&page=3`);
      await flushPromises();
      const nav = wrapper.get(
        path === '/cases'
          ? '[aria-label="案件范围与阶段"]'
          : '[aria-label="本人案件阶段"]',
      );
      const allStages = nav
        .findAll('a')
        .find(
          (link) =>
            link.find('span').exists() &&
            link.get('span').text() === '全部阶段',
        );
      await allStages!.trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.query).toEqual(
        path === '/cases' ? { view: 'mine' } : {},
      );
      const active = nav
        .findAll('a.active')
        .filter(
          (link) => !link.attributes('data-test')?.startsWith('case-view-'),
        );
      expect(active).toHaveLength(1);
      expect(active[0].get('span').text()).toBe('全部阶段');
    },
  );
});
it.each(['/cases?view=mine', '/cases?view=department', '/lawyer/cases'])(
  'orders a single stage directory in %s',
  async (path) => {
    const { wrapper } = await mountShell(
      path,
      path.startsWith('/lawyer') ? lawyerSession : session,
    );
    const nav = wrapper.get(
      path.startsWith('/lawyer')
        ? '[aria-label="本人案件阶段"]'
        : '[aria-label="案件范围与阶段"]',
    );
    expect(
      nav
        .findAll('a')
        .filter((link) => link.find('span').exists())
        .map((link) => link.get('span').text()),
    ).toEqual(navigationLabels);
    expect(nav.text()).toContain('已归档');
    expect(nav.text()).not.toContain('诉状待确认');
    expect(nav.text()).not.toContain('执行材料待盖章');
    wrapper.unmount();
  },
);
it('orders the internal workflow modules while preserving other entries', async () => {
  const { wrapper } = await mountShell('/cases');
  const entries = wrapper.findAll(
    '[data-test="lead-nav"], [data-test="notary-nav"], [data-test="case-nav"]',
  );
  expect(entries.map((link) => link.attributes('data-test'))).toEqual([
    'lead-nav',
    'notary-nav',
    'case-nav',
  ]);
});
describe.each([
  [
    'COMPLAINT_PREPARATION',
    '准备起诉文书',
    [
      'WAITING_COMPLAINT',
      'WAITING_COMPLAINT_CONFIRMATION',
      'WAITING_COMPLAINT_STAMP',
    ],
  ],
  [
    'EXECUTION_PREPARATION',
    '准备执行文书',
    [
      'WAITING_EXECUTION_DOCUMENTS',
      'WAITING_EXECUTION_CONFIRMATION',
      'WAITING_EXECUTION_STAMP',
    ],
  ],
] as const)('%s sidebar', (group, label, stages) => {
  it.each(['/cases?view=mine', '/cases?view=department', '/lawyer/cases'])(
    'highlights only the group and sums full atomic counts for %s',
    async (path) => {
      const base = await api.listCases();
      const counts = {
        ...base.counts,
        [stages[0]]: 8,
        [stages[1]]: 9,
        [stages[2]]: 10,
        PENDING_MATCH: 90,
        WAITING_FILING: 80,
        WAITING_EXECUTION_FILING: 70,
      };
      api.listCases.mockResolvedValue({ ...base, items: [], total: 1, counts });
      api.listLawyerCases.mockResolvedValue({
        ...base,
        items: [],
        total: 1,
        counts,
      });
      const { wrapper, router } = await mountShell(
        path + (path.includes('?') ? '&' : '?') + 'stageGroup=' + group,
        path.startsWith('/lawyer') ? lawyerSession : session,
      );
      const nav = wrapper.get(
        path.startsWith('/lawyer')
          ? '[aria-label="本人案件阶段"]'
          : '[aria-label="案件范围与阶段"]',
      );
      const active = nav
        .findAll('a.active')
        .filter(
          (link) => !link.attributes('data-test')?.startsWith('case-view-'),
        );
      expect(active).toHaveLength(1);
      expect(active[0].text()).toBe(label + '27');
      for (const stage of stages) {
        await router.push(
          path + (path.includes('?') ? '&' : '?') + 'stage=' + stage,
        );
        await flushPromises();
        const selected = nav
          .findAll('a.active')
          .filter(
            (link) => !link.attributes('data-test')?.startsWith('case-view-'),
          );
        expect(selected).toHaveLength(1);
        expect(selected[0].text()).toBe(label + '27');
        expect(router.currentRoute.value.query).toHaveProperty('stage', stage);
        expect(router.currentRoute.value.query).not.toHaveProperty(
          'stageGroup',
        );
        if (!path.startsWith('/lawyer'))
          expect(
            wrapper
              .get('[data-test="case-view-department"]')
              .attributes('href'),
          ).toContain('stage=' + stage);
      }
      wrapper.unmount();
    },
  );
});
it('discards stale group counters after range, authorization and user changes', async () => {
  const base = await api.listCases();
  let resolveOld!: (value: unknown) => void;
  api.listCases.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveOld = resolve;
    }),
  );
  const { wrapper, router } = await mountShell(
    '/cases?stageGroup=COMPLAINT_PREPARATION',
  );
  api.listCases.mockResolvedValue({
    ...base,
    counts: {
      ...base.counts,
      WAITING_COMPLAINT: 3,
      WAITING_COMPLAINT_CONFIRMATION: 4,
      WAITING_COMPLAINT_STAMP: 5,
    },
  });
  await router.push('/cases?view=department&stageGroup=COMPLAINT_PREPARATION');
  await flushPromises();
  resolveOld({ ...base, counts: { ...base.counts, WAITING_COMPLAINT: 99 } });
  await flushPromises();
  expect(wrapper.get('[data-test="complaint-preparation-stage"]').text()).toBe(
    '准备起诉文书12',
  );
  api.listCases.mockRejectedValue(
    new ApiError('revoked', 403, 'ACTION_FORBIDDEN'),
  );
  const auth = useAuthStore();
  auth.session = { ...session, authorizationRevision: 2 };
  await flushPromises();
  expect(
    wrapper.find('[data-test="complaint-preparation-stage"]').exists(),
  ).toBe(false);
  expect(wrapper.find('[data-test="case-nav"]').exists()).toBe(false);
  auth.session = { ...session, user: { ...session.user, id: 'user-2' } };
  await flushPromises();
  expect(
    wrapper.find('[data-test="complaint-preparation-stage"]').exists(),
  ).toBe(false);
  expect(wrapper.find('[data-test="case-nav"]').exists()).toBe(false);
});

it('cannot restore internal case navigation with a late response from the revoked identity', async () => {
  const base = await api.listCases();
  const { wrapper, router } = await mountShell('/cases');
  let resolveOld!: (value: unknown) => void;
  api.listCases.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveOld = resolve;
    }),
  );
  await router.push('/cases?view=department');
  await flushPromises();
  const oldSignal = api.listCases.mock.calls.at(-1)![2].signal as AbortSignal;
  api.listCases.mockRejectedValue(
    new ApiError('revoked', 403, 'ACTION_FORBIDDEN'),
  );
  const auth = useAuthStore();
  auth.session = { ...session, authorizationRevision: 2 };
  await flushPromises();
  expect(oldSignal.aborted).toBe(true);
  expect(wrapper.find('[data-test="case-nav"]').exists()).toBe(false);
  resolveOld(base);
  await flushPromises();
  expect(wrapper.find('[data-test="case-nav"]').exists()).toBe(false);
  api.listCases.mockResolvedValue(base);
  auth.session = { ...session, authorizationRevision: 3 };
  await flushPromises();
  expect(wrapper.get('[data-test="case-nav"]').text()).toContain('案件');
});

it('invalidates lawyer group badges on identity change and ignores the old response after revocation', async () => {
  const base = await api.listLawyerCases();
  let resolveOld!: (value: unknown) => void;
  api.listLawyerCases.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveOld = resolve;
    }),
  );
  const { wrapper } = await mountShell(
    '/lawyer/cases?stageGroup=COMPLAINT_PREPARATION',
    lawyerSession,
  );
  api.listLawyerCases.mockResolvedValue({
    ...base,
    counts: { ...base.counts, WAITING_COMPLAINT: 7 },
  });
  const auth = useAuthStore();
  auth.session = {
    ...lawyerSession,
    user: { ...lawyerSession.user, id: 'lawyer-2' },
    authorizationRevision: 2,
  };
  await flushPromises();
  resolveOld({ ...base, counts: { ...base.counts, WAITING_COMPLAINT: 99 } });
  await flushPromises();
  expect(wrapper.get('[data-test="complaint-preparation-stage"]').text()).toBe(
    '准备起诉文书7',
  );
  api.listLawyerCases.mockRejectedValue(
    new ApiError('revoked', 403, 'ACTION_FORBIDDEN'),
  );
  auth.session = { ...auth.session!, authorizationRevision: 3 };
  await flushPromises();
  expect(wrapper.get('[data-test="complaint-preparation-stage"]').text()).toBe(
    '准备起诉文书',
  );
});

describe('settlement center navigation', () => {
  it.each([
    { read: true, feeRead: false },
    { read: false, feeRead: true },
  ])(
    'shows the entry only when the current internal read capability allows it: %j',
    async (capability) => {
      api.getSettlementContext.mockResolvedValue(capability);
      const { wrapper } = await mountShell();
      expect(
        wrapper.get('[data-test="settlement-nav"]').attributes('href'),
      ).toBe('/settlements');
    },
  );
  it('keeps the entry hidden without either read capability', async () => {
    const { wrapper } = await mountShell();
    expect(wrapper.find('[data-test="settlement-nav"]').exists()).toBe(false);
  });
});

describe.each([
  {
    name: 'settlement',
    mock: 'getSettlementContext',
    path: '/settlements',
    success: { read: true, feeRead: false },
  },
  {
    name: 'evidence',
    mock: 'listEvidence',
    path: '/evidence',
    success: {
      items: [],
      total: 0,
      page: 1,
      pageSize: 1,
      counts: {
        allStageCases: 0,
        statuses: {
          ALL: 0,
          UNDELIVERED: 0,
          IN_STOCK: 0,
          MAILED_TO_LAWYER: 0,
          DESTROYED: 0,
        },
        stages: {},
      },
    },
  },
] as const)(
  '$name navigation current read and explicit recovery',
  ({ name, mock, path, success }) => {
    it('shows an authorized read-only empty entry through the real read contract', async () => {
      api[mock].mockResolvedValue(success);
      const { wrapper } = await mountShell();
      expect(wrapper.get(`[data-test="${name}-nav"]`).attributes('href')).toBe(
        path,
      );
      if (name === 'evidence')
        expect(api.listEvidence).toHaveBeenCalledWith(
          { page: 1, pageSize: 1 },
          { signal: expect.any(AbortSignal) },
        );
    });
    it.each([
      new ApiError('server', 500, 'INTERNAL_ERROR'),
      new TypeError('Failed to fetch'),
      new ApiError('timeout', 0, 'TIMEOUT'),
    ])(
      'shows recoverable failure %s and only retries the requested read',
      async (error) => {
        api[mock].mockRejectedValue(error);
        const { wrapper, router } = await mountShell();
        expect(wrapper.find(`[data-test="${name}-nav"]`).exists()).toBe(false);
        expect(wrapper.get(`[data-test="${name}-nav-error"]`).text()).toContain(
          '暂时无法读取',
        );
        expect(api[mock]).toHaveBeenCalledTimes(1);
        await router.push('/customers');
        window.dispatchEvent(new Event(workflowChangedEvent));
        await flushPromises();
        expect(api[mock]).toHaveBeenCalledTimes(1);
        const other =
          name === 'evidence' ? api.getSettlementContext : api.listEvidence;
        const otherCalls = other.mock.calls.length;
        api[mock].mockResolvedValue(success);
        await wrapper.get(`[data-test="${name}-nav-retry"]`).trigger('click');
        await flushPromises();
        expect(api[mock]).toHaveBeenCalledTimes(2);
        expect(other).toHaveBeenCalledTimes(otherCalls);
        expect(
          wrapper.get(`[data-test="${name}-nav"]`).attributes('href'),
        ).toBe(path);
        expect(wrapper.find(`[data-test="${name}-nav-error"]`).exists()).toBe(
          false,
        );
      },
    );
    it('retains known readability on 500 then hides a denied retry and stops further probes', async () => {
      api[mock].mockResolvedValue(success);
      const { wrapper, router } = await mountShell();
      api[mock].mockRejectedValueOnce(
        new ApiError('server', 500, 'INTERNAL_ERROR'),
      );
      await router.push('/customers');
      await flushPromises();
      expect(wrapper.get(`[data-test="${name}-nav"]`).attributes('href')).toBe(
        path,
      );
      expect(wrapper.get(`[data-test="${name}-nav-error"]`).text()).toContain(
        '暂时无法读取',
      );
      api[mock].mockRejectedValue(
        new ApiError('revoked', 403, 'ACTION_FORBIDDEN'),
      );
      await wrapper.get(`[data-test="${name}-nav-retry"]`).trigger('click');
      await flushPromises();
      expect(wrapper.find(`[data-test="${name}-nav"]`).exists()).toBe(false);
      expect(wrapper.find(`[data-test="${name}-nav-error"]`).exists()).toBe(
        false,
      );
      const calls = api[mock].mock.calls.length;
      await router.push('/cases');
      window.dispatchEvent(new Event(workflowChangedEvent));
      await flushPromises();
      expect(api[mock]).toHaveBeenCalledTimes(calls);
      api[mock].mockResolvedValue(success);
      useAuthStore().session = { ...session, authorizationRevision: 2 };
      await flushPromises();
      expect(wrapper.get(`[data-test="${name}-nav"]`).attributes('href')).toBe(
        path,
      );
    });
    it('disables an in-flight explicit retry and prevents duplicate reads', async () => {
      api[mock].mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const { wrapper } = await mountShell();
      let finish!: (value: unknown) => void;
      api[mock].mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      await wrapper.get(`[data-test="${name}-nav-retry"]`).trigger('click');
      await flushPromises();
      expect(
        wrapper.get(`[data-test="${name}-nav-retry"]`).attributes('disabled'),
      ).toBeDefined();
      await wrapper.get(`[data-test="${name}-nav-retry"]`).trigger('click');
      expect(api[mock]).toHaveBeenCalledTimes(2);
      finish(success);
      await flushPromises();
      expect(wrapper.find(`[data-test="${name}-nav-error"]`).exists()).toBe(
        false,
      );
    });
    it('aborts the obsolete read and cannot restore a denied new identity from its late success', async () => {
      let finish!: (value: unknown) => void;
      api[mock].mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const { wrapper } = await mountShell();
      const options = api[mock].mock.calls[0]!.at(-1) as {
        signal: AbortSignal;
      };
      api[mock].mockRejectedValue(
        new ApiError('revoked', 403, 'ACTION_FORBIDDEN'),
      );
      useAuthStore().session = {
        ...session,
        user: { ...session.user, id: 'new-user' },
        department: { id: 'new-department', name: '新部门' },
        authorizationRevision: 2,
      };
      await flushPromises();
      expect(options.signal.aborted).toBe(true);
      finish(success);
      await flushPromises();
      expect(wrapper.find(`[data-test="${name}-nav"]`).exists()).toBe(false);
      expect(wrapper.find(`[data-test="${name}-nav-error"]`).exists()).toBe(
        false,
      );
    });
    it('keeps a new identity recoverable error when an old successful read arrives late', async () => {
      let finish!: (value: unknown) => void;
      api[mock].mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const { wrapper } = await mountShell();
      api[mock].mockRejectedValue(new TypeError('Failed to fetch'));
      useAuthStore().session = { ...session, authorizationRevision: 2 };
      await flushPromises();
      finish(success);
      await flushPromises();
      expect(wrapper.find(`[data-test="${name}-nav"]`).exists()).toBe(false);
      expect(wrapper.get(`[data-test="${name}-nav-error"]`).text()).toContain(
        '暂时无法读取',
      );
    });
    it('ignores a late old 403 after the new identity has succeeded', async () => {
      let fail!: (reason: unknown) => void;
      api[mock].mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
      );
      const { wrapper } = await mountShell();
      api[mock].mockResolvedValue(success);
      useAuthStore().session = { ...session, authorizationRevision: 2 };
      await flushPromises();
      fail(new ApiError('old denied', 403, 'ACTION_FORBIDDEN'));
      await flushPromises();
      expect(wrapper.get(`[data-test="${name}-nav"]`).attributes('href')).toBe(
        path,
      );
      expect(wrapper.find(`[data-test="${name}-nav-error"]`).exists()).toBe(
        false,
      );
    });
    it.each(['CLIENT', 'LAWYER', 'NOTARY'] as const)(
      'never probes the internal read for a %s principal',
      async (principalType) => {
        api[mock].mockResolvedValue(success);
        const { wrapper } = await mountShell('/leads', {
          ...session,
          principalType,
        });
        expect(api[mock]).not.toHaveBeenCalled();
        expect(wrapper.find(`[data-test="${name}-nav"]`).exists()).toBe(false);
        expect(wrapper.find(`[data-test="${name}-nav-error"]`).exists()).toBe(
          false,
        );
      },
    );
  },
);
