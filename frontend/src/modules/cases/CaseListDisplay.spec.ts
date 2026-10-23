import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { RouterView, createMemoryHistory, createRouter } from 'vue-router';
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
const exportApi = vi.hoisted(() => ({
  exportCsv:
    vi.fn<typeof import('../../api/case-list-export').exportCaseListCsv>(),
  capability:
    vi.fn<
      typeof import('../../api/case-list-export').getCaseListExportCapability
    >(),
}));
const workflowTest = vi.hoisted(() => ({ markUnknown: false }));
const preferenceApi = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
}));
vi.mock('../../api/cases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/cases')>()),
  listCases: api.listCases,
  getCase: api.getCase,
  getExternalEntryOptions: api.getExternalEntryOptions,
}));
vi.mock('../../api/case-list-preference', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/case-list-preference')>()),
  getCaseListPreference: preferenceApi.get,
  saveCaseListPreference: preferenceApi.save,
}));
vi.mock('../../api/case-list-export', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/case-list-export')>()),
  exportCaseListCsv: exportApi.exportCsv,
  getCaseListExportCapability: exportApi.capability,
}));
vi.mock('./CaseListWorkflowPanel.vue', async (original) => ({
  ...(await original<typeof import('./CaseListWorkflowPanel.vue')>()),
  default: {
    props: ['item', 'action', 'session'],
    mounted(this: { session: { restoreUnknown: () => void } }) {
      if (workflowTest.markUnknown) this.session.restoreUnknown();
    },
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
      {
        path: '/case-handling-groups',
        component: { template: '<p>办理组</p>' },
      },
      { path: '/cases/:id', component: { template: '<p>详情</p>' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(
    { components: { RouterView }, template: '<RouterView />' },
    { global: { plugins: [pinia, router] } },
  );
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router, auth };
}

beforeEach(() => {
  vi.resetAllMocks();
  workflowTest.markUnknown = false;
  api.getCase.mockResolvedValue({ id: 'case-1' });
  api.listCases.mockResolvedValue(result());
  preferenceApi.get.mockResolvedValue({
    order: [
      'businessNo',
      'stage',
      'customerName',
      'rightsHolderName',
      'platform',
      'shopName',
      'shopExternalId',
      'defendants',
      'lawyers',
      'court',
      'courtCaseNo',
      'claimAmount',
      'judgmentAmount',
      'closureAmount',
    ],
    hidden: [],
  });
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
  exportApi.exportCsv.mockResolvedValue({
    blob: new Blob(['csv'], { type: 'text/csv' }),
    filename: 'case-list.csv',
    mimeType: 'text/csv',
  });
  exportApi.capability.mockResolvedValue({ canExport: false });
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
});

describe('authorized internal case list display', () => {
  it('applies five specialized drafts together, retains them across pages and clears to page one', async () => {
    api.listCases.mockImplementation(async (page = 1) => ({
      ...result(),
      total: 21,
      page,
    }));
    const { wrapper, router } = await mountList(
      '/cases?view=department&stage=WAITING_ARCHIVE',
    );
    const reads = api.listCases.mock.calls.length;
    await wrapper.get('[data-test="case-query-shop"]').setValue(' 店铺甲 ');
    await wrapper
      .get('[data-test="case-query-defendant"]')
      .setValue(' 被告乙 ');
    await wrapper.get('[data-test="case-query-court"]').setValue(' 法院丙 ');
    await wrapper.get('[data-test="case-query-lawyer"]').setValue(' 律师丁 ');
    await wrapper
      .get('[data-test="case-query-type"]')
      .setValue('HEARING_REPRESENTATION');
    expect(api.listCases).toHaveBeenCalledTimes(reads);
    expect(router.currentRoute.value.query.shopName).toBeUndefined();
    await wrapper.get('form[role="search"]').trigger('submit');
    await flushPromises();
    const filters = {
      shopName: '店铺甲',
      defendantName: '被告乙',
      courtName: '法院丙',
      lawyerName: '律师丁',
      caseType: 'HEARING_REPRESENTATION',
    };
    expect(api.listCases).toHaveBeenLastCalledWith(
      1,
      20,
      expect.objectContaining(filters),
    );
    expect(router.currentRoute.value.query).toMatchObject({
      ...filters,
      page: '1',
    });
    await wrapper.get('[data-test="next-page"]').trigger('click');
    await flushPromises();
    expect(api.listCases).toHaveBeenLastCalledWith(
      2,
      20,
      expect.objectContaining(filters),
    );
    await wrapper.get('[data-test="case-query-clear"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({
      view: 'department',
      stage: 'WAITING_ARCHIVE',
      page: '1',
      sortBy: 'createdAt',
      sortDirection: 'desc',
    });
    for (const key of Object.keys(filters))
      expect(api.listCases.mock.calls.at(-1)?.[2]).not.toHaveProperty(key);
    expect(wrapper.get('[data-test="case-query-type"]').element).toHaveProperty(
      'value',
      '',
    );
  });

  it('restores specialized drafts from URL without extra candidate reads', async () => {
    const { wrapper } = await mountList(
      '/cases?view=department&shopName=店铺&defendantName=被告&courtName=法院&lawyerName=律师&caseType=CRIMINAL',
    );
    for (const [selector, value] of [
      ['shop', '店铺'],
      ['defendant', '被告'],
      ['court', '法院'],
      ['lawyer', '律师'],
      ['type', 'CRIMINAL'],
    ]) {
      expect(
        wrapper.get(`[data-test="case-query-${selector}"]`).element,
      ).toHaveProperty('value', value);
    }
    expect(api.getCase).not.toHaveBeenCalled();
    expect(api.getExternalEntryOptions).toHaveBeenCalledTimes(1);
  });

  it.each(['shopName', 'defendantName', 'courtName', 'lawyerName', 'caseType'])(
    'aborts and fences a pending response when %s becomes repeated, then recovers',
    async (key) => {
      let resolveOld!: (value: CaseList) => void;
      api.listCases.mockReturnValueOnce(
        new Promise<CaseList>((resolve) => {
          resolveOld = resolve;
        }),
      );
      const { wrapper, router } = await mountList('/cases?view=department');
      const signal = api.listCases.mock.calls[0]?.[2]?.signal;
      await router.push({
        query: { view: 'department', [key]: ['CIVIL', 'CIVIL'] },
      });
      await flushPromises();
      expect(signal?.aborted).toBe(true);
      expect(wrapper.get('[role="alert"]').text()).toContain(
        `查询参数 ${key} 必须且只能出现一次`,
      );
      resolveOld(result([{ ...summary(), businessNo: 'STALE-SPECIAL' }]));
      await flushPromises();
      expect(wrapper.text()).not.toContain('STALE-SPECIAL');
      expect(api.listCases).toHaveBeenCalledTimes(1);
      await router.push('/cases?view=department');
      await flushPromises();
      expect(api.listCases).toHaveBeenCalledTimes(2);
      expect(wrapper.get('tbody').text()).toContain('合成客户甲有限公司');
    },
  );

  it('rejects an unknown URL case type rather than loading an unfiltered list', async () => {
    const { wrapper } = await mountList(
      '/cases?view=department&caseType=OTHER',
    );
    expect(api.listCases).not.toHaveBeenCalled();
    expect(wrapper.get('[role="alert"]').text()).toContain('案件类型无效');
  });
  it('opens the group page with the complete original list bookmark', async () => {
    const original =
      '/cases?view=department&stage=WAITING_ARCHIVE&page=1&q=合成&shopName=店铺&defendantName=被告&courtName=法院&lawyerName=律师&caseType=CIVIL&sortBy=businessNo&sortDirection=asc#original';
    const { wrapper, router } = await mountList(original);
    const before = router.currentRoute.value.fullPath;
    await wrapper
      .get('[data-test="case-handling-groups-entry"]')
      .trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/case-handling-groups');
    expect(router.currentRoute.value.query.returnTo).toBe(before);
  });
  it('keeps the group entry behind the existing unknown workflow navigation lock', async () => {
    workflowTest.markUnknown = true;
    api.listCases.mockResolvedValue(
      result([{ ...summary(), canArchive: true }]),
    );
    const { wrapper, router } = await mountList();
    await wrapper.get('[data-case-action="archive"]').trigger('click');
    await flushPromises();
    await wrapper
      .get('[data-test="case-handling-groups-entry"]')
      .trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/cases');
  });
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

  it('applies text filters and paired sorting only after explicit query submit', async () => {
    const { wrapper, router } = await mountList(
      '/cases?view=department&stage=WAITING_ARCHIVE&page=2',
    );
    const countBeforeEdit = api.listCases.mock.calls.length;
    await wrapper
      .get('[data-test="case-query-keyword"]')
      .setValue('  案号甲  ');
    await wrapper.get('form[role="search"]').trigger('submit');
    await flushPromises();
    expect(api.listCases).toHaveBeenCalledTimes(countBeforeEdit + 1);
    expect(api.listCases).toHaveBeenLastCalledWith(
      1,
      20,
      expect.objectContaining({
        view: 'department',
        stage: 'WAITING_ARCHIVE',
        q: '案号甲',
        sortBy: 'createdAt',
        sortDirection: 'desc',
      }),
    );
    expect(router.currentRoute.value.query).toEqual({
      view: 'department',
      stage: 'WAITING_ARCHIVE',
      q: '案号甲',
      sortBy: 'createdAt',
      sortDirection: 'desc',
      page: '1',
    });
  });

  it('rejects repeated query parameters without silently widening the list', async () => {
    const { wrapper } = await mountList('/cases?view=department&q=one&q=two');
    expect(api.listCases).not.toHaveBeenCalled();
    expect(wrapper.get('[role="alert"]').text()).toContain(
      '查询参数 q 必须且只能出现一次',
    );
  });

  it('aborts a pending list request when a valid empty query becomes invalid', async () => {
    let resolveOld!: (value: CaseList) => void;
    api.listCases.mockReturnValueOnce(
      new Promise<CaseList>((resolve) => {
        resolveOld = resolve;
      }),
    );
    const { wrapper, router } = await mountList('/cases?view=department');
    expect(api.listCases).toHaveBeenCalledTimes(1);
    const oldSignal = api.listCases.mock.calls[0]?.[2]?.signal;

    await router.push({ query: { view: 'department', q: ['one', 'two'] } });
    await flushPromises();

    expect(oldSignal?.aborted).toBe(true);
    expect(wrapper.get('[role="alert"]').text()).toContain(
      '查询参数 q 必须且只能出现一次',
    );
    resolveOld(result([{ ...summary(), businessNo: 'STALE-INVALID' }]));
    await flushPromises();
    expect(wrapper.text()).not.toContain('STALE-INVALID');
    expect(api.listCases).toHaveBeenCalledTimes(1);
  });

  it('reloads the list when an invalid query becomes a valid empty query', async () => {
    const { wrapper, router } = await mountList(
      '/cases?view=department&q=one&q=two',
    );
    expect(api.listCases).not.toHaveBeenCalled();

    await router.push({ query: { view: 'department', q: '' } });
    await flushPromises();

    expect(api.listCases).toHaveBeenCalledTimes(1);
    expect(api.listCases).toHaveBeenLastCalledWith(
      1,
      20,
      expect.objectContaining({ view: 'department' }),
    );
    expect(api.listCases.mock.calls.at(-1)?.[2]).not.toHaveProperty('q');
    expect(wrapper.get('tbody').text()).toContain('合成客户甲有限公司');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('keeps explicit query navigation blocked while a workflow result is unknown', async () => {
    workflowTest.markUnknown = true;
    api.listCases.mockResolvedValue(
      result([{ ...summary(), canArchive: true }]),
    );
    const { wrapper, router } = await mountList();
    await wrapper.get('[data-case-action="archive"]').trigger('click');
    await flushPromises();
    const listCalls = api.listCases.mock.calls.length;
    await wrapper.get('[data-test="case-query-keyword"]').setValue('不应离开');
    await wrapper.get('[data-test="case-query-shop"]').setValue('未知期间草稿');
    await wrapper.get('[data-test="case-query-type"]').setValue('CRIMINAL');
    await wrapper.get('form[role="search"]').trigger('submit');
    await flushPromises();
    expect(router.currentRoute.value.query.q).toBeUndefined();
    expect(router.currentRoute.value.query.shopName).toBeUndefined();
    expect(router.currentRoute.value.query.caseType).toBeUndefined();
    expect(api.listCases).toHaveBeenCalledTimes(listCalls);
  });

  it('ignores an old list response after the same identity receives a new session object', async () => {
    const oldItem = { ...summary(), id: 'old-session', businessNo: 'OLD-1' };
    const newItem = { ...summary(), id: 'new-session', businessNo: 'NEW-1' };
    let resolveOld!: (value: CaseList) => void;
    let resolveNew!: (value: CaseList) => void;
    api.listCases
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveOld = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveNew = resolve)),
      );
    const { wrapper, auth } = await mountList();
    expect(api.listCases).toHaveBeenCalledTimes(1);
    auth.session = structuredClone(session);
    await flushPromises();
    expect(api.listCases).toHaveBeenCalledTimes(2);
    resolveOld(result([oldItem]));
    resolveNew(result([newItem]));
    await flushPromises();
    expect(wrapper.get('tbody').text()).toContain('NEW-1');
    expect(wrapper.get('tbody').text()).not.toContain('OLD-1');
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

  it('applies the server preference order and hidden columns for the active process bucket', async () => {
    const order = [
      'businessNo',
      'stage',
      'rightsHolderName',
      'customerName',
      'platform',
      'shopName',
      'shopExternalId',
      'defendants',
      'lawyers',
      'court',
      'courtCaseNo',
      'claimAmount',
      'judgmentAmount',
      'closureAmount',
    ];
    preferenceApi.get.mockResolvedValueOnce({
      order,
      hidden: ['customerName'],
    });
    const { wrapper } = await mountList();
    expect(preferenceApi.get).toHaveBeenCalledWith('WAITING_ARCHIVE', {
      signal: expect.any(AbortSignal),
    });
    expect(
      wrapper
        .findAll('thead th')
        .map((cell) => cell.text())
        .slice(0, 4),
    ).toEqual(['操作／案件编号', '案件进展', '权利主体', '平台']);
    expect(wrapper.findAll('thead th')).toHaveLength(13);
    expect(
      wrapper.findAll('thead th').some((cell) => cell.text() === '客户'),
    ).toBe(false);
  });

  it('persists panel edits through PUT and updates the visible table only after confirmation', async () => {
    const saved = {
      order: [
        'businessNo',
        'stage',
        'customerName',
        'rightsHolderName',
        'platform',
        'shopName',
        'shopExternalId',
        'defendants',
        'lawyers',
        'court',
        'courtCaseNo',
        'claimAmount',
        'judgmentAmount',
        'closureAmount',
      ],
      hidden: ['customerName'],
    };
    preferenceApi.save.mockResolvedValueOnce(saved);
    const { wrapper } = await mountList();
    await wrapper.get('[data-test="open-column-settings"]').trigger('click');
    const customerRow = wrapper
      .findAll('[role="dialog"] li')
      .find((row) => row.text().includes('客户'))!;
    await customerRow.get('input[type="checkbox"]').setValue(false);
    await wrapper
      .findAll('[role="dialog"] button')
      .find((button) => button.text() === '保存')!
      .trigger('click');
    await flushPromises();
    expect(preferenceApi.save).toHaveBeenCalledWith(
      'WAITING_ARCHIVE',
      expect.objectContaining({ hidden: ['customerName'] }),
      { signal: expect.any(AbortSignal) },
    );
    expect(wrapper.findAll('thead th')).toHaveLength(13);
    expect(
      wrapper.findAll('thead th').some((cell) => cell.text() === '客户'),
    ).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toContain('已保存');
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

  it('shows the export action only after the current internal actor capability resolves true', async () => {
    exportApi.capability.mockResolvedValueOnce({ canExport: true });
    const { wrapper } = await mountList();
    expect(wrapper.get('[data-test="export-current-case-list"]').text()).toBe(
      '导出当前筛选结果',
    );

    const { wrapper: deniedWrapper } = await mountList();
    expect(
      deniedWrapper.find('[data-test="export-current-case-list"]').exists(),
    ).toBe(false);
    expect(api.listCases).toHaveBeenCalledTimes(2);
  });

  it('exports only the applied route filters and revokes the local download URL', async () => {
    exportApi.capability.mockResolvedValue({ canExport: true });
    const { wrapper } = await mountList(
      '/cases?view=department&stage=WAITING_ARCHIVE&q=已应用&shopName=店铺&defendantName=被告&courtName=法院&lawyerName=律师&caseType=CIVIL&sortBy=rightsHolderName&sortDirection=asc&page=1',
    );
    await wrapper
      .get('[data-test="case-query-keyword"]')
      .setValue('未提交草稿');
    await wrapper.get('[data-test="case-query-shop"]').setValue('未应用店铺');
    await wrapper.get('[data-test="case-query-type"]').setValue('CRIMINAL');
    const createObjectURL = vi.fn(() => 'blob:case-list');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.spyOn(
      globalThis.HTMLAnchorElement.prototype,
      'click',
    ).mockImplementation(() => {});

    await wrapper
      .get('[data-test="export-current-case-list"]')
      .trigger('click');
    await flushPromises();

    expect(exportApi.exportCsv).toHaveBeenCalledExactlyOnceWith(
      {
        view: 'department',
        stage: 'WAITING_ARCHIVE',
        q: '已应用',
        shopName: '店铺',
        defendantName: '被告',
        courtName: '法院',
        lawyerName: '律师',
        caseType: 'CIVIL',
        sortBy: 'rightsHolderName',
        sortDirection: 'asc',
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(exportApi.exportCsv.mock.calls[0]?.[0]).not.toHaveProperty('page');
    expect(exportApi.exportCsv.mock.calls[0]?.[0]).not.toHaveProperty(
      'pageSize',
    );
    expect(exportApi.exportCsv.mock.calls[0]?.[0]).not.toHaveProperty(
      '未提交草稿',
    );
    expect(createObjectURL).toHaveBeenCalledExactlyOnceWith(expect.any(Blob));
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:case-list');
  });

  it('allows only one export request for repeated clicks', async () => {
    exportApi.capability.mockResolvedValue({ canExport: true });
    let resolveExport!: (value: {
      blob: Blob;
      filename: string;
      mimeType: string;
    }) => void;
    exportApi.exportCsv.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveExport = resolve;
      }),
    );
    const { wrapper } = await mountList();
    vi.spyOn(
      globalThis.HTMLAnchorElement.prototype,
      'click',
    ).mockImplementation(() => {});
    const button = wrapper.get('[data-test="export-current-case-list"]');
    await button.trigger('click');
    await button.trigger('click');
    expect(exportApi.exportCsv).toHaveBeenCalledTimes(1);
    resolveExport({
      blob: new Blob(['csv'], { type: 'text/csv' }),
      filename: 'case-list.csv',
      mimeType: 'text/csv',
    });
    await flushPromises();
  });

  it('aborts and ignores an export response after the applied route query changes', async () => {
    exportApi.capability.mockResolvedValue({ canExport: true });
    let resolveExport!: (value: {
      blob: Blob;
      filename: string;
      mimeType: string;
    }) => void;
    exportApi.exportCsv.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveExport = resolve;
      }),
    );
    const { wrapper, router } = await mountList();
    const createObjectURL = vi.fn(() => 'blob:stale');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    await wrapper
      .get('[data-test="export-current-case-list"]')
      .trigger('click');
    const signal = exportApi.exportCsv.mock.calls[0]?.[1]?.signal;
    await router.push(
      '/cases?view=department&stage=WAITING_ARCHIVE&lawyerName=changed',
    );
    await flushPromises();
    expect(signal?.aborted).toBe(true);
    resolveExport({
      blob: new Blob(['stale'], { type: 'text/csv' }),
      filename: 'case-list.csv',
      mimeType: 'text/csv',
    });
    await flushPromises();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an unrecognized query parameter',
      '/cases?view=department&stage=WAITING_ARCHIVE&extra=1',
    ],
    [
      'a hash-only change',
      '/cases?view=department&stage=WAITING_ARCHIVE#section',
    ],
  ])(
    'aborts and ignores an export response after %s changes the full route',
    async (_label, destination) => {
      exportApi.capability.mockResolvedValue({ canExport: true });
      let resolveExport!: (value: {
        blob: Blob;
        filename: string;
        mimeType: string;
      }) => void;
      exportApi.exportCsv.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveExport = resolve;
        }),
      );
      const { wrapper, router } = await mountList();
      const createObjectURL = vi.fn(() => 'blob:unknown-route');
      vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
      await wrapper
        .get('[data-test="export-current-case-list"]')
        .trigger('click');
      const signal = exportApi.exportCsv.mock.calls[0]?.[1]?.signal;

      await router.push(destination);
      await flushPromises();
      expect(signal?.aborted).toBe(true);
      resolveExport({
        blob: new Blob(['stale'], { type: 'text/csv' }),
        filename: 'case-list.csv',
        mimeType: 'text/csv',
      });
      await flushPromises();
      expect(createObjectURL).not.toHaveBeenCalled();
    },
  );

  it('aborts stale capability and export results after the actor authorization changes', async () => {
    let resolveCapability!: (value: { canExport: boolean }) => void;
    exportApi.capability.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCapability = resolve;
      }),
    );
    exportApi.capability.mockResolvedValueOnce({ canExport: false });
    const { wrapper, auth } = await mountList();
    const oldCapabilitySignal = exportApi.capability.mock.calls[0]?.[0]?.signal;
    expect(
      wrapper.find('[data-test="export-current-case-list"]').exists(),
    ).toBe(false);
    auth.session = { ...session, authorizationRevision: 2 };
    await flushPromises();
    expect(oldCapabilitySignal?.aborted).toBe(true);
    resolveCapability({ canExport: true });
    await flushPromises();
    expect(
      wrapper.find('[data-test="export-current-case-list"]').exists(),
    ).toBe(false);
    expect(exportApi.capability).toHaveBeenCalledTimes(2);
  });

  it('aborts an export on authorization change and ignores its late file', async () => {
    exportApi.capability
      .mockResolvedValueOnce({ canExport: true })
      .mockResolvedValueOnce({ canExport: false });
    let resolveExport!: (value: {
      blob: Blob;
      filename: string;
      mimeType: string;
    }) => void;
    exportApi.exportCsv.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveExport = resolve;
      }),
    );
    const { wrapper, auth } = await mountList();
    const createObjectURL = vi.fn(() => 'blob:old-identity');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    await wrapper
      .get('[data-test="export-current-case-list"]')
      .trigger('click');
    const signal = exportApi.exportCsv.mock.calls[0]?.[1]?.signal;
    auth.session = { ...session, authorizationRevision: 2 };
    await flushPromises();
    expect(signal?.aborted).toBe(true);
    resolveExport({
      blob: new Blob(['stale'], { type: 'text/csv' }),
      filename: 'case-list.csv',
      mimeType: 'text/csv',
    });
    await flushPromises();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('aborts an export on unmount and does not download a late response', async () => {
    exportApi.capability.mockResolvedValue({ canExport: true });
    let resolveExport!: (value: {
      blob: Blob;
      filename: string;
      mimeType: string;
    }) => void;
    exportApi.exportCsv.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveExport = resolve;
      }),
    );
    const { wrapper } = await mountList();
    const createObjectURL = vi.fn(() => 'blob:unmounted');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    await wrapper
      .get('[data-test="export-current-case-list"]')
      .trigger('click');
    const signal = exportApi.exportCsv.mock.calls[0]?.[1]?.signal;
    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);
    expect(signal?.aborted).toBe(true);
    resolveExport({
      blob: new Blob(['stale'], { type: 'text/csv' }),
      filename: 'case-list.csv',
      mimeType: 'text/csv',
    });
    await flushPromises();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('never requests export capability or shows the action for non-internal sessions', async () => {
    exportApi.capability.mockResolvedValue({ canExport: true });
    const { wrapper, auth } = await mountList();
    auth.session = {
      ...session,
      principalType: 'CLIENT',
      department: null,
      departments: [],
      customer: { id: 'customer-1', name: '合成客户甲有限公司' },
    };
    await flushPromises();
    expect(exportApi.capability).toHaveBeenCalledTimes(1);
    expect(
      wrapper.find('[data-test="export-current-case-list"]').exists(),
    ).toBe(false);
  });

  it.each([
    [new ApiError('too many', 400, 'CASE_EXPORT_LIMIT_EXCEEDED'), '超过1000项'],
    [new ApiError('forbidden', 403, 'FORBIDDEN'), '已无案件导出权限'],
  ])(
    'shows a clear export failure without changing the list',
    async (failure, text) => {
      exportApi.capability.mockResolvedValue({ canExport: true });
      exportApi.exportCsv.mockRejectedValueOnce(failure);
      const { wrapper } = await mountList();
      await wrapper
        .get('[data-test="export-current-case-list"]')
        .trigger('click');
      await flushPromises();
      expect(wrapper.get('[role="alert"]').text()).toContain(text);
      expect(wrapper.get('tbody tr').text()).toContain('合成客户甲有限公司');
      expect(api.listCases).toHaveBeenCalledTimes(1);
      if (failure.status === 403)
        expect(
          wrapper.find('[data-test="export-current-case-list"]').exists(),
        ).toBe(false);
    },
  );

  it('keeps the case list available when capability lookup is forbidden', async () => {
    exportApi.capability.mockRejectedValue(
      new ApiError('Forbidden', 403, 'FORBIDDEN'),
    );
    const { wrapper } = await mountList();
    expect(wrapper.get('tbody tr').text()).toContain('合成客户甲有限公司');
    expect(
      wrapper.find('[data-test="export-current-case-list"]').exists(),
    ).toBe(false);
  });
});
