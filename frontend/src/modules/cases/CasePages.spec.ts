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
}));
vi.mock('../../api/cases', () => ({
  listCases: api.listCases,
  getCase: api.getCase,
  matchCase: api.matchCase,
  todayShanghai: () => '2026-09-29',
}));
vi.mock('../../api/materials', () => ({ downloadMaterialVersion: vi.fn() }));

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
        sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
        sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    counts: { PENDING_MATCH: 1, WAITING_COMPLAINT: 0 },
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
  });
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
