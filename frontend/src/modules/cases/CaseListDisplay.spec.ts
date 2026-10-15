import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '../../api/auth';
import type { CaseList, CaseSummary } from '../../api/cases';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import CaseListPage from './CaseListPage.vue';

const api = vi.hoisted(() => ({
  getCase: vi.fn(),
  listCases: vi.fn<typeof import('../../api/cases').listCases>(),
  getExternalEntryOptions:
    vi.fn<typeof import('../../api/cases').getExternalEntryOptions>(),
}));
vi.mock('../../api/cases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/cases')>()),
  listCases: api.listCases,
  getCase: api.getCase,
  getExternalEntryOptions: api.getExternalEntryOptions,
}));
vi.mock('./CaseListWorkflowPanel.vue', () => ({
  default: {
    props: ['item', 'action'],
    template:
      '<div data-test="workflow-panel">{{ item.id }} {{ action }}</div>',
  },
}));
const sourceIds = {
  confirmation: '91000000-0000-4000-8000-000000000001',
  judgment: '91000000-0000-4000-8000-000000000002',
  closure: '91000000-0000-4000-8000-000000000003',
  submitted: '91000000-0000-4000-8000-000000000004',
  changed: '91000000-0000-4000-8000-000000000005',
  correction: '91000000-0000-4000-8000-000000000006',
};

function summary(): CaseSummary {
  return {
    id: 'case-1',
    businessNo: 'CA-20261013-00001234',
    stage: 'WAITING_ARCHIVE',
    createdAt: '2026-10-13T00:00:00Z',
    version: 15,
    owner: { id: 'owner-1', displayName: '负责运营甲' },
    sourceLead: { id: 'lead-1', businessNo: 'LD-20261013-00005678' },
    sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-20261013-00009012' },
    canMatch: false,
    canSubmitComplaint: false,
    canConfirmComplaint: false,
    canMailComplaint: false,
    canSubmitFiling: false,
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
    canSubmitExecution: false,
    canConfirmExecution: false,
    canMailExecution: false,
    canSubmitExecutionFiling: false,
    canFinishExecution: false,
    canRecordClosure: false,
    canCorrectClosure: false,
    canArchive: false,
    canCorrectArchive: false,
    displaySummary: {
      customerName: '合成客户甲有限公司',
      rightsHolderName: '合成权利主体乙有限公司',
      source: {
        platform: 'TAOBAO',
        shopName: '合成店铺甲（跨区域经营的完整名称）',
        shopExternalId: 'TB-0000123456789',
      },
      defendants: [
        { id: 'defendant-1', name: '合成被告甲有限公司' },
        { id: 'defendant-2', name: '合成被告乙' },
      ],
      lawyers: [
        { id: 'lawyer-1', fullName: '合成律师甲' },
        { id: 'lawyer-2', fullName: '合成律师乙' },
      ],
      court: { id: 'court-1', name: '合成人民法院' },
      courtCaseNo: '（2026）合成民初000123号',
      claimAmount: {
        state: 'KNOWN',
        amount: '99999999999999.99',
        sourceType: 'COMPLAINT_CONFIRMATION',
        sourceId: sourceIds.confirmation,
      },
      judgmentAmount: {
        state: 'PENDING',
        amount: null,
        sourceType: 'FIRST_INSTANCE_JUDGMENT',
        sourceId: sourceIds.judgment,
      },
      closureAmount: {
        state: 'KNOWN',
        amount: '0.00',
        sourceType: 'CASE_CLOSURE_VERSION',
        sourceId: sourceIds.closure,
      },
    },
  };
}

function result(items = [summary()]): CaseList {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
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
      WAITING_ARCHIVE: items.filter((item) => item.stage === 'WAITING_ARCHIVE')
        .length,
      ARCHIVED: items.filter((item) => item.stage === 'ARCHIVED').length,
    },
  };
}

const session: AuthSession = {
  principalType: 'INTERNAL',
  user: {
    id: 'owner-1',
    username: 'synthetic-owner',
    displayName: '负责运营甲',
  },
  department: { id: 'department-1', name: '合成知产部' },
  departments: [{ id: 'department-1', name: '合成知产部' }],
  customer: null,
  notaryOffice: null,
  authorizationRevision: 1,
  expiresAt: '2099-01-01T00:00:00Z',
  csrfToken: 'synthetic-csrf',
};
const wrappers: ReturnType<typeof mount>[] = [];

async function mountList(
  path = '/cases?view=department&stage=WAITING_ARCHIVE',
) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore(pinia);
  auth.session = structuredClone(session);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/cases', component: CaseListPage },
      { path: '/cases/:id', component: { template: '<p>详情</p>' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(CaseListPage, { global: { plugins: [pinia, router] } });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router, auth };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getCase.mockResolvedValue({ id: 'case-1' });
  api.listCases.mockResolvedValue(result());
  api.getExternalEntryOptions.mockResolvedValue({
    canCreate: false,
    canCreateArchived: false,
    currentUser: { id: 'user-1', displayName: '运营' },
    customers: [],
    lawyers: [],
    dictionaries: {
      stages: [],
      courts: [],
      platforms: [],
      caseTypes: [],
      infringementTypes: [],
    },
  });
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
});

describe('authorized internal case list display', () => {
  it('labels corrected judgment and closure amount sources without changing their values', async () => {
    const item = summary();
    item.displaySummary.judgmentAmount = {
      state: 'KNOWN',
      amount: '15.00',
      sourceType: 'FIRST_INSTANCE_JUDGMENT_RECORD_CORRECTION',
      sourceId: sourceIds.correction,
    };
    item.displaySummary.closureAmount = {
      state: 'PENDING',
      amount: null,
      sourceType: 'CASE_CLOSURE_RECORD_CORRECTION',
      sourceId: sourceIds.changed,
    };
    api.listCases.mockResolvedValue(result([item]));
    const { wrapper } = await mountList();
    const text = wrapper.get('tbody tr').text();
    expect(text).toContain('判决资料更正');
    expect(text).toContain('结案资料更正');
    expect(text).toContain('15.00');
    expect(text).toContain('待定');
    expect(text).not.toContain('未登记');
  });
  it('opens an explicit judgment action in place and preserves list context', async () => {
    const item: CaseSummary = {
      ...summary(),
      stage: 'WAITING_JUDGMENT',
      canCorrectJudgment: true,
      canChooseJudgmentNextStep: true,
    };
    api.listCases.mockResolvedValue({ ...result([item]), page: 2, total: 21 });
    const { wrapper, router } = await mountList(
      '/cases?view=department&stage=WAITING_JUDGMENT&page=2&action=jump-stage',
    );
    const row = wrapper.get('tbody tr');
    expect(
      row.findAll('[data-case-action]').map((button) => button.text()),
    ).toEqual(['选择判决后续流程', '更正判决']);
    expect(row.get('a').attributes('href')).toBe(
      '/cases/case-1?view=department&stage=WAITING_JUDGMENT&page=2',
    );
    await row.get('[data-case-action="choose-next-step"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/cases');
    expect(router.currentRoute.value.query).toEqual({
      view: 'department',
      stage: 'WAITING_JUDGMENT',
      page: '2',
      action: 'jump-stage',
    });
    expect(api.getCase).toHaveBeenCalledWith('case-1', {
      signal: expect.any(AbortSignal),
    });
    expect(document.body.textContent).toContain('选择判决后续流程');
  });

  it('ignores repeated clicks while the selected action detail is loading', async () => {
    api.listCases.mockResolvedValue(
      result([{ ...summary(), canArchive: true }]),
    );
    let finish!: (value: { id: string }) => void;
    const loading = new Promise<{ id: string }>((resolve) => {
      finish = resolve;
    });
    api.getCase.mockReturnValueOnce(loading);
    const { wrapper, router } = await mountList();
    const action = wrapper.get('[data-case-action="archive"]');
    await action.trigger('click');
    await action.trigger('click');
    expect(api.getCase).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.path).toBe('/cases');
    finish({ id: 'case-1' });
    await flushPromises();
  });

  it('reads ARCHIVED through the fixed API, preserving the 14-column projection and source amounts', async () => {
    const actual =
      await vi.importActual<typeof import('../../api/cases')>(
        '../../api/cases',
      );
    const item: CaseSummary = { ...summary(), stage: 'ARCHIVED', version: 16 };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(result([item])), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    api.listCases.mockImplementation(actual.listCases);
    const { wrapper } = await mountList(
      '/cases?view=department&stage=ARCHIVED',
    );
    const caseRequest = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/v1/cases?'),
    );
    const url = new URL(String(caseRequest?.[0]), 'http://localhost');
    expect(url.searchParams.get('stage')).toBe('ARCHIVED');
    expect(url.searchParams.get('view')).toBe('department');
    expect(wrapper.findAll('thead th')).toHaveLength(14);
    expect(wrapper.get('tbody').text()).toContain('已归档');
    expect(wrapper.get('tbody').text()).toContain(sourceIds.closure);
    expect(wrapper.get('tbody').text()).toContain('0.00');
    expect(wrapper.get('tbody a').attributes('href')).toBe(
      '/cases/case-1?view=department&stage=ARCHIVED',
    );
    for (const text of ['已结清', '已结算', '归档原因', '确认归档'])
      expect(wrapper.text()).not.toContain(text);
  });

  it('preserves archived scope and bookmark across 21-row pagination and removes a competing stage group', async () => {
    const item: CaseSummary = { ...summary(), stage: 'ARCHIVED', version: 16 };
    const archivedItems = Array.from({ length: 21 }, (_, index) => ({
      ...item,
      id: 'archived-' + (index + 1),
      businessNo: 'CA-ARCHIVED-' + (index + 1),
    }));
    api.listCases.mockImplementation(async (page = 1, pageSize = 20) => ({
      ...result(archivedItems),
      page,
      pageSize,
      items: archivedItems.slice((page - 1) * pageSize, page * pageSize),
    }));
    const { wrapper, router } = await mountList(
      '/cases?view=department&stage=ARCHIVED&stageGroup=COMPLAINT_PREPARATION&page=2',
    );
    expect(router.currentRoute.value.query).toEqual({
      view: 'department',
      stage: 'ARCHIVED',
      page: '2',
    });
    expect(api.listCases).toHaveBeenLastCalledWith(
      2,
      20,
      expect.objectContaining({ view: 'department', stage: 'ARCHIVED' }),
    );
    expect(api.listCases.mock.calls.every((call) => !call[2]?.stageGroup)).toBe(
      true,
    );
    expect(wrapper.get('tbody a').attributes('href')).toContain(
      'stage=ARCHIVED&page=2',
    );
    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    expect(wrapper.get('tbody a').text()).toBe('CA-ARCHIVED-21');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '上一页')!
      .trigger('click');
    await flushPromises();
    expect(api.listCases).toHaveBeenLastCalledWith(
      1,
      20,
      expect.objectContaining({ view: 'department', stage: 'ARCHIVED' }),
    );
    expect(router.currentRoute.value.query).toEqual({
      view: 'department',
      stage: 'ARCHIVED',
      page: '1',
    });
    expect(wrapper.findAll('tbody tr')).toHaveLength(20);
  });

  it('renders the real strict API projection with the frozen typed fixture', async () => {
    const actual =
      await vi.importActual<typeof import('../../api/cases')>(
        '../../api/cases',
      );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(result()), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    api.listCases.mockImplementation(actual.listCases);
    const { wrapper } = await mountList();
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('/api/v1/cases?'),
      ),
    ).toBe(true);
    expect(wrapper.get('tbody').text()).toContain('合成客户甲有限公司');
    expect(wrapper.get('tbody').text()).toContain('99999999999999.99');
    expect(wrapper.get('tbody').text()).toContain(sourceIds.closure);
  });

  it('rejects a known amount with missing money through the real API instead of displaying unrecorded', async () => {
    const actual =
      await vi.importActual<typeof import('../../api/cases')>(
        '../../api/cases',
      );
    const item = summary();
    const invalidItem = {
      ...item,
      displaySummary: {
        ...item.displaySummary,
        closureAmount: { ...item.displaySummary.closureAmount, amount: null },
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ...result(), items: [invalidItem] }), {
          status: 200,
        }),
      ),
    );
    api.listCases.mockImplementation(actual.listCases);
    const { wrapper } = await mountList();
    expect(wrapper.get('[role="alert"]').text()).toContain(
      '案件列表暂时无法加载',
    );
    expect(wrapper.find('tbody').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('合成客户甲有限公司');
  });

  it('renders the frozen column order and exact business fields without selection controls', async () => {
    const { wrapper } = await mountList();
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual([
      '操作／案件编号',
      '案件进展',
      '客户',
      '权利主体',
      '平台',
      '店铺',
      '店铺ID',
      '被告',
      '律师',
      '法院',
      '案号',
      '标的额',
      '判决额',
      '结案额',
    ]);
    const cells = wrapper.findAll('tbody td');
    expect(cells[2]!.get('summary').text()).toBe('合成客户甲有限公司');
    expect(cells[3]!.get('summary').text()).toBe('合成权利主体乙有限公司');
    expect(cells[4]!.text()).toBe('淘宝');
    expect(cells[5]!.get('summary').text()).toBe(
      summary().displaySummary.source.shopName,
    );
    expect(cells[6]!.text()).toBe('TB-0000123456789');
    expect(cells[9]!.get('summary').text()).toBe('合成人民法院');
    expect(cells[10]!.text()).toBe('（2026）合成民初000123号');
    expect(cells[0]!.get('a').attributes('href')).toBe(
      '/cases/case-1?view=department&stage=WAITING_ARCHIVE',
    );
    expect(cells[0]!.text()).toContain('LD-20261013-00005678');
    expect(cells[0]!.text()).toContain('NZ-20261013-00009012');
    expect(cells[0]!.text()).toContain('当前无可办操作');
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/批量|已结清|未结清|实收额/);
  });

  it('keeps every defendant and lawyer in native keyboard-expandable details', async () => {
    const { wrapper } = await mountList();
    const cells = wrapper.findAll('tbody td');
    expect(cells[7]!.get('summary').text()).toBe(
      '合成被告甲有限公司、合成被告乙',
    );
    expect(cells[7]!.findAll('li').map((item) => item.text())).toEqual([
      '合成被告甲有限公司',
      '合成被告乙',
    ]);
    expect(cells[8]!.get('summary').text()).toBe('合成律师甲、合成律师乙');
    expect(cells[8]!.findAll('li').map((item) => item.text())).toEqual([
      '合成律师甲',
      '合成律师乙',
    ]);
    for (const index of [2, 3, 5, 7, 8, 9]) {
      expect(cells[index]!.get('summary').element.parentElement?.tagName).toBe(
        'DETAILS',
      );
    }
    expect(wrapper.get('.business-list-scroll').attributes()).toMatchObject({
      role: 'region',
      tabindex: '0',
      'aria-label': '案件列表，可横向滚动',
    });
    for (const index of [0, 6, 10])
      expect(cells[index]!.classes()).toContain('business-list-cell--nowrap');
    for (const index of [11, 12, 13])
      expect(cells[index]!.classes()).toContain('business-list-cell--number');
  });

  it('keeps high precision, pending and real zero separate with their exact sources', async () => {
    const { wrapper } = await mountList();
    const cells = wrapper.findAll('tbody td');
    expect(cells[11]!.get('span').text()).toBe('99999999999999.99');
    expect(cells[11]!.get('summary').text()).toBe('诉状确认');
    expect(cells[11]!.get('p').text()).toContain(sourceIds.confirmation);
    expect(cells[12]!.get('span').text()).toBe('待定');
    expect(cells[12]!.get('summary').text()).toBe('一审判决');
    expect(cells[12]!.get('p').text()).toContain(sourceIds.judgment);
    expect(cells[13]!.get('span').text()).toBe('0.00');
    expect(cells[13]!.get('summary').text()).toBe('结案登记');
    expect(cells[13]!.get('p').text()).toContain(sourceIds.closure);
  });

  it('shows unrecorded optional fields and amounts without inventing identifiers or money', async () => {
    const item = summary();
    item.displaySummary = {
      ...item.displaySummary,
      defendants: [],
      lawyers: [],
      court: null,
      courtCaseNo: null,
      source: { ...item.displaySummary.source, shopExternalId: null },
      claimAmount: {
        state: 'UNRECORDED',
        amount: null,
        sourceType: null,
        sourceId: null,
      },
      judgmentAmount: {
        state: 'UNRECORDED',
        amount: null,
        sourceType: null,
        sourceId: null,
      },
      closureAmount: {
        state: 'UNRECORDED',
        amount: null,
        sourceType: null,
        sourceId: null,
      },
    };
    api.listCases.mockResolvedValue(result([item]));
    const { wrapper } = await mountList();
    const cells = wrapper.findAll('tbody td');
    for (const index of [6, 7, 8, 9, 10, 11, 12, 13])
      expect(cells[index]!.text()).toBe('未登记');
    expect(wrapper.find('.case-list-amount-source').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('0.00');
    expect(cells[10]!.text()).not.toContain(item.businessNo);
  });

  it('uses the submitted complaint and changed second instance result sources supplied by the API', async () => {
    const item = summary();
    item.displaySummary.claimAmount = {
      state: 'KNOWN',
      amount: '100.00',
      sourceType: 'COMPLAINT_SUBMISSION',
      sourceId: sourceIds.submitted,
    };
    item.displaySummary.judgmentAmount = {
      state: 'KNOWN',
      amount: '80.00',
      sourceType: 'SECOND_INSTANCE_RESULT',
      sourceId: sourceIds.changed,
    };
    item.displaySummary.closureAmount = {
      state: 'PENDING',
      amount: null,
      sourceType: 'CASE_CLOSURE_VERSION',
      sourceId: sourceIds.correction,
    };
    api.listCases.mockResolvedValue(result([item]));
    const { wrapper } = await mountList();
    const cells = wrapper.findAll('tbody td');
    expect(cells[11]!.text()).toContain('已提交诉状');
    expect(cells[12]!.get('span').text()).toBe('80.00');
    expect(cells[12]!.get('summary').text()).toBe('二审结果');
    expect(cells[12]!.text()).toContain(sourceIds.changed);
    expect(cells[13]!.get('span').text()).toBe('待定');
    expect(cells[13]!.text()).toContain(sourceIds.correction);
  });

  it('renders equal customer and rights-holder names in two distinct columns', async () => {
    const item = summary();
    item.displaySummary.rightsHolderName = item.displaySummary.customerName;
    api.listCases.mockResolvedValue(result([item]));
    const { wrapper } = await mountList();
    expect(wrapper.findAll('tbody td')).toHaveLength(14);
    expect(wrapper.findAll('tbody td')[3]!.get('summary').text()).toBe(
      item.displaySummary.customerName,
    );
  });

  it('clears the old projection and ignores late replies after authorization revision changes', async () => {
    const { wrapper, auth } = await mountList();
    let resolveOld!: (value: CaseList) => void;
    api.listCases.mockReturnValueOnce(
      new Promise<CaseList>((resolve) => {
        resolveOld = resolve;
      }),
    );
    await wrapper.get('.page-head button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).not.toContain('合成客户甲有限公司');
    const signal = api.listCases.mock.calls.at(-1)?.[2]?.signal;
    api.listCases.mockResolvedValueOnce(result([]));
    auth.session = { ...session, authorizationRevision: 2 };
    await flushPromises();
    expect(signal?.aborted).toBe(true);
    resolveOld(result());
    await flushPromises();
    expect(wrapper.text()).toContain('当前没有案件');
    expect(wrapper.text()).not.toContain('合成客户甲有限公司');
    expect(wrapper.text()).not.toContain('99999999999999.99');
  });

  it('clears sensitive display fields on a denied refresh instead of showing an empty success', async () => {
    const { wrapper } = await mountList();
    api.listCases.mockRejectedValueOnce(
      new ApiError('Denied', 403, 'ACTION_FORBIDDEN', 'synthetic-request'),
    );
    await wrapper.get('.page-head button').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain(
      '当前账号无权读取案件',
    );
    expect(wrapper.find('tbody').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('合成客户甲有限公司');
    expect(wrapper.text()).not.toContain('当前没有案件');
  });
});
