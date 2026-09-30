import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CaseListPage from './CaseListPage.vue';
import CaseDetailPage from './CaseDetailPage.vue';
import { workflowChangedEvent } from '../../app/workflow-events';

const api = vi.hoisted(() => ({
  listCases: vi.fn(),
  getCase: vi.fn(),
  matchCase: vi.fn(),
  submitComplaint: vi.fn(),
  uploadMaterialFile: vi.fn(),
  listOwnerMaterials: vi.fn(),
}));
vi.mock('../../api/cases', () => ({
  listCases: api.listCases,
  getCase: api.getCase,
  matchCase: api.matchCase,
  submitComplaint: api.submitComplaint,
  todayShanghai: () => '2026-09-29',
}));
vi.mock('../../api/materials', () => ({
  downloadMaterialVersion: vi.fn(),
  uploadMaterialFile: api.uploadMaterialFile,
  listOwnerMaterials: api.listOwnerMaterials,
}));

beforeEach(() => {
  vi.resetAllMocks();
  api.listCases.mockResolvedValue({
    items: [
      {
        id: 'case-1',
        businessNo: 'CA-1',
        stage: 'PENDING_MATCH',
        createdAt: '2026-09-28T00:00:00Z',
        version: 1,
        owner: { id: 'user-1', displayName: '负责人' },
        canMatch: true,
        canSubmitComplaint: false,
        sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
        sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    counts: {
      PENDING_MATCH: 1,
      WAITING_COMPLAINT: 0,
      WAITING_COMPLAINT_CONFIRMATION: 0,
    },
  });
  api.getCase.mockResolvedValue({
    id: 'case-1',
    businessNo: 'CA-1',
    stage: 'PENDING_MATCH',
    createdAt: '2026-09-28T00:00:00Z',
    version: 1,
    canMatch: true,
    courtCaseNo: null,
    department: { id: 'department-1', name: '知产部' },
    customer: { id: 'customer-1', name: '客户甲' },
    rightsHolder: { id: 'holder-1', name: '权利人甲' },
    owner: { id: 'user-1', displayName: '负责人' },
    sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
    sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
    certificate: {
      certificateNo: 'Z-100',
      certificateDate: '2026-09-28',
      issuedAt: '2026-09-28T00:00:00Z',
      needDisclose: false,
      files: [],
      disclosureFiles: [],
    },
    fees: [
      {
        category: 'SAMPLE',
        state: 'KNOWN',
        amount: '12.00',
        sourceType: 'NOTARY_MATTER_EVIDENCE',
        sourceId: 'evidence-1',
      },
    ],
    defendants: [],
    lawyers: [],
    matchedAt: null,
    matchedOn: null,
    canSubmitComplaint: false,
    complaint: null,
  });
  api.listOwnerMaterials.mockResolvedValue({ items: [], total: 0 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountRoute(
  path: string,
  component: typeof CaseListPage | typeof CaseDetailPage,
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/cases', component: CaseListPage },
      { path: '/cases/:id', component: CaseDetailPage },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(component, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('case pages', () => {
  it('lists source identities and links to the internal read-only detail', async () => {
    const wrapper = await mountRoute('/cases', CaseListPage);
    expect(wrapper.get('[data-test="case-list"]').text()).toContain('LD-1');
    expect(wrapper.get('[data-test="case-list"]').text()).toContain('NZ-1');
    expect(wrapper.get('a[href="/cases/case-1"]').text()).toBe('CA-1');
  });

  it('labels an actionable complaint case as writable in the list', async () => {
    const base = await api.listCases();
    api.listCases.mockResolvedValueOnce({
      ...base,
      items: [
        {
          ...base.items[0],
          stage: 'WAITING_COMPLAINT',
          canMatch: false,
          canSubmitComplaint: true,
        },
      ],
    });
    const wrapper = await mountRoute('/cases', CaseListPage);
    expect(wrapper.get('[data-test="case-list"]').text()).toContain('办理');
    expect(wrapper.get('[data-test="case-list"]').text()).not.toContain('只读');
  });

  it('uses sidebar scope and stage query and preserves them when opening a case', async () => {
    const wrapper = await mountRoute(
      '/cases?view=department&stage=WAITING_COMPLAINT',
      CaseListPage,
    );
    expect(api.listCases).toHaveBeenCalledWith(
      1,
      20,
      expect.objectContaining({
        view: 'department',
        stage: 'WAITING_COMPLAINT',
      }),
    );
    expect(wrapper.get('a').attributes('href')).toBe(
      '/cases/case-1?view=department&stage=WAITING_COMPLAINT',
    );
  });

  it('shows source, ownership, fee provenance and no invented court number', async () => {
    const wrapper = await mountRoute('/cases/case-1', CaseDetailPage);
    expect(wrapper.text()).toContain('客户甲');
    expect(wrapper.text()).toContain('来源公证事项：NZ-1');
    expect(wrapper.text()).toContain('来自公证事项取证记录');
    expect(wrapper.text()).toContain('法院案号：未登记');
    expect(wrapper.text()).not.toContain('/notary-portal/matters/');
  });

  it('uploads both complaint material groups separately, then confirms exact versions', async () => {
    const base = await api.getCase();
    const before = {
      ...base,
      stage: 'WAITING_COMPLAINT',
      canSubmitComplaint: true,
      version: 7,
    };
    const after = {
      ...base,
      stage: 'WAITING_COMPLAINT_CONFIRMATION',
      canSubmitComplaint: false,
      version: 8,
      complaint: {
        amountState: 'KNOWN',
        amount: '0',
        pendingReason: null,
        submittedAt: '2026-09-30T01:00:00Z',
        submittedByUserId: 'user-1',
        complaintFiles: [],
        authorizationFiles: [],
      },
    };
    api.getCase.mockReset();
    api.getCase.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    api.uploadMaterialFile
      .mockResolvedValueOnce({
        materialId: 'complaint-material',
        contentVersionId: 'complaint-v1',
        originalFilename: '诉状.pdf',
        mimeType: 'application/pdf',
      })
      .mockResolvedValueOnce({
        materialId: 'authorization-material',
        contentVersionId: 'authorization-v1',
        originalFilename: '授权书.pdf',
        mimeType: 'application/pdf',
      });
    api.submitComplaint.mockResolvedValue(undefined);

    const wrapper = await mountRoute('/cases/case-1', CaseDetailPage);
    const form = wrapper.get('[data-test="complaint-submit-form"]');
    expect(form.text()).toContain('上传不会推进案件');
    expect(form.text()).not.toContain('确认诉状');
    await wrapper.get('[data-test="submit-complaint"]').trigger('click');
    expect(wrapper.text()).toContain('请至少上传 1 份起诉状和 1 份授权材料。');
    expect(api.submitComplaint).not.toHaveBeenCalled();

    for (const [index, filename] of ['诉状.pdf', '授权书.pdf'].entries()) {
      const input = wrapper.findAll('input[type="file"]')[index]!;
      Object.defineProperty(input.element, 'files', {
        configurable: true,
        value: [new File(['content'], filename, { type: 'application/pdf' })],
      });
      await input.trigger('change');
      await flushPromises();
    }
    expect(api.getCase).toHaveBeenCalledTimes(1);
    await wrapper
      .get('[data-test="complaint-submit-form"] input[inputmode="decimal"]')
      .setValue('0');
    await wrapper.get('[data-test="submit-complaint"]').trigger('click');
    await flushPromises();
    expect(api.submitComplaint).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({
        expectedVersion: 7,
        amountState: 'KNOWN',
        amount: '0',
        complaintContentVersionIds: ['complaint-v1'],
        authorizationContentVersionIds: ['authorization-v1'],
      }),
    );
    expect(wrapper.text()).toContain('当前阶段为诉状待确认');
    expect(wrapper.find('[data-test="complaint-submit-form"]').exists()).toBe(
      false,
    );
  });

  it('saves defendants and lawyer, reloads detail, and confirms the real transition', async () => {
    api.matchCase.mockResolvedValue(undefined);
    const wrapper = await mountRoute('/cases/case-1', CaseDetailPage);
    const eventSpy = vi.spyOn(window, 'dispatchEvent');
    api.getCase.mockResolvedValueOnce({
      id: 'case-1',
      businessNo: 'CA-1',
      stage: 'WAITING_COMPLAINT',
      createdAt: '2026-09-28T00:00:00Z',
      version: 2,
      canMatch: false,
      owner: { id: 'user-1', displayName: '负责人' },
      courtCaseNo: null,
      department: { id: 'department-1', name: '知产部' },
      customer: { id: 'customer-1', name: '客户甲' },
      rightsHolder: { id: 'holder-1', name: '权利人甲' },
      sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
      sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
      certificate: {
        certificateNo: 'Z-100',
        certificateDate: '2026-09-28',
        issuedAt: '2026-09-28T00:00:00Z',
        needDisclose: false,
        files: [],
        disclosureFiles: [],
      },
      fees: [],
      defendants: [
        {
          id: 'defendant-1',
          kind: 'PERSON',
          name: '被告甲',
          idNo: null,
          phone: null,
          address: null,
        },
      ],
      lawyers: [],
      matchedAt: '2026-09-29T01:00:00Z',
      matchedOn: '2026-09-28',
    });
    const form = wrapper.get('[data-test="case-match-form"]');
    expect(
      form
        .findAll('label')
        .find((label) => label.text().includes('律师事务所'))
        ?.text(),
    ).toBe('律师事务所（选填）');
    expect(
      (form.get('input[type="date"]').element as HTMLInputElement).value,
    ).toBe('2026-09-29');
    await form.get('input[type="date"]').setValue('2026-09-28');
    await form.findAll('input')[1]!.setValue('被告甲');
    await form.findAll('input')[5]!.setValue('律师甲');
    await wrapper
      .findAll('[data-test="case-match-form"] button')
      .find((button) => button.text().includes('确认匹配'))!
      .trigger('click');
    await flushPromises();
    expect(api.matchCase).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({
        defendants: [
          expect.objectContaining({ name: '被告甲', kind: 'PERSON' }),
        ],
        lawyer: expect.objectContaining({
          fullName: '律师甲',
          lawFirm: '',
        }),
        matchedOn: '2026-09-28',
      }),
    );
    expect(api.getCase).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('案件匹配已完成');
    expect(wrapper.find('[data-test="case-match-form"]').exists()).toBe(false);
    expect(eventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: workflowChangedEvent }),
    );
  });

  it('explains read-only access after matching as well as while awaiting matching', async () => {
    const pending = await api.getCase();
    api.getCase.mockResolvedValueOnce({
      ...pending,
      stage: 'WAITING_COMPLAINT',
      canMatch: false,
      matchedAt: '2026-09-29T01:00:00Z',
      matchedOn: null,
    });
    const wrapper = await mountRoute('/cases/case-1', CaseDetailPage);
    expect(wrapper.find('[data-test="case-match-form"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="case-read-only"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="case-read-only"]').text()).toContain(
      '查看案件和下载获准材料',
    );
    expect(wrapper.get('[data-test="case-read-only"]').text()).toContain(
      '匹配已完成',
    );
    expect(wrapper.text()).toContain('实际匹配日期：未记录');
    expect(wrapper.text()).toContain('系统登记时间');
  });

  it('does not expose matching controls when the case is not actionable', async () => {
    api.getCase.mockResolvedValueOnce({
      id: 'case-1',
      businessNo: 'CA-1',
      stage: 'PENDING_MATCH',
      createdAt: '2026-09-28T00:00:00Z',
      version: 1,
      canMatch: false,
      owner: { id: 'user-1', displayName: '同部门负责人' },
      courtCaseNo: null,
      department: { id: 'department-1', name: '知产部' },
      customer: { id: 'customer-1', name: '客户甲' },
      rightsHolder: { id: 'holder-1', name: '权利人甲' },
      sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
      sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
      certificate: {
        certificateNo: 'Z-100',
        certificateDate: '2026-09-28',
        issuedAt: '2026-09-28T00:00:00Z',
        needDisclose: false,
        files: [],
        disclosureFiles: [],
      },
      fees: [],
      defendants: [],
      lawyers: [],
      matchedAt: null,
      matchedOn: null,
    });
    const wrapper = await mountRoute('/cases/case-1', CaseDetailPage);
    expect(wrapper.find('[data-test="case-match-form"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="case-read-only"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="case-read-only"]').text()).toContain(
      '当前账号不能办理此案',
    );
  });
});
