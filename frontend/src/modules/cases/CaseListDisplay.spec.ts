import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { RouterView, createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '../../api/auth';
import type { CaseList, CaseSummary } from '../../api/cases';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import CaseComplaintExportPanel from './CaseComplaintExportPanel.vue';
import CaseFilingBatchPanel from './CaseFilingBatchPanel.vue';
import CaseLawyerAssignmentBatchPanel from './CaseLawyerAssignmentBatchPanel.vue';
import CaseListPage from './CaseListPage.vue';
import { saveFilingBatch } from './case-filing-batch-recovery';
import { saveLawyerAssignmentBatch } from './case-lawyer-assignment-batch-recovery';
import type { FilingBatch } from './case-filing-batch-recovery';
import type { LawyerAssignmentBatch } from './case-lawyer-assignment-batch-recovery';

const api = vi.hoisted(() => ({
  getCase: vi.fn(),
  listCases: vi.fn<typeof import('../../api/cases').listCases>(),
  getExternalEntryOptions:
    vi.fn<typeof import('../../api/cases').getExternalEntryOptions>(),
}));
const exportApi = vi.hoisted(() => ({
  exportCsv:
    vi.fn<typeof import('../../api/case-list-export').exportCaseListCsv>(),
  exportSelection:
    vi.fn<typeof import('../../api/case-list-export').exportSelectedCasesCsv>(),
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
  exportSelectedCasesCsv: exportApi.exportSelection,
  getCaseListExportCapability: exportApi.capability,
}));
vi.mock('./CaseListWorkflowPanel.vue', async (original) => ({
  ...(await original<typeof import('./CaseListWorkflowPanel.vue')>()),
  default: {
    props: ['item', 'action', 'session'],
    emits: ['cancel'],
    data: () => ({ reason: '' }),
    mounted(this: { session: { restoreUnknown: () => void } }) {
      if (workflowTest.markUnknown) this.session.restoreUnknown();
    },
    template:
      '<div data-test="workflow-panel">{{ item.id }} {{ action }}<input data-test="workflow-reason" v-model="reason"><button data-test="workflow-success" @click="session.beginSubmit() && session.endSubmit(\'success\')">完成</button><button data-test="workflow-failed" @click="session.beginSubmit() && session.endSubmit(\'failed\')">失败</button><button data-test="workflow-cancel" @click="$emit(\'cancel\')">取消</button></div>',
  },
}));
vi.mock('./CaseLawyerAssignmentBatchPanel.vue', () => ({
  default: {
    props: ['selectedCases', 'actorKey'],
    emits: ['close', 'changed'],
    template:
      '<section data-test="assignment-panel-stub"><button data-test="assignment-panel-close" @click="$emit(\'close\')">关闭</button></section>',
  },
}));
vi.mock('./CaseFilingBatchPanel.vue', () => ({
  default: {
    props: ['selectedCases', 'actorKey'],
    emits: ['close', 'changed'],
    template:
      '<section data-test="filing-panel-stub"><button data-test="filing-panel-close" @click="$emit(\'close\')">关闭</button></section>',
  },
}));
vi.mock('./CaseComplaintExportPanel.vue', () => ({
  default: {
    props: ['selectedCases', 'actorKey'],
    emits: ['close', 'changed'],
    template:
      '<section data-test="complaint-export-panel-stub"><button data-test="complaint-export-panel-close" @click="$emit(\'close\')">关闭</button></section>',
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
    { attachTo: document.body, global: { plugins: [pinia, router] } },
  );
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router, auth };
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  localStorage.clear();
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
  exportApi.exportSelection.mockResolvedValue({
    blob: new Blob(['selected'], { type: 'text/csv' }),
    filename: 'case-selection.csv',
    mimeType: 'text/csv',
  });
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('authorized internal case list display', () => {
  it('opens lawyer assignment with the selected-case snapshot and blocks route changes until explicit close', async () => {
    const first = { ...summary(), stage: 'PENDING_MATCH' as const };
    const second = { ...first, id: 'case-2', businessNo: 'CA-2' };
    api.listCases.mockResolvedValue(result([first, second]));
    const { wrapper, router } = await mountList(
      '/cases?view=mine&stage=PENDING_MATCH',
    );
    const open = wrapper.get('[data-test="case-lawyer-assignment-batch-open"]');
    expect(open.attributes('disabled')).toBeDefined();
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    await wrapper.get('[data-test="select-case-case-2"]').setValue(true);
    await open.trigger('click');
    const panel = wrapper.findComponent(CaseLawyerAssignmentBatchPanel);
    expect(panel.exists()).toBe(true);
    expect(panel.props('selectedCases')).toEqual([first, second]);
    expect(panel.props('actorKey')).toBe('owner-1:INTERNAL:department-1:1');

    await wrapper.get('[data-test="clear-case-selection"]').trigger('click');
    expect(panel.props('selectedCases')).toEqual([first, second]);
    await router.push('/cases?view=mine&stage=WAITING_FILING');
    await flushPromises();
    expect(router.currentRoute.value.query.stage).toBe('PENDING_MATCH');
    expect(wrapper.get('[role="alert"]').text()).toContain(
      '请先关闭批量办理面板',
    );
    expect(wrapper.findComponent(CaseLawyerAssignmentBatchPanel).exists()).toBe(
      true,
    );

    await wrapper.get('[data-test="assignment-panel-close"]').trigger('click');
    await router.push('/cases?view=mine&stage=WAITING_FILING');
    await flushPromises();
    expect(router.currentRoute.value.query.stage).toBe('WAITING_FILING');
  });

  it('opens filing and complaint export panels with only the selected cases', async () => {
    const first = { ...summary(), stage: 'WAITING_FILING' as const };
    const second = { ...first, id: 'case-2', businessNo: 'CA-2' };
    api.listCases.mockResolvedValue(result([first, second]));
    const { wrapper } = await mountList(
      '/cases?view=mine&stage=WAITING_FILING',
    );
    await wrapper.get('[data-test="select-case-case-2"]').setValue(true);
    await wrapper.get('[data-test="case-filing-batch-open"]').trigger('click');
    expect(
      wrapper.findComponent(CaseFilingBatchPanel).props('selectedCases'),
    ).toEqual([second]);
    await wrapper.get('[data-test="filing-panel-close"]').trigger('click');

    const complaint = {
      ...first,
      id: 'complaint-1',
      stage: 'WAITING_COMPLAINT' as const,
    };
    api.listCases.mockResolvedValue(result([complaint, second]));
    const complaintMount = await mountList(
      '/cases?view=mine&stageGroup=COMPLAINT_PREPARATION',
    );
    await complaintMount.wrapper
      .get('[data-test="select-case-complaint-1"]')
      .setValue(true);
    await complaintMount.wrapper
      .get('[data-test="case-complaint-export-open"]')
      .trigger('click');
    expect(
      complaintMount.wrapper
        .findComponent(CaseComplaintExportPanel)
        .props('selectedCases'),
    ).toEqual([complaint]);
  });

  it('restores unfinished batches without selection on unrelated stages and rechecks after identity revision changes', async () => {
    const actor = 'owner-1:INTERNAL:department-1';
    const filing: FilingBatch = {
      identity: actor,
      batchId: '33333333-3333-4333-8333-333333333333',
      createdAt: '2026-11-04T01:00:00.000Z',
      items: [
        {
          caseId: '44444444-4444-4444-8444-444444444444',
          businessNo: 'A-1',
          state: 'PREPARED',
          input: {
            expectedVersion: 3,
            idempotencyKey: 'original-filing-key',
            courtId: '11111111-1111-4111-8111-111111111111',
            submittedAt: '2026-11-04',
            filingEvidenceContentVersionIds: [
              '22222222-2222-4222-8222-222222222222',
            ],
          },
          courtName: '甲法院',
          evidenceFiles: [
            {
              materialId: '55555555-5555-4555-8555-555555555555',
              contentVersionId: '22222222-2222-4222-8222-222222222222',
              originalFilename: '诉状.pdf',
              mimeType: 'application/pdf',
            },
          ],
          screenshotFiles: [],
        },
      ],
    };
    const assignment: LawyerAssignmentBatch = {
      identity: actor,
      batchId: '66666666-6666-4666-8666-666666666666',
      target: {
        lawyerAccountId: '77777777-7777-4777-8777-777777777777',
        lawyerProfileId: '88888888-8888-4888-8888-888888888888',
        displayName: '张律师',
        username: 'zhang',
      },
      items: [
        {
          caseId: '99999999-9999-4999-8999-999999999999',
          businessNo: 'A-2',
          state: 'PREPARED',
          input: {
            expectedVersion: 5,
            idempotencyKey: 'original-assignment-key',
            lawyerAccountId: '77777777-7777-4777-8777-777777777777',
            lawyerProfileId: '88888888-8888-4888-8888-888888888888',
          },
        },
      ],
    };
    expect(saveFilingBatch(filing)).toBe(true);
    expect(saveLawyerAssignmentBatch(assignment)).toBe(true);
    api.listCases.mockResolvedValue(
      result([{ ...summary(), stage: 'ARCHIVED' }]),
    );
    const { wrapper, auth } = await mountList(
      '/cases?view=mine&stage=ARCHIVED',
    );
    expect(wrapper.find('[data-test="case-batch-recovery"]').exists()).toBe(
      true,
    );
    expect(wrapper.text()).not.toContain('已选 1 件');

    await wrapper.get('[data-test="resume-filing-batch"]').trigger('click');
    let panel = wrapper.findComponent(CaseFilingBatchPanel);
    expect(panel.props('selectedCases')).toEqual([]);
    expect(panel.props('actorKey')).toBe(`${actor}:1`);
    await wrapper.get('[data-test="filing-panel-close"]').trigger('click');
    await wrapper.get('[data-test="resume-assignment-batch"]').trigger('click');
    panel = wrapper.findComponent(CaseLawyerAssignmentBatchPanel);
    expect(panel.props('selectedCases')).toEqual([]);
    expect(panel.props('actorKey')).toBe(`${actor}:1`);

    auth.session = { ...auth.session!, authorizationRevision: 2 };
    await flushPromises();
    expect(wrapper.findComponent(CaseLawyerAssignmentBatchPanel).exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="case-batch-recovery"]').exists()).toBe(
      true,
    );
    await wrapper.get('[data-test="resume-assignment-batch"]').trigger('click');
    expect(
      wrapper.findComponent(CaseLawyerAssignmentBatchPanel).props('actorKey'),
    ).toBe(`${actor}:2`);
    expect(
      localStorage.getItem(`case-filing-batch-v2:${encodeURIComponent(actor)}`),
    ).toContain('original-filing-key');
    expect(
      localStorage.getItem(
        `case-lawyer-assignment-batch-v1:${encodeURIComponent(actor)}`,
      ),
    ).toContain('original-assignment-key');
  });

  it('applies keyword and visible filters, then clears all filter fields and old sorting', async () => {
    const { wrapper, router } = await mountList(
      '/cases?view=department&stage=WAITING_ARCHIVE&sortBy=businessNo&shopName=old',
    );
    await wrapper.get('[data-test="open-case-filters"]').trigger('click');
    const visibleFilters: Record<string, string> = {
      customerName: '客户甲',
      rightsHolderName: '权利方甲',
      courtCaseNo: '案号甲',
      shopName: '店铺甲',
      defendantName: '被告甲',
      courtName: '法院乙',
      lawyerName: '律师甲',
    };
    for (const [key, value] of Object.entries(visibleFilters))
      await wrapper.get(`[data-test="filter-${key}"]`).setValue(value);
    await wrapper
      .get(
        'input[aria-label="编号、案号、客户、权利主体、店铺、被告、法院、律师"]',
      )
      .setValue(' 法院甲 ');
    await wrapper.get('form[role="search"]').trigger('submit');
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({
      view: 'department',
      stage: 'WAITING_ARCHIVE',
      q: '法院甲',
      ...visibleFilters,
      page: '1',
    });
    expect(api.listCases).toHaveBeenLastCalledWith(
      1,
      20,
      expect.objectContaining({ q: '法院甲', ...visibleFilters }),
    );
    const detailHref = wrapper
      .get('tbody td[data-column="businessNo"] a')
      .attributes('href');
    expect(detailHref).toContain('customerName=%E5%AE%A2%E6%88%B7%E7%94%B2');
    expect(detailHref).toContain('lawyerName=%E5%BE%8B%E5%B8%88%E7%94%B2');
    await wrapper.get('[data-test="open-case-filters"]').trigger('click');
    await wrapper.get('[data-test="case-query-clear"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({
      view: 'department',
      stage: 'WAITING_ARCHIVE',
      page: '1',
    });
  });

  it('removes a legacy case type URL filter before loading the supported scope', async () => {
    const { wrapper, router } = await mountList(
      '/cases?view=department&caseType=OTHER',
    );
    await flushPromises();
    expect(router.currentRoute.value.query.caseType).toBeUndefined();
    expect(api.listCases).toHaveBeenCalled();
    expect(api.listCases.mock.calls.at(-1)?.[2]).not.toHaveProperty('caseType');
    expect(wrapper.find('[data-test="case-query-type"]').exists()).toBe(false);
  });
  it('does not restore the removed handling-group entry or source column', async () => {
    const { wrapper } = await mountList();
    expect(
      wrapper.find('[data-test="case-handling-groups-entry"]').exists(),
    ).toBe(false);
    expect(wrapper.find('th[data-column="origin"]').exists()).toBe(false);
    expect(wrapper.find('td[data-column="origin"]').exists()).toBe(false);
    await wrapper.get('[data-test="open-column-settings"]').trigger('click');
    expect(wrapper.get('[role="dialog"]').text()).not.toContain('来源');
  });

  it('shows consolidation only in pending match and requires pending-match cases', async () => {
    const first = {
      ...summary(),
      id: 'case-1',
      stage: 'PENDING_MATCH' as const,
      canConsolidate: true,
    };
    const second = {
      ...summary(),
      id: 'case-2',
      businessNo: 'CA-20261013-00001235',
      stage: 'PENDING_MATCH' as const,
      canConsolidate: true,
    };
    api.listCases.mockResolvedValue(result([first, second]));
    const { wrapper, router } = await mountList(
      '/cases?view=mine&stage=PENDING_MATCH',
    );
    const button = wrapper.get('[data-test="open-case-consolidation"]');
    expect(button.text()).toBe('合并起诉');
    expect(button.attributes('disabled')).toBeDefined();
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    await wrapper.get('[data-test="select-case-case-2"]').setValue(true);
    expect(button.attributes('disabled')).toBeUndefined();
    await button.trigger('click');
    expect(wrapper.find('[aria-label="合并起诉"]').exists()).toBe(true);
    await router.push('/cases?view=mine&stageGroup=COMPLAINT_PREPARATION');
    await flushPromises();
    expect(wrapper.find('[data-test="open-case-consolidation"]').exists()).toBe(
      false,
    );
    await router.push('/cases?view=mine&stage=WAITING_FILING');
    await flushPromises();
    expect(wrapper.find('[data-test="open-case-consolidation"]').exists()).toBe(
      false,
    );
  });

  it('hides complaint-group consolidation even when selected cases advertise capability', async () => {
    api.listCases.mockResolvedValue(
      result([
        {
          ...summary(),
          id: 'case-1',
          stage: 'WAITING_COMPLAINT',
          canConsolidate: true,
        },
        {
          ...summary(),
          id: 'case-2',
          stage: 'WAITING_COMPLAINT_STAMP',
          canConsolidate: true,
        },
      ]),
    );
    const { wrapper, router } = await mountList(
      '/cases?view=mine&stageGroup=COMPLAINT_PREPARATION',
    );
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    await wrapper.get('[data-test="select-case-case-2"]').setValue(true);
    expect(wrapper.find('[data-test="open-case-consolidation"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[aria-label="合并起诉"]').exists()).toBe(false);
    api.listCases.mockResolvedValue(
      result([
        {
          ...summary(),
          id: 'case-1',
          stage: 'PENDING_MATCH',
          canConsolidate: true,
        },
        {
          ...summary(),
          id: 'case-2',
          stage: 'PENDING_MATCH',
          canConsolidate: false,
        },
      ]),
    );
    await wrapper.get('[data-test="open-case-filters"]').trigger('click');
    await wrapper.get('[data-test="case-query-clear"]').trigger('click');
    await flushPromises();
    await router.push('/cases?view=mine&stage=PENDING_MATCH');
    await flushPromises();
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    await wrapper.get('[data-test="select-case-case-2"]').setValue(true);
    expect(
      wrapper
        .get('[data-test="open-case-consolidation"]')
        .attributes('disabled'),
    ).toBeDefined();
  });

  it('navigates from ordinary row content but not from its checkbox, disclosure, or action button', async () => {
    api.listCases.mockResolvedValue(
      result([{ ...summary(), canArchive: true }]),
    );
    const { wrapper, router } = await mountList();
    const row = wrapper.get('tbody tr');
    await row.get('[data-test="select-case-case-1"]').setValue(true);
    await row.get('td[data-column="claimAmount"] summary').trigger('click');
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    await wrapper.get('[data-case-action="archive"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/cases');
    await row.get('td[data-column="customerName"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/cases/case-1');
  });
  it('keeps row navigation behind the existing unknown workflow navigation lock', async () => {
    workflowTest.markUnknown = true;
    api.listCases.mockResolvedValue(
      result([{ ...summary(), canArchive: true }]),
    );
    const { wrapper, router } = await mountList();
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    await wrapper.get('[data-case-action="archive"]').trigger('click');
    await flushPromises();
    await wrapper.get('tbody td[data-column="customerName"]').trigger('click');
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
      .get(
        'input[aria-label="编号、案号、客户、权利主体、店铺、被告、法院、律师"]',
      )
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
      }),
    );
    expect(router.currentRoute.value.query).toEqual({
      view: 'department',
      stage: 'WAITING_ARCHIVE',
      q: '案号甲',
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
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    await wrapper.get('[data-case-action="archive"]').trigger('click');
    await flushPromises();
    const listCalls = api.listCases.mock.calls.length;
    await wrapper
      .get(
        'input[aria-label="编号、案号、客户、权利主体、店铺、被告、法院、律师"]',
      )
      .setValue('不应离开');
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
    ).toEqual(['选择后续']);
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
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    const action = wrapper.get('[data-case-action="archive"]');
    await action.trigger('click');
    await action.trigger('click');
    await flushPromises();
    expect(api.getCase).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.path).toBe('/cases');
    finish({ id: 'case-1' });
    await flushPromises();
  });

  it('reads ARCHIVED through the fixed API, preserving the case projection and amount sources', async () => {
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
    expect(wrapper.findAll('thead th')).toHaveLength(17);
    expect(wrapper.get('tbody').text()).toContain('已归档');
    expect(wrapper.get('tbody').text()).toContain(sourceIds.closure);
    expect(wrapper.get('tbody').text()).toContain('0.00');
    expect(wrapper.get('tbody a').attributes('href')).toBe(
      '/cases/case-1?view=department&stage=ARCHIVED',
    );
    for (const text of ['已结清', '已结算', '归档原因', '确认归档'])
      expect(wrapper.get('tbody').text()).not.toContain(text);
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

  it('renders fixed identity/action columns and exact business fields with selection controls', async () => {
    const { wrapper } = await mountList();
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual([
      '',
      '操作',
      '案件编号',
      '负责人',
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
    expect(cells[3]!.text()).toBe('负责运营甲');
    expect(cells[1]!.findAll('button')).toHaveLength(0);
    expect(wrapper.find('td[data-column="origin"]').exists()).toBe(false);
    expect(cells[5]!.get('span').text()).toBe('合成客户甲有限公司');
    expect(cells[6]!.get('span').text()).toBe('合成权利主体乙有限公司');
    expect(cells[7]!.text()).toBe('淘宝');
    expect(cells[8]!.get('span').text()).toBe(
      summary().displaySummary.source.shopName,
    );
    expect(cells[9]!.text()).toBe('TB-0000123456789');
    expect(cells[12]!.get('span').text()).toBe('合成人民法院');
    expect(cells[13]!.text()).toBe('（2026）合成民初000123号');
    expect(cells[2]!.get('a').attributes('href')).toBe(
      '/cases/case-1?view=department&stage=WAITING_ARCHIVE',
    );
    expect(cells[1]!.text()).not.toContain('当前无可办操作');
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(true);
    expect(wrapper.get('tbody').text()).not.toMatch(
      /批量|已结清|未结清|实收额/,
    );
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
        .slice(0, 5),
    ).toEqual(['', '操作', '案件编号', '负责人', '案件进展']);
    expect(wrapper.findAll('thead th')).toHaveLength(16);
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
    expect(wrapper.findAll('thead th')).toHaveLength(16);
    expect(
      wrapper.findAll('thead th').some((cell) => cell.text() === '客户'),
    ).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toContain('已保存');
  });

  it('keeps full names visible and in titles while allowing the text to open the case', async () => {
    const { wrapper } = await mountList();
    const cells = wrapper.findAll('tbody td');
    expect(cells[10]!.get('span').text()).toBe(
      '合成被告甲有限公司、合成被告乙',
    );
    expect(cells[11]!.get('span').text()).toBe('合成律师甲、合成律师乙');
    for (const index of [5, 6, 8, 10, 11, 12]) {
      expect(cells[index]!.get('span').attributes('title')).toBe(
        cells[index]!.text(),
      );
    }
    expect(wrapper.get('.business-list-scroll').attributes()).toMatchObject({
      role: 'region',
      tabindex: '0',
      'aria-label': '案件列表，可横向滚动',
    });
    for (const index of [0, 2, 4, 9, 13])
      expect(cells[index]!.classes()).toContain('business-list-cell--nowrap');
    for (const index of [14, 15, 16])
      expect(cells[index]!.classes()).toContain('business-list-cell--number');
  });

  it('keeps high precision, pending and real zero separate with their exact sources', async () => {
    const { wrapper } = await mountList();
    const cells = wrapper.findAll('tbody td');
    expect(cells[14]!.get('span').text()).toBe('99999999999999.99');
    expect(cells[14]!.get('summary').text()).toBe('诉状确认');
    expect(cells[14]!.get('p').text()).toContain(sourceIds.confirmation);
    expect(cells[15]!.get('span').text()).toBe('待定');
    expect(cells[15]!.get('summary').text()).toBe('一审判决');
    expect(cells[15]!.get('p').text()).toContain(sourceIds.judgment);
    expect(cells[16]!.get('span').text()).toBe('0.00');
    expect(cells[16]!.get('summary').text()).toBe('结案登记');
    expect(cells[16]!.get('p').text()).toContain(sourceIds.closure);
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
    expect(cells[9]!.text()).toBe('');
    for (const index of [10, 11, 12, 13, 14, 15, 16])
      expect(cells[index]!.text()).toBe('未登记');
    expect(wrapper.find('.case-list-amount-source').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('0.00');
    expect(cells[10]!.text()).not.toContain(item.businessNo);
  });

  it('keeps an empty shop ID blank and displays a real zero shop ID', async () => {
    const emptyId = summary();
    emptyId.displaySummary.source.shopExternalId = '';
    const zeroId = {
      ...summary(),
      id: 'case-zero-shop-id',
      businessNo: 'CA-20261013-00001235',
      displaySummary: {
        ...summary().displaySummary,
        source: { ...summary().displaySummary.source, shopExternalId: '0' },
      },
    };
    api.listCases.mockResolvedValue(result([emptyId, zeroId]));
    const { wrapper } = await mountList();
    const shopIdCells = wrapper
      .findAll('tbody tr')
      .map((row) => row.get('td[data-column="shopExternalId"]'));
    expect(shopIdCells[0]!.text()).toBe('');
    expect(shopIdCells[1]!.text()).toBe('0');
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
    expect(cells[14]!.text()).toContain('已提交诉状');
    expect(cells[15]!.get('span').text()).toBe('80.00');
    expect(cells[15]!.get('summary').text()).toBe('二审结果');
    expect(cells[15]!.text()).toContain(sourceIds.changed);
    expect(cells[16]!.get('span').text()).toBe('待定');
    expect(cells[16]!.text()).toContain(sourceIds.correction);
  });

  it('renders equal customer and rights-holder names in two distinct columns', async () => {
    const item = summary();
    item.displaySummary.rightsHolderName = item.displaySummary.customerName;
    api.listCases.mockResolvedValue(result([item]));
    const { wrapper } = await mountList();
    expect(wrapper.findAll('tbody td')).toHaveLength(17);
    expect(wrapper.findAll('tbody td')[5]!.get('span').text()).toBe(
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
    await wrapper.get('[data-test="open-case-filters"]').trigger('click');
    await wrapper
      .get('[data-test="refresh-case-list-in-filters"]')
      .trigger('click');
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
    await wrapper.get('[data-test="open-case-filters"]').trigger('click');
    await wrapper
      .get('[data-test="refresh-case-list-in-filters"]')
      .trigger('click');
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
      '导出筛选结果',
    );
    expect(
      wrapper.get('[data-test="export-current-case-list"]').classes(),
    ).not.toContain('el-button--primary');

    const { wrapper: deniedWrapper } = await mountList();
    expect(
      deniedWrapper.find('[data-test="export-current-case-list"]').exists(),
    ).toBe(false);
    expect(api.listCases).toHaveBeenCalledTimes(2);
  });

  it('exports explicit selected IDs and clears selection when the page scope changes', async () => {
    exportApi.capability.mockResolvedValue({ canExport: true });
    const { wrapper, router } = await mountList();
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    expect(wrapper.text()).toContain('已选 1 件');
    vi.spyOn(
      globalThis.HTMLAnchorElement.prototype,
      'click',
    ).mockImplementation(() => {});
    await wrapper.get('[data-test="export-selected-cases"]').trigger('click');
    await flushPromises();
    expect(exportApi.exportSelection).toHaveBeenCalledExactlyOnceWith(
      { view: 'department', ids: ['case-1'] },
      { signal: expect.any(AbortSignal) },
    );
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    await router.push('/cases?view=mine&stage=WAITING_ARCHIVE&page=1');
    await flushPromises();
    expect(
      wrapper.get('[data-test="export-selected-cases"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get('[data-test="select-case-case-1"]').attributes('checked'),
    ).toBeUndefined();
  });

  it.each([
    ['WAITING_ARCHIVE', true, 'owner-1'],
    ['ARCHIVED', true, 'owner-1'],
    ['EXECUTING', true, 'owner-1'],
    ['ARCHIVED', false, 'owner-1'],
    ['ARCHIVED', true, 'other-owner'],
  ] as const)(
    'does not add payment proof as a persistent single-case action (%s, %s, %s)',
    async (stage, capability, owner) => {
      api.listCases.mockResolvedValue(
        result([
          {
            ...summary(),
            stage,
            canSupplementPaymentProof: capability,
            owner: { id: owner, displayName: '负责运营' },
            canUpdateClosureSettlement: true,
          },
        ]),
      );
      const { wrapper } = await mountList();
      expect(
        wrapper
          .get('tbody tr')
          .find('[data-case-action="payment-proof"]')
          .exists(),
      ).toBe(false);
      if (stage === 'ARCHIVED')
        expect(
          wrapper
            .get('tbody tr')
            .find('[data-case-action="settlement-update"]')
            .exists(),
        ).toBe(false);
      await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
      expect(
        wrapper.find('[data-test="case-single-actions-menu"]').exists(),
      ).toBe(false);
      expect(wrapper.find('td[data-column="businessNo"] a').exists()).toBe(
        true,
      );
    },
  );

  it('archives selected independent cases with a fresh form per case and explicit continuation', async () => {
    const first = { ...summary(), canArchive: true };
    const second = { ...first, id: 'case-2', businessNo: 'CA-2' };
    api.listCases.mockResolvedValue(result([first, second]));
    api.getCase.mockImplementation(async (id: string) => ({ id }));
    const { wrapper, auth } = await mountList(
      '/cases?view=department&stage=WAITING_ARCHIVE',
    );
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    expect(wrapper.findAll('[data-case-action="archive"]')).toHaveLength(1);
    expect(wrapper.find('[data-test="archive-selected-cases"]').exists()).toBe(
      true,
    );
    await wrapper.get('[data-test="select-case-case-2"]').setValue(true);
    expect(wrapper.findAll('[data-case-action="archive"]')).toHaveLength(1);
    await wrapper.get('[data-test="archive-selected-cases"]').trigger('click');
    await flushPromises();
    const reason = document.querySelector(
      '[data-test="workflow-reason"]',
    ) as HTMLInputElement;
    reason.value = '第一案独立归档原因';
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    (
      document.querySelector(
        '[data-test="workflow-failed"]',
      ) as HTMLButtonElement
    ).click();
    await flushPromises();
    expect(api.getCase).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-test="next-archive-case"]').exists()).toBe(
      false,
    );
    (
      document.querySelector(
        '[data-test="workflow-cancel"]',
      ) as HTMLButtonElement
    ).click();
    await flushPromises();
    expect(wrapper.get('[data-test="next-archive-case"]').text()).toContain(
      '剩余 2 件',
    );
    await wrapper.get('[data-test="next-archive-case"]').trigger('click');
    await flushPromises();
    expect(api.getCase).toHaveBeenLastCalledWith('case-1', {
      signal: expect.any(AbortSignal),
    });
    expect(
      (
        document.querySelector(
          '[data-test="workflow-reason"]',
        ) as HTMLInputElement
      ).value,
    ).toBe('');
    (
      document.querySelector(
        '[data-test="workflow-success"]',
      ) as HTMLButtonElement
    ).click();
    await flushPromises();
    expect(api.getCase.mock.calls.every(([id]) => id === 'case-1')).toBe(true);
    expect(wrapper.get('[data-test="next-archive-case"]').text()).toContain(
      '剩余 1 件',
    );
    await wrapper.get('[data-test="next-archive-case"]').trigger('click');
    await flushPromises();
    expect(api.getCase).toHaveBeenLastCalledWith('case-2', {
      signal: expect.any(AbortSignal),
    });
    expect(
      (
        document.querySelector(
          '[data-test="workflow-reason"]',
        ) as HTMLInputElement
      ).value,
    ).toBe('');
    auth.session = { ...auth.session!, authorizationRevision: 2 };
    await flushPromises();
    expect(wrapper.find('[data-test="next-archive-case"]').exists()).toBe(
      false,
    );
  });

  it('starts the archive workflow for one selected case', async () => {
    const item = { ...summary(), canArchive: true };
    api.listCases.mockResolvedValue(result([item]));
    api.getCase.mockResolvedValue({ id: item.id });
    const { wrapper } = await mountList(
      '/cases?view=department&stage=WAITING_ARCHIVE',
    );
    expect(
      wrapper
        .get('[data-test="archive-selected-cases"]')
        .attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    expect(
      wrapper
        .get('[data-test="archive-selected-cases"]')
        .attributes('disabled'),
    ).toBeUndefined();
    await wrapper.get('[data-test="archive-selected-cases"]').trigger('click');
    await flushPromises();
    expect(api.getCase).toHaveBeenCalledWith(item.id, {
      signal: expect.any(AbortSignal),
    });
    expect(wrapper.find('[data-test="next-archive-case"]').exists()).toBe(
      false,
    );
  });

  it('starts a complaint queue from only selected cases and records success without repeating it', async () => {
    const first = {
      ...summary(),
      stage: 'WAITING_COMPLAINT' as const,
      canSubmitComplaint: true,
    };
    const second = {
      ...first,
      id: 'case-2',
      businessNo: 'CA-2',
    };
    api.listCases.mockResolvedValue(result([first, second]));
    api.getCase.mockResolvedValue({ id: first.id });
    const path = '/cases?view=mine&stageGroup=COMPLAINT_PREPARATION';
    const { wrapper } = await mountList(path);
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    await wrapper
      .get('[data-test="start-complaint-batch-complaint"]')
      .trigger('click');
    expect(
      wrapper.find('[data-test="complaint-batch-entry-case-1"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="complaint-batch-entry-case-2"]').exists(),
    ).toBe(false);
    await wrapper
      .get('[data-test="continue-complaint-batch-case-1"]')
      .trigger('click');
    await flushPromises();
    expect(api.getCase).toHaveBeenCalledExactlyOnceWith(first.id, {
      signal: expect.any(AbortSignal),
    });
    expect(document.body.textContent).toContain('case-1 complaint');
    (
      document.querySelector(
        '[data-test="workflow-success"]',
      ) as HTMLButtonElement
    ).click();
    await flushPromises();
    expect(
      wrapper.get('[data-test="complaint-batch-entry-case-1"]').text(),
    ).toContain('已成功');
    expect(
      wrapper.find('[data-test="continue-complaint-batch-case-1"]').exists(),
    ).toBe(false);
    const stored = JSON.parse(
      sessionStorage.getItem(
        'case-list-complaint-batch:v1:owner-1%3AINTERNAL%3Adepartment-1%3A1',
      )!,
    ) as { entries: { status: string }[] };
    expect(stored.entries[0]?.status).toBe('succeeded');
  });

  it('shows mixed stage and capability blockers and offers explicit continuation after cancel', async () => {
    const eligible = {
      ...summary(),
      stage: 'WAITING_COMPLAINT' as const,
      canSubmitComplaint: true,
    };
    const blocked = {
      ...eligible,
      id: 'case-2',
      businessNo: 'CA-2',
      stage: 'WAITING_COMPLAINT_CONFIRMATION' as const,
      canSubmitComplaint: false,
    };
    api.listCases.mockResolvedValue(result([eligible, blocked]));
    const { wrapper } = await mountList(
      '/cases?view=mine&stageGroup=COMPLAINT_PREPARATION',
    );
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    await wrapper.get('[data-test="select-case-case-2"]').setValue(true);
    await wrapper
      .get('[data-test="start-complaint-batch-complaint"]')
      .trigger('click');
    expect(
      wrapper.get('[data-test="complaint-batch-entry-case-2"]').text(),
    ).toContain('条件不符');
    expect(
      wrapper.get('[data-test="complaint-batch-entry-case-2"]').text(),
    ).toContain('阶段或服务端权限');
    expect(
      wrapper.find('[data-test="continue-complaint-batch-case-2"]').exists(),
    ).toBe(false);
    await wrapper
      .get('[data-test="continue-complaint-batch-case-1"]')
      .trigger('click');
    await flushPromises();
    expect(api.getCase).toHaveBeenCalledExactlyOnceWith(eligible.id, {
      signal: expect.any(AbortSignal),
    });
    (
      document.querySelector(
        '[data-test="workflow-cancel"]',
      ) as HTMLButtonElement
    ).click();
    await flushPromises();
    expect(
      wrapper.find('[data-test="continue-complaint-batch-case-1"]').exists(),
    ).toBe(true);
    expect(
      wrapper.get('[data-test="continue-complaint-batch-case-1"]').text(),
    ).toBe('继续逐案办理');
  });

  it('restores an unknown original request and prevents skipping it', async () => {
    workflowTest.markUnknown = true;
    const identity = 'owner-1:INTERNAL:department-1:1';
    const caseId = 'case-1';
    const action = 'complaint';
    sessionStorage.setItem(
      `case-list-complaint-batch:v1:${encodeURIComponent(identity)}`,
      JSON.stringify({
        version: 1,
        actor: identity,
        action,
        entries: [
          {
            caseId,
            businessNo: 'CA-20261013-00001234',
            action,
            status: 'pending',
            reason: '',
          },
        ],
      }),
    );
    sessionStorage.setItem(
      `case-list-workflow:v1:${encodeURIComponent(identity)}:${encodeURIComponent(caseId)}`,
      JSON.stringify({
        version: 1,
        actor: identity,
        caseId,
        action,
        command: {
          kind: 'complaint',
          input: {
            expectedVersion: 1,
            idempotencyKey: 'original-key',
            amountState: 'PENDING',
            amount: null,
            pendingReason: null,
            complaintContentVersionIds: [],
            authorizationContentVersionIds: [],
          },
        },
      }),
    );
    api.listCases.mockResolvedValue(
      result([
        {
          ...summary(),
          stage: 'WAITING_COMPLAINT' as const,
          canSubmitComplaint: true,
        },
      ]),
    );
    const { wrapper } = await mountList(
      '/cases?view=mine&stageGroup=COMPLAINT_PREPARATION',
    );
    expect(
      wrapper.get('[data-test="continue-complaint-batch-case-1"]').text(),
    ).toBe('核对原请求');
    expect(
      wrapper.find('[data-test="skip-complaint-batch-case-1"]').exists(),
    ).toBe(false);
    await wrapper
      .get('[data-test="continue-complaint-batch-case-1"]')
      .trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('case-1 complaint');
    expect(
      sessionStorage.getItem(
        `case-list-workflow:v1:${encodeURIComponent(identity)}:${encodeURIComponent(caseId)}`,
      ),
    ).toContain('original-key');
    expect(
      wrapper.find('[data-test="skip-complaint-batch-case-1"]').exists(),
    ).toBe(false);
  });

  it('does not let a damaged original request be skipped', async () => {
    const identity = 'owner-1:INTERNAL:department-1:1';
    const caseId = 'case-1';
    sessionStorage.setItem(
      `case-list-workflow:v1:${encodeURIComponent(identity)}:${encodeURIComponent(caseId)}`,
      '{broken',
    );
    api.listCases.mockResolvedValue(
      result([
        {
          ...summary(),
          stage: 'WAITING_COMPLAINT' as const,
          canSubmitComplaint: true,
        },
      ]),
    );
    const { wrapper } = await mountList(
      '/cases?view=mine&stageGroup=COMPLAINT_PREPARATION',
    );
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    await wrapper
      .get('[data-test="start-complaint-batch-complaint"]')
      .trigger('click');
    expect(
      wrapper.get('[data-test="complaint-batch-entry-case-1"]').text(),
    ).toContain('存在未确认的原请求');
    expect(
      wrapper.find('[data-test="skip-complaint-batch-case-1"]').exists(),
    ).toBe(false);
    await wrapper
      .get('[data-test="continue-complaint-batch-case-1"]')
      .trigger('click');
    await flushPromises();
    expect(api.getCase).toHaveBeenCalledExactlyOnceWith(caseId, {
      signal: expect.any(AbortSignal),
    });
    expect(
      sessionStorage.getItem(
        `case-list-workflow:v1:${encodeURIComponent(identity)}:${encodeURIComponent(caseId)}`,
      ),
    ).toBe('{broken');
  });

  it('fails closed when the persisted complaint queue is damaged', async () => {
    const identity = 'owner-1:INTERNAL:department-1:1';
    sessionStorage.setItem(
      `case-list-complaint-batch:v1:${encodeURIComponent(identity)}`,
      '{broken',
    );
    const item = {
      ...summary(),
      stage: 'WAITING_COMPLAINT' as const,
      canSubmitComplaint: true,
    };
    api.listCases.mockResolvedValue(result([item]));
    const { wrapper } = await mountList(
      '/cases?view=mine&stageGroup=COMPLAINT_PREPARATION',
    );
    expect(wrapper.get('[data-test="complaint-batch-queue"]').text()).toContain(
      '无法核对',
    );
    expect(
      wrapper
        .get('[data-test="start-complaint-batch-complaint"]')
        .attributes('disabled'),
    ).toBeDefined();
    await wrapper
      .get('[data-test="start-complaint-batch-complaint"]')
      .trigger('click');
    expect(api.getCase).not.toHaveBeenCalled();
  });

  it('does not advance an archive queue while its result is unknown', async () => {
    workflowTest.markUnknown = true;
    const first = { ...summary(), canArchive: true };
    api.listCases.mockResolvedValue(
      result([first, { ...first, id: 'case-2' }]),
    );
    const { wrapper } = await mountList();
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    await wrapper.get('[data-test="select-case-case-2"]').setValue(true);
    await wrapper.get('[data-test="archive-selected-cases"]').trigger('click');
    await flushPromises();
    expect(api.getCase).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-test="next-archive-case"]').exists()).toBe(
      false,
    );
    expect(
      wrapper
        .get('[data-test="archive-selected-cases"]')
        .attributes('disabled'),
    ).toBeDefined();
  });

  it.each([false, true])(
    'does not queue an archive selection with an unauthorized or nonwaiting case (%s)',
    async (wrongStage) => {
      const first = { ...summary(), canArchive: true };
      const second = {
        ...first,
        id: 'case-2',
        canArchive: wrongStage,
        stage: wrongStage
          ? ('ARCHIVED' as const)
          : ('WAITING_ARCHIVE' as const),
      };
      api.listCases.mockResolvedValue(result([first, second]));
      const { wrapper } = await mountList(
        '/cases?view=department&stage=WAITING_ARCHIVE',
      );
      await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
      await wrapper.get('[data-test="select-case-case-2"]').setValue(true);
      expect(
        wrapper.find('[data-test="archive-selected-cases"]').exists(),
      ).toBe(true);
      expect(
        wrapper
          .get('[data-test="archive-selected-cases"]')
          .attributes('disabled'),
      ).toBeDefined();
    },
  );

  it('handles selected closures one case at a time with a fresh detail read and explicit continuation', async () => {
    const first = {
      ...summary(),
      stage: 'PENDING_MATCH' as const,
      canEarlyClose: true,
      canMatch: true,
    };
    const second = { ...first, id: 'case-2', businessNo: 'CA-2' };
    api.listCases.mockResolvedValue(result([first, second]));
    api.getCase.mockImplementation(async (id: string) => ({ id }));
    const { wrapper } = await mountList('/cases?view=mine&stage=PENDING_MATCH');
    expect(
      wrapper
        .get('tbody tr')
        .find('[data-case-action="early-closure"]')
        .exists(),
    ).toBe(false);
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    await wrapper.get('[data-test="select-case-case-2"]').setValue(true);
    await wrapper.get('[data-test="close-selected-cases"]').trigger('click');
    await flushPromises();
    expect(api.getCase).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('case-1 early-closure');
    (
      document.querySelector(
        '[data-test="workflow-success"]',
      ) as HTMLButtonElement
    ).click();
    await flushPromises();
    expect(api.getCase).toHaveBeenCalledTimes(1);
    await wrapper.get('[data-test="next-closure-case"]').trigger('click');
    await flushPromises();
    expect(api.getCase).toHaveBeenLastCalledWith('case-2', {
      signal: expect.any(AbortSignal),
    });
    expect(document.body.textContent).toContain('case-2 early-closure');
  });

  it('keeps an unknown closure on its own case and does not expose the next case', async () => {
    workflowTest.markUnknown = true;
    const first = {
      ...summary(),
      stage: 'EXECUTING' as const,
      canEarlyClose: true,
    };
    api.listCases.mockResolvedValue(
      result([first, { ...first, id: 'case-2' }]),
    );
    const { wrapper } = await mountList('/cases?view=mine&stage=EXECUTING');
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    await wrapper.get('[data-test="select-case-case-2"]').setValue(true);
    await wrapper.get('[data-test="close-selected-cases"]').trigger('click');
    await flushPromises();
    expect(api.getCase).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-test="next-closure-case"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.get('[data-test="close-selected-cases"]').attributes('disabled'),
    ).toBeDefined();
  });

  it('offers delegated closure when the explicit server capability is present', async () => {
    api.listCases.mockResolvedValue(
      result([
        {
          ...summary(),
          stage: 'EXECUTING',
          canEarlyClose: true,
          owner: { id: 'other', displayName: '其他运营' },
        },
      ]),
    );
    const { wrapper } = await mountList(
      '/cases?view=department&stage=EXECUTING',
    );
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    expect(wrapper.find('[data-test="close-selected-cases"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.get('[data-test="close-selected-cases"]').attributes('disabled'),
    ).toBeUndefined();
    expect(
      wrapper
        .get('tbody tr')
        .find('[data-case-action="early-closure"]')
        .exists(),
    ).toBe(false);
  });

  it('keeps at most one workflow action in a row, with details available through the number', async () => {
    api.listCases.mockResolvedValue(
      result([
        {
          ...summary(),
          canArchive: true,
          canEarlyArchive: true,
          canCorrectClosure: true,
          canUpdateClosureSettlement: true,
        },
      ]),
    );
    const { wrapper } = await mountList();
    const row = wrapper.get('tbody tr');
    expect(row.findAll('[data-case-action]')).toHaveLength(1);
    expect(row.get('[data-case-action="settlement-update"]').text()).toBe(
      '结算更新',
    );
    expect(row.find('[data-case-action="archive"]').exists()).toBe(false);
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    expect(wrapper.get('[data-case-action="archive"]').text()).toBe('归档');
    expect(row.find('[data-test="case-more"]').exists()).toBe(false);
    expect(row.find('[data-test="open-single-early-archive"]').exists()).toBe(
      false,
    );
    expect(
      row.get('td[data-column="businessNo"] a').attributes('href'),
    ).toContain('/cases/case-1');
  });

  it('keeps selection separate from row detail navigation and exposes no routine edit action', async () => {
    const { wrapper, router } = await mountList();
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    expect(wrapper.text()).toContain('已选 1 件');
    expect(wrapper.find('[data-test="edit-selected-case"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="case-toolbar-action"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.get('td[data-column="businessNo"] a').attributes('href'),
    ).toContain('/cases/case-1');
    expect(router.currentRoute.value.path).toBe('/cases');
    await wrapper.get('[data-test="clear-case-selection"]').trigger('click');
    expect(wrapper.text()).not.toContain('已选 1 件');
    expect(router.currentRoute.value.path).toBe('/cases');
  });

  it('does not show a row button when only a correction is available', async () => {
    api.listCases.mockResolvedValue(
      result([{ ...summary(), stage: 'ARCHIVED', canCorrectArchive: true }]),
    );
    const { wrapper } = await mountList();
    const row = wrapper.get('tbody tr');
    expect(row.findAll('[data-case-action]')).toHaveLength(0);
    expect(row.find('td[data-column="rowActions"] button').exists()).toBe(
      false,
    );
    expect(
      row.get('td[data-column="businessNo"] a').attributes('href'),
    ).toContain('/cases/case-1');
  });

  it('hides closure and archive controls on the archived stage while keeping detail entry', async () => {
    api.listCases.mockResolvedValue(
      result([
        {
          ...summary(),
          stage: 'ARCHIVED',
          canArchive: true,
          canRecordClosure: true,
        },
      ]),
    );
    const { wrapper } = await mountList(
      '/cases?view=department&stage=ARCHIVED',
    );
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    expect(wrapper.find('[data-test="close-selected-cases"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="archive-selected-cases"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('td[data-column="businessNo"] a').exists()).toBe(true);
  });

  it('explains disabled selected export without granting export permission', async () => {
    exportApi.capability.mockResolvedValue({ canExport: false });
    const { wrapper } = await mountList();
    const button = wrapper.get('[data-test="export-selected-cases"]');
    expect(button.attributes('title')).toBe('请先勾选案件');
    await wrapper.get('[data-test="select-case-case-1"]').setValue(true);
    await flushPromises();
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.attributes('title')).toBe('暂不可导出，请稍后重试或核对权限');
    await button.trigger('click');
    expect(exportApi.exportSelection).not.toHaveBeenCalled();
  });

  it('exports only the applied route filters and revokes the local download URL', async () => {
    exportApi.capability.mockResolvedValue({ canExport: true });
    const { wrapper } = await mountList(
      '/cases?view=department&stage=WAITING_ARCHIVE&q=已应用&shopName=店铺&defendantName=被告&courtName=法院&lawyerName=律师&caseType=CIVIL&sortBy=rightsHolderName&sortDirection=asc&page=1',
    );
    await wrapper
      .get(
        'input[aria-label="编号、案号、客户、权利主体、店铺、被告、法院、律师"]',
      )
      .setValue('未提交草稿');
    expect(wrapper.find('[data-test="case-query-type"]').exists()).toBe(false);
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
