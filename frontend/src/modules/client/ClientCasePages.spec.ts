import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/auth';
import ClientCaseDetailPage from './ClientCaseDetailPage.vue';
import ClientCaseListPage from './ClientCaseListPage.vue';
const api = vi.hoisted(() => ({
  listClientCases: vi.fn(),
  getClientCase: vi.fn(),
}));
vi.mock('../../api/client-cases', () => api);
vi.mock('../../api/materials', () => ({ downloadMaterialVersion: vi.fn() }));
vi.mock('../cases', () => ({
  CaseComplaintMailingPanel: {
    props: ['item', 'client'],
    template:
      '<div data-test="mail-panel">{{ item.stage }} {{ item.canMailComplaint ? "办理" : "只读" }}</div>',
  },
}));
const list = {
  items: [
    {
      id: 'case-1',
      businessNo: 'CA-001',
      stage: 'WAITING_COMPLAINT_STAMP',
      version: 2,
      canMailComplaint: false,
      rightsHolderName: '权利人甲',
      defendantNames: ['被告甲'],
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
};
const detail = {
  ...list.items[0],
  confirmedAmountState: 'KNOWN',
  confirmedAmount: '123.45',
  confirmedAt: '2026-10-02T00:00:00Z',
  complaintFile: {
    materialId: 'm-1',
    contentVersionId: 'v-1',
    originalFilename: '诉状.pdf',
    mimeType: 'application/pdf',
  },
  authorizationFiles: [],
  pendingReceiptFiles: [],
  complaintMailing: null,
};
let pinia = createPinia();
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore(pinia).session = {
    principalType: 'CLIENT',
    authorizationRevision: 1,
    user: { id: 'client-1' },
  } as never;
  api.listClientCases.mockResolvedValue(list);
  api.getClientCase.mockImplementation(async () => detail);
});
async function mountPage(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/client/cases', component: ClientCaseListPage },
      { path: '/client/cases/:id', component: ClientCaseDetailPage },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(
    path.endsWith('cases') ? ClientCaseListPage : ClientCaseDetailPage,
    { global: { plugins: [pinia, router] } },
  );
  await flushPromises();
  return { wrapper, router };
}
describe('client case pages', () => {
  it('loads the default pending enterprise queue and identifies each case', async () => {
    const { wrapper } = await mountPage('/client/cases');
    expect(api.listClientCases).toHaveBeenCalledWith(
      1,
      20,
      'PENDING',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.get('[data-test="client-case-list"]').text()).toContain(
      '权利人甲',
    );
    expect(wrapper.get('[data-test="client-case-list"]').text()).toContain(
      '被告甲',
    );
    expect(
      wrapper.get('[data-test="client-case-list"] a').attributes('href'),
    ).toBe('/client/cases/case-1');
  });
  it('shows only the minimal client facts and no mailing action for a read-only case', async () => {
    const { wrapper } = await mountPage('/client/cases/case-1');
    expect(wrapper.text()).toContain('¥ 123.45');
    expect(wrapper.text()).toContain('只读');
    expect(wrapper.text()).not.toContain('负责人');
    expect(wrapper.find('[data-test="mailing-submit"]').exists()).toBe(false);
  });
  it('shows the new stage label while keeping internal filing facts out of the client page', async () => {
    api.listClientCases.mockResolvedValueOnce({
      ...list,
      items: [{ ...list.items[0], stage: 'WAITING_FORMAL_ACCEPTANCE' }],
    });
    const listPage = await mountPage('/client/cases');
    expect(listPage.wrapper.text()).toContain('待正式立案');

    api.getClientCase.mockResolvedValueOnce({
      ...detail,
      stage: 'WAITING_FORMAL_ACCEPTANCE',
    });
    const detailPage = await mountPage('/client/cases/case-1');
    expect(detailPage.wrapper.text()).toContain('待正式立案');
    expect(detailPage.wrapper.text()).not.toContain('提交立案记录');
    expect(detailPage.wrapper.text()).not.toContain('甲市中级人民法院');
  });
  it('ignores a late detail response after changing cases and reloads after an authorization revision change', async () => {
    let finish!: (value: typeof detail) => void;
    api.getClientCase.mockImplementation((id: string) =>
      id === 'case-1'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ ...detail, id: 'case-2', businessNo: 'CA-002' }),
    );
    const { wrapper, router } = await mountPage('/client/cases/case-1');
    await router.push('/client/cases/case-2');
    await flushPromises();
    expect(wrapper.text()).toContain('CA-002');
    finish(detail);
    await flushPromises();
    expect(wrapper.text()).not.toContain('CA-001');
    const auth = useAuthStore(pinia);
    auth.session = {
      principalType: 'CLIENT',
      authorizationRevision: 2,
      user: { id: 'client-2' },
    } as never;
    await flushPromises();
    expect(api.getClientCase).toHaveBeenCalledTimes(3);
  });
});
