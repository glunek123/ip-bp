import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CaseListPage from './CaseListPage.vue';
import CaseDetailPage from './CaseDetailPage.vue';

const api = vi.hoisted(() => ({ listCases: vi.fn(), getCase: vi.fn() }));
vi.mock('../../api/cases', () => ({
  listCases: api.listCases,
  getCase: api.getCase,
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
        sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
        sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  });
  api.getCase.mockResolvedValue({
    id: 'case-1',
    businessNo: 'CA-1',
    stage: 'PENDING_MATCH',
    createdAt: '2026-09-28T00:00:00Z',
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
  });
});
afterEach(() => vi.unstubAllGlobals());

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

  it('shows source, ownership, fee provenance and no invented court number', async () => {
    const wrapper = await mountRoute('/cases/case-1', CaseDetailPage);
    expect(wrapper.text()).toContain('客户甲');
    expect(wrapper.text()).toContain('来源公证事项：NZ-1');
    expect(wrapper.text()).toContain('来自公证事项取证记录');
    expect(wrapper.text()).toContain('法院案号：未登记');
    expect(wrapper.text()).not.toContain('/notary-portal/matters/');
  });
});
