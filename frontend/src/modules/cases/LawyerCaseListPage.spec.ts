import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import type { LawyerCaseList, LawyerCaseSummary } from '../../api/cases';
import { useAuthStore } from '../../stores/auth';
import LawyerCaseListPage from './LawyerCaseListPage.vue';

const api = vi.hoisted(() => ({ listLawyerCases: vi.fn() }));
vi.mock('../../api/cases', () => ({ listLawyerCases: api.listLawyerCases }));

const emptyResult: LawyerCaseList = {
  items: [
    {
      id: 'case-1',
      businessNo: 'CA-44',
      stage: 'WAITING_FILING',
      version: 7,
      canMatch: false,
      canSubmitExecution: false,
      canConfirmExecution: false,
      canSubmitComplaint: false,
      canConfirmComplaint: false,
      canMailComplaint: false,
      canMailExecution: false,
      canSubmitExecutionFiling: false,
      canFinishExecution: false,
      canRecordClosure: false,
      canCorrectClosure: false,
      canSubmitFiling: true,
      canRegisterAcceptance: false,
      canUploadAcceptanceMaterials: false,
      canScheduleHearing: false,
      canCorrectHearing: false,
      canRegisterJudgment: false,
      canCorrectJudgment: false,
      canChooseJudgmentNextStep: false,
      canRevokeJudgmentNextStep: false,
      canSaveSecondInstance: false,
      canRegisterSecondInstanceResult: false,
      canRevokeSecondInstanceResult: false,
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
    WAITING_EXECUTION_CONFIRMATION: 0,
    WAITING_EXECUTION_STAMP: 0,
    WAITING_EXECUTION_FILING: 0,
    EXECUTING: 0,
    WAITING_ARCHIVE: 0,
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
  it('renders only the three available columns and keeps the complete encoded case link', async () => {
    api.listLawyerCases.mockResolvedValue({
      ...emptyResult,
      items: [
        {
          ...emptyResult.items[0],
          id: 'case/encoded',
          businessNo: 'CA-20261013-00001234',
        },
      ],
    });
    const { wrapper } = await mountPage();
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual([
      '操作／案件编号',
      '案件进展',
      '办理权限',
    ]);
    expect(
      wrapper
        .findAll('thead th')
        .every((cell) => cell.attributes('scope') === 'col'),
    ).toBe(true);
    expect(wrapper.findAll('colgroup col')).toHaveLength(3);
    expect(wrapper.findAll('tbody tr td')).toHaveLength(3);
    expect(wrapper.get('tbody a').text()).toBe('CA-20261013-00001234');
    expect(wrapper.get('tbody a').attributes('href')).toBe(
      '/lawyer/cases/case%2Fencoded',
    );
    expect(wrapper.get('.business-list-scroll').attributes()).toMatchObject({
      role: 'region',
      tabindex: '0',
      'aria-label': '本人承办案件列表，可横向滚动',
    });
    expect(wrapper.text()).not.toContain('负责人');
    expect(wrapper.text()).not.toContain('来源线索');
    wrapper.unmount();
  });

  it.each([
    'canSubmitExecution',
    'canConfirmExecution',
    'canMailExecution',
    'canSubmitExecutionFiling',
    'canFinishExecution',
    'canRecordClosure',
    'canSubmitComplaint',
    'canConfirmComplaint',
    'canMailComplaint',
    'canSubmitFiling',
    'canRegisterAcceptance',
    'canUploadAcceptanceMaterials',
    'canScheduleHearing',
    'canRegisterJudgment',
    'canChooseJudgmentNextStep',
    'canSaveSecondInstance',
    'canRegisterSecondInstanceResult',
  ] as const satisfies readonly (keyof LawyerCaseSummary)[])(
    'shows handling when only %s is authorized',
    async (capability) => {
      const base = emptyResult.items[0]!;
      const denied = Object.fromEntries(
        Object.keys(base)
          .filter((key) => key.startsWith('can'))
          .map((key) => [key, false]),
      );
      api.listLawyerCases.mockResolvedValue({
        ...emptyResult,
        items: [
          { ...base, ...denied, [capability]: true },
          { ...base, ...denied, id: 'readonly-case' },
        ],
      });
      const { wrapper } = await mountPage();
      const rows = wrapper.findAll('tbody tr');
      expect(rows[0]!.findAll('td')[2]!.text()).toBe('可办理');
      expect(rows[1]!.findAll('td')[2]!.text()).toBe('只读');
      wrapper.unmount();
    },
  );

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

  it('loads the execution preparation group without a single-stage filter', async () => {
    const { wrapper, router } = await mountPage();
    await router.push('/lawyer/cases?stageGroup=EXECUTION_PREPARATION');
    await flushPromises();
    expect(api.listLawyerCases).toHaveBeenLastCalledWith(
      1,
      20,
      undefined,
      expect.objectContaining({
        stageGroup: 'EXECUTION_PREPARATION',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(wrapper.get('.page-head').text()).toContain('准备执行文书');
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

  it('parses and labels execution confirmation with the execution action badge', async () => {
    const { wrapper, router } = await mountPage();
    api.listLawyerCases.mockResolvedValueOnce({
      ...emptyResult,
      items: [
        {
          ...emptyResult.items[0],
          id: 'execution-actionable',
          stage: 'WAITING_EXECUTION_CONFIRMATION',
          canConfirmExecution: true,
        },
        {
          ...emptyResult.items[0],
          id: 'execution-readonly',
          stage: 'WAITING_EXECUTION_CONFIRMATION',
          canSubmitExecution: false,
          canConfirmExecution: false,
          canSubmitFiling: false,
        },
      ],
    });
    await router.push('/lawyer/cases?stage=WAITING_EXECUTION_CONFIRMATION');
    await flushPromises();

    expect(api.listLawyerCases).toHaveBeenLastCalledWith(
      1,
      20,
      'WAITING_EXECUTION_CONFIRMATION',
      { signal: expect.any(AbortSignal) },
    );
    expect(wrapper.get('.page-head').text()).toContain('执行材料待确认');
    const rows = wrapper.findAll('[data-test="lawyer-case-list"] tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain('执行材料待确认');
    expect(rows[0]!.text()).toContain('可办理');
    expect(rows[1]!.text()).toContain('只读');
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

it('offers WAITING_ARCHIVE in the lawyer route filter and keeps a finished case read-only', async () => {
  api.listLawyerCases.mockResolvedValue({
    ...emptyResult,
    items: [
      {
        ...emptyResult.items[0],
        stage: 'WAITING_ARCHIVE',
        canFinishExecution: false,
        canRecordClosure: false,
        canCorrectClosure: false,
        canSubmitFiling: false,
      },
    ],
    counts: { ...emptyResult.counts, WAITING_ARCHIVE: 1 },
  });
  const { wrapper, router } = await mountPage();
  await router.push('/lawyer/cases?stage=WAITING_ARCHIVE');
  await flushPromises();
  expect(api.listLawyerCases).toHaveBeenLastCalledWith(
    1,
    20,
    'WAITING_ARCHIVE',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(wrapper.text()).toContain('待归档');
  expect(wrapper.get('tbody tr').findAll('td')[2]!.text()).toBe('只读');
  wrapper.unmount();
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
] as const)('%s lawyer list', (group, label, stages) => {
  it('keeps all three atom labels and exact legacy bookmarks', async () => {
    api.listLawyerCases.mockResolvedValue({
      ...emptyResult,
      items: stages.map((stage, index) => ({
        ...emptyResult.items[0],
        id: 'case-' + index,
        stage,
      })),
    });
    const { wrapper, router } = await mountPage();
    await router.push('/lawyer/cases?stageGroup=' + group);
    await flushPromises();
    expect(api.listLawyerCases).toHaveBeenLastCalledWith(
      1,
      20,
      undefined,
      expect.objectContaining({ stageGroup: group }),
    );
    expect(wrapper.get('.page-head').text()).toContain(label);
    expect(
      wrapper
        .findAll('[data-test="lawyer-case-list"] .pill')
        .map((pill) => pill.text()),
    ).toEqual(
      expect.arrayContaining(
        group === 'COMPLAINT_PREPARATION'
          ? ['待写诉状', '诉状待确认', '诉状待盖章']
          : ['待写执行材料', '执行材料待确认', '执行材料待盖章'],
      ),
    );
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '刷新')!
      .trigger('click');
    await flushPromises();
    for (const stage of stages) {
      await router.push('/lawyer/cases?stage=' + stage);
      await flushPromises();
      expect(api.listLawyerCases).toHaveBeenLastCalledWith(1, 20, stage, {
        signal: expect.any(AbortSignal),
      });
    }
    router.back();
    await flushPromises();
    expect(api.listLawyerCases.mock.calls.at(-1)?.[2]).toBe(stages[1]);
    wrapper.unmount();
  });
  it('returns to page one and discards old page data after switching group or identity', async () => {
    let resolveOld!: (value: typeof emptyResult) => void;
    api.listLawyerCases.mockResolvedValue({ ...emptyResult, total: 21 });
    const { wrapper, router } = await mountPage();
    await router.push('/lawyer/cases?stageGroup=' + group);
    await flushPromises();
    api.listLawyerCases.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '下一页')!
      .trigger('click');
    await flushPromises();
    const other =
      group === 'COMPLAINT_PREPARATION'
        ? 'EXECUTION_PREPARATION'
        : 'COMPLAINT_PREPARATION';
    await router.push('/lawyer/cases?stageGroup=' + other);
    await flushPromises();
    expect(api.listLawyerCases).toHaveBeenLastCalledWith(
      1,
      20,
      undefined,
      expect.objectContaining({ stageGroup: other }),
    );
    const auth = useAuthStore();
    api.listLawyerCases.mockRejectedValue(
      new ApiError('revoked', 403, 'ACTION_FORBIDDEN'),
    );
    auth.session = { ...auth.session!, authorizationRevision: 4 };
    await flushPromises();
    resolveOld({
      ...emptyResult,
      items: [{ ...emptyResult.items[0], businessNo: 'CA-late' }],
    });
    await flushPromises();
    expect(wrapper.text()).not.toContain('CA-late');
    expect(wrapper.text()).toContain('当前账号已不能读取这些案件');
    expect(wrapper.find('[data-test="lawyer-case-list"]').exists()).toBe(false);
    api.listLawyerCases.mockResolvedValue({
      ...emptyResult,
      items: [{ ...emptyResult.items[0], businessNo: 'CA-user-2' }],
    });
    auth.session = {
      ...auth.session!,
      user: { ...auth.session!.user, id: 'lawyer-2' },
    };
    await flushPromises();
    expect(wrapper.text()).toContain('CA-user-2');
    wrapper.unmount();
  });
});
it('canonicalizes mixed filters to the precise stage and removes the group', async () => {
  const { wrapper, router } = await mountPage();
  await router.push(
    '/lawyer/cases?stage=WAITING_COMPLAINT&stageGroup=COMPLAINT_PREPARATION',
  );
  await flushPromises();
  expect(api.listLawyerCases).toHaveBeenLastCalledWith(
    1,
    20,
    'WAITING_COMPLAINT',
    expect.not.objectContaining({ stageGroup: 'COMPLAINT_PREPARATION' }),
  );
  expect(router.currentRoute.value.query.stageGroup).toBeUndefined();
  expect(router.currentRoute.value.query.stage).toBe('WAITING_COMPLAINT');
  wrapper.unmount();
});
it.each([
  'stage=UNKNOWN',
  'stageGroup=UNKNOWN',
  'stage=WAITING_COMPLAINT&stageGroup=UNKNOWN',
  'stage=UNKNOWN&stageGroup=COMPLAINT_PREPARATION',
  'stage=WAITING_COMPLAINT&stage=EXECUTING',
  'stageGroup=COMPLAINT_PREPARATION&stageGroup=EXECUTION_PREPARATION',
])(
  'rejects invalid %s and cancels stale data until explicit clearing',
  async (query) => {
    const { wrapper, router } = await mountPage();
    api.listLawyerCases.mockClear();
    await router.push('/lawyer/cases?' + query);
    await flushPromises();
    expect(api.listLawyerCases).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('阶段筛选无效');
    expect(wrapper.find('[data-test="lawyer-case-list"]').exists()).toBe(false);
    await router.push('/lawyer/cases');
    await flushPromises();
    expect(api.listLawyerCases).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  },
);
