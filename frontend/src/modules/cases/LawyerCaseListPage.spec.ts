import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/auth';
import LawyerCaseListPage from './LawyerCaseListPage.vue';

const api = vi.hoisted(() => ({ listLawyerCases: vi.fn() }));
vi.mock('../../api/cases', () => ({ listLawyerCases: api.listLawyerCases }));

const emptyResult = {
  items: [
    {
      id: 'case-1',
      businessNo: 'CA-44',
      stage: 'WAITING_FILING',
      version: 7,
      canMatch: false,
      canSubmitComplaint: false,
      canConfirmComplaint: false,
      canMailComplaint: false,
      canSubmitFiling: true,
      createdAt: '2026-10-01T00:00:00Z',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
  counts: {
    PENDING_MATCH: 0,
    WAITING_COMPLAINT: 0,
    WAITING_COMPLAINT_CONFIRMATION: 0,
    WAITING_COMPLAINT_STAMP: 0,
    WAITING_FILING: 1,
    WAITING_FORMAL_ACCEPTANCE: 0,
  },
};

async function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore(pinia).session = {
    principalType: 'LAWYER',
    user: { id: 'lawyer-1', displayName: '律师甲', username: 'lawyer.a' },
    department: null,
    departments: [],
    customer: null,
    notaryOffice: null,
    authorizationRevision: 3,
    expiresAt: '2026-10-06T00:00:00Z',
    csrfToken: 'csrf',
  };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/lawyer/cases', component: LawyerCaseListPage }],
  });
  await router.push('/lawyer/cases');
  await router.isReady();
  const wrapper = mount(LawyerCaseListPage, {
    global: { plugins: [pinia, router] },
  });
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.listLawyerCases.mockResolvedValue(emptyResult);
});

describe('LawyerCaseListPage', () => {
  it('loads the本人 queue and does not offer department scope', async () => {
    const { wrapper } = await mountPage();
    expect(api.listLawyerCases).toHaveBeenCalledWith(1, 20, undefined, {
      signal: expect.any(AbortSignal),
    });
    expect(wrapper.text()).toContain('CA-44');
    expect(wrapper.text()).toContain('待提交立案');
    expect(wrapper.text()).not.toContain('本部门全部');
    expect(wrapper.get('a').attributes('href')).toBe('/lawyer/cases/case-1');
  });
});
