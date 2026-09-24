import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '../api/auth';
import { useAuthStore } from '../stores/auth';
import AppShell from './AppShell.vue';

const api = vi.hoisted(() => ({
  getOrganizationManagementContext: vi.fn(),
  listLeads: vi.fn(),
  listNotaryOffices: vi.fn(),
}));

vi.mock('../api/organization', () => ({
  getOrganizationManagementContext: api.getOrganizationManagementContext,
}));
vi.mock('../api/leads', () => ({ listLeads: api.listLeads }));
vi.mock('../api/notary', () => ({ listNotaryOffices: api.listNotaryOffices }));

const session = {
  principalType: 'INTERNAL' as const,
  user: { id: 'user-1', displayName: '管理员', username: 'admin' },
  department: { id: 'department-1', name: '知产部' },
  departments: [{ id: 'department-1', name: '知产部' }],
  customer: null,
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
  await flushPromises();
  return { wrapper, router };
}

describe('AppShell', () => {
  it('renders authorized navigation and route breadcrumbs', async () => {
    const { wrapper } = await mountShell();

    expect(wrapper.get('[data-test="app-shell"]')).toBeDefined();
    expect(wrapper.get('[data-test="lead-nav"]').classes()).toContain('active');
    expect(wrapper.get('[data-test="breadcrumbs"]').text()).toContain('线索');
    expect(wrapper.get('[data-test="people-access-nav"]')).toBeDefined();
    expect(wrapper.get('[data-test="notary-offices-nav"]')).toBeDefined();
    expect(wrapper.get('[data-test="page-content"]').text()).toBe('页面内容');
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

    expect(counters).toHaveLength(5);
    expect(counters.map((item) => item.text())).toEqual([
      '待推送7',
      '线索待审核3',
      '线索待确认2',
      '已移交公证0',
      '线索已归档1',
    ]);
    expect(counters[0]!.attributes('href')).toContain('status=WAITING_PUSH');
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
    expect(wrapper.text()).not.toContain('待审核线索');
    expect(wrapper.find('[data-test="lead-nav"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="customer-nav"]').exists()).toBe(false);
  });
});
