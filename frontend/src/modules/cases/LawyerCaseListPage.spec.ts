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
      canRegisterAcceptance: false,
      canUploadAcceptanceMaterials: false,
      canScheduleHearing: false,
      canCorrectHearing: false,
      canRegisterJudgment: false,
      canCorrectJudgment: false,
      canChooseJudgmentNextStep: false,
      canRevokeJudgmentNextStep: false,
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
    WAITING_HEARING: 0,
    WAITING_JUDGMENT: 0,
    SECOND_INSTANCE: 0,
    WAITING_EXECUTION_DOCUMENTS: 0,
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

  it('requests and displays the second server page and disables boundary controls', async () => {
    const firstPageItems = Array.from({ length: 20 }, (_, index) => ({
      ...emptyResult.items[0],
      id: `case-${index + 1}`,
      businessNo: `CA-${index + 1}`,
    }));
    const case21 = {
      ...emptyResult.items[0],
      id: 'case-21',
      businessNo: 'CA-21',
    };
    api.listLawyerCases
      .mockResolvedValueOnce({
        ...emptyResult,
        items: firstPageItems,
        total: 21,
        page: 1,
        pageSize: 20,
      })
      .mockResolvedValueOnce({
        ...emptyResult,
        items: [case21],
        total: 21,
        page: 2,
        pageSize: 20,
      });
    const { wrapper } = await mountPage();
    const previous = wrapper
      .findAll('button')
      .find((button) => button.text() === '上一页')!;
    const next = wrapper
      .findAll('button')
      .find((button) => button.text() === '下一页')!;
    expect(previous).toBeDefined();
    expect(next).toBeDefined();
    expect(previous.attributes('disabled')).toBeDefined();
    await next.trigger('click');
    await flushPromises();
    expect(api.listLawyerCases).toHaveBeenLastCalledWith(2, 20, undefined, {
      signal: expect.any(AbortSignal),
    });
    expect(wrapper.text()).toContain('CA-21');
    const pageButtons = wrapper.findAll('button');
    expect(
      pageButtons
        .find((button) => button.text() === '上一页')
        ?.attributes('disabled'),
    ).toBeUndefined();
    expect(
      pageButtons
        .find((button) => button.text() === '下一页')
        ?.attributes('disabled'),
    ).toBeDefined();
  });

  it('supports the single WAITING_HEARING filter and label', async () => {
    const { wrapper, router } = await mountPage();
    await router.push('/lawyer/cases?stage=WAITING_HEARING');
    await flushPromises();
    expect(api.listLawyerCases).toHaveBeenLastCalledWith(
      1,
      20,
      'WAITING_HEARING',
      { signal: expect.any(AbortSignal) },
    );
    expect(wrapper.text()).toContain('待开庭');
  });

  it('supports the single WAITING_JUDGMENT filter and label', async () => {
    const { wrapper, router } = await mountPage();
    await router.push('/lawyer/cases?stage=WAITING_JUDGMENT');
    await flushPromises();

    expect(api.listLawyerCases).toHaveBeenLastCalledWith(
      1,
      20,
      'WAITING_JUDGMENT',
      expect.any(Object),
    );
    expect(wrapper.text()).toContain('待判决');
  });

  it('supports both CA-009 stages and their labels', async () => {
    for (const [stage, label] of [
      ['SECOND_INSTANCE', '二审'],
      ['WAITING_EXECUTION_DOCUMENTS', '待写执行材料'],
    ] as const) {
      api.listLawyerCases.mockResolvedValueOnce({
        ...emptyResult,
        items: [{ ...emptyResult.items[0], stage }],
      });
      const { wrapper, router } = await mountPage();
      await router.push(`/lawyer/cases?stage=${stage}`);
      await flushPromises();
      expect(wrapper.text()).toContain(label);
    }
  });

  it('resets to page one on stage change and ignores a late page response', async () => {
    let resolveOldPage!: (result: typeof emptyResult) => void;
    const oldPageRequest = new Promise<typeof emptyResult>((resolve) => {
      resolveOldPage = resolve;
    });
    const firstPage = {
      ...emptyResult,
      total: 21,
      page: 1,
      pageSize: 20,
    };
    const currentStage = {
      ...emptyResult,
      items: [
        {
          ...emptyResult.items[0],
          id: 'case-current',
          businessNo: 'CA-current',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    };
    api.listLawyerCases.mockImplementation(
      (page: number, _pageSize: number, stage?: string) => {
        if (page === 2) return oldPageRequest;
        if (stage === 'WAITING_FILING') return Promise.resolve(currentStage);
        return Promise.resolve(firstPage);
      },
    );
    const { wrapper, router } = await mountPage();
    const next = wrapper
      .findAll('button')
      .find((button) => button.text() === '下一页')!;
    expect(next).toBeDefined();
    await next.trigger('click');
    await flushPromises();
    await router.push('/lawyer/cases?stage=WAITING_FILING');
    await flushPromises();
    expect(api.listLawyerCases).toHaveBeenLastCalledWith(
      1,
      20,
      'WAITING_FILING',
      { signal: expect.any(AbortSignal) },
    );
    expect(wrapper.text()).toContain('CA-current');
    resolveOldPage({
      ...emptyResult,
      items: [{ ...emptyResult.items[0], id: 'late', businessNo: 'CA-late' }],
    });
    await flushPromises();
    expect(wrapper.text()).toContain('CA-current');
    expect(wrapper.text()).not.toContain('CA-late');
  });
});
