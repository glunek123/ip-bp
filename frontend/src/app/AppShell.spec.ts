import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '../api/auth';
import { useAuthStore } from '../stores/auth';
import AppShell from './AppShell.vue';

const api = vi.hoisted(() => ({
  getOrganizationManagementContext: vi.fn(),
  listLeads: vi.fn(),
  listNotaryOffices: vi.fn(),
  listNotaryMatters: vi.fn(),
}));
const mountedShells: Array<ReturnType<typeof mount>> = [];

vi.mock('../api/organization', () => ({
  getOrganizationManagementContext: api.getOrganizationManagementContext,
}));
vi.mock('../api/leads', () => ({ listLeads: api.listLeads }));
vi.mock('../api/notary', () => ({
  listNotaryOffices: api.listNotaryOffices,
  listNotaryMatters: api.listNotaryMatters,
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
  api.getOrganizationManagementContext.mockResolvedValue({});
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
        path: '/customers',
        component: { template: '<div />' },
        meta: { section: '客户', breadcrumbs: ['客户'] },
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
      '待开箱事项',
    );
    expect(wrapper.find('[data-test="lead-nav"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="notary-nav"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="customer-nav"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="settings-expand"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('南方公证处');
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

  it('does not show the matter group when its scoped list is forbidden', async () => {
    api.listNotaryMatters.mockRejectedValueOnce(new Error('forbidden'));
    const { wrapper } = await mountShell();
    expect(wrapper.find('[data-test="notary-nav"]').exists()).toBe(false);
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
