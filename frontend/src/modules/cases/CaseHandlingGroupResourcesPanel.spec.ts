import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import CaseHandlingGroupResourcesPanel, {
  type DownloadGroupMaterial,
  type GroupMaterialView,
  type GroupResourcePageView,
  type LoadGroupResourcePage,
} from './CaseHandlingGroupResourcesPanel.vue';

const material: GroupMaterialView = {
  kind: 'material',
  caseId: '33333333-3333-4333-8333-333333333333',
  businessNo: 'CA-合成001',
  materialId: 'original-material',
  contentVersionId: 'original-cv',
  fileName: '合成证据.pdf',
  versionLabel: '版本 3',
};
const group = { id: 'group', revision: 1, status: 'ACTIVE' as const };
const page = (
  items: GroupResourcePageView['items'] = [material],
  current = 1,
): GroupResourcePageView => ({
  items,
  page: current,
  pageSize: 20,
  total: 21,
});
const loadPage = vi.fn<LoadGroupResourcePage>();
const downloadMaterial = vi.fn<DownloadGroupMaterial>();
const wrappers: ReturnType<typeof mount>[] = [];
function panel() {
  const wrapper = mount(CaseHandlingGroupResourcesPanel, {
    props: {
      group,
      actorKey: 'actor:INTERNAL:dept',
      contextKey: 'auth1:session1:route1',
      loadPage,
      downloadMaterial,
    },
    global: {
      stubs: {
        RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
      },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}
async function view(wrapper: ReturnType<typeof panel>, section = 'materials') {
  await wrapper.get(`[data-test="view-${section}"]`).trigger('click');
  await flushPromises();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  loadPage.mockResolvedValue(page());
  downloadMaterial.mockResolvedValue();
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

describe('handling group resource component seam', () => {
  it('loads only after an explicit view intent and preserves original material/version identity', async () => {
    const wrapper = panel();
    expect(loadPage).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('选择资料类别后读取');
    await view(wrapper);
    expect(loadPage).toHaveBeenCalledExactlyOnceWith({
      groupId: 'group',
      section: 'materials',
      page: 1,
      pageSize: 20,
      signal: expect.any(AbortSignal),
    });
    expect(wrapper.text()).toContain('CA-合成001');
    expect(wrapper.text()).toContain('合成证据.pdf · 版本 3');
    expect(wrapper.text()).not.toContain(material.caseId);
    expect(wrapper.text()).not.toContain('隐藏');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '下载原版本')!
      .trigger('click');
    await flushPromises();
    expect(downloadMaterial).toHaveBeenCalledExactlyOnceWith(material, {
      signal: expect.any(AbortSignal),
    });
    expect(wrapper.find('a').attributes('href')).toBe(
      `/cases/${material.caseId}`,
    );
    expect(wrapper.text()).not.toMatch(/上传|付款|删除|修改/);
  });
  it('clears the old page while loading and ignores a superseded section response', async () => {
    const old = deferred<GroupResourcePageView>();
    loadPage
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(page([], 1));
    const wrapper = panel();
    await view(wrapper);
    const signal = loadPage.mock.calls[0][0].signal;
    await view(wrapper, 'ledger');
    expect(signal.aborted).toBe(true);
    old.resolve(page());
    await flushPromises();
    expect(wrapper.text()).not.toContain(material.fileName);
    expect(wrapper.text()).toContain('当前页没有可显示的资料');
  });
  it('emits exact next/previous page reads and resets page for another section', async () => {
    const wrapper = panel();
    await view(wrapper);
    loadPage.mockResolvedValueOnce(
      page([{ ...material, fileName: '第二页.pdf' }], 2),
    );
    await wrapper.get('[data-test="resources-next"]').trigger('click');
    expect(wrapper.text()).not.toContain(material.fileName);
    await flushPromises();
    expect(loadPage.mock.calls[1][0]).toMatchObject({
      section: 'materials',
      page: 2,
    });
    expect(
      wrapper.get('[data-test="resources-next"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('[data-test="resources-prev"]').trigger('click');
    await flushPromises();
    expect(loadPage.mock.calls[2][0].page).toBe(1);
    await view(wrapper, 'notary-summary');
    expect(loadPage.mock.calls[3][0]).toMatchObject({
      section: 'notary-summary',
      page: 1,
    });
  });
  it.each([
    { actorKey: 'other:INTERNAL:dept' },
    { contextKey: 'auth2:session1:route1' },
    { contextKey: 'auth1:session2:route1' },
    { contextKey: 'auth1:session1:route2' },
    { group: { ...group, id: 'other-group' } },
    { group: { ...group, revision: 2, status: 'DISSOLVED' as const } },
  ])(
    'aborts reads and clears sensitive projection on context change %j',
    async (change) => {
      const pending = deferred<GroupResourcePageView>();
      const wrapper = panel();
      await view(wrapper);
      expect(wrapper.text()).toContain(material.fileName);
      loadPage.mockReturnValueOnce(pending.promise);
      await view(wrapper);
      const signal = loadPage.mock.calls[1][0].signal;
      await wrapper.setProps(change);
      expect(signal.aborted).toBe(true);
      pending.resolve(page());
      await flushPromises();
      expect(wrapper.text()).not.toContain(material.fileName);
      expect(wrapper.text()).toContain('选择资料类别后读取');
      expect(loadPage).toHaveBeenCalledTimes(2);
    },
  );
  it('keeps fee origins separate and renders decimal text without summing or turning unknown into zero', async () => {
    loadPage.mockResolvedValueOnce(
      page([
        {
          kind: 'notary-summary',
          caseId: material.caseId,
          businessNo: material.businessNo,
          sourceId: 'notary-original',
          sourceType: 'NOTARY_CERTIFICATE_FEE',
          category: 'NOTARY',
          label: '公证费用',
          amount: null,
          stateLabel: '待确认',
        },
      ]),
    );
    const wrapper = panel();
    await view(wrapper, 'notary-summary');
    expect(wrapper.text()).toContain('金额未知');
    expect(wrapper.text()).not.toContain('0.00');
    expect(wrapper.text()).toContain('原公证费用摘要不代表完整费用账');
    expect(wrapper.text()).toContain('来源：公证书费用');
    loadPage.mockResolvedValueOnce(
      page([
        {
          kind: 'ledger',
          caseId: material.caseId,
          businessNo: material.businessNo,
          sourceId: 'fee-original',
          label: '原费用账记录',
          amount: '9007199254740993.01',
          stateLabel: '已登记',
        },
      ]),
    );
    await view(wrapper, 'ledger');
    expect(wrapper.text()).toContain('9007199254740993.01');
    expect(wrapper.text()).not.toContain('金额未知');
    expect(wrapper.text()).not.toContain('合计');
  });
  it('preserves evidence SAMPLE identity and known zero alongside certificate categories', async () => {
    loadPage.mockResolvedValueOnce(
      page([
        {
          kind: 'notary-summary',
          caseId: material.caseId,
          businessNo: material.businessNo,
          sourceId: 'shared-source',
          sourceType: 'NOTARY_CERTIFICATE_FEE',
          category: 'NOTARY',
          label: '公证费用',
          amount: '10.00',
          stateLabel: '已知',
        },
        {
          kind: 'notary-summary',
          caseId: material.caseId,
          businessNo: material.businessNo,
          sourceId: 'shared-source',
          sourceType: 'NOTARY_CERTIFICATE_FEE',
          category: 'DISCLOSURE',
          label: '披露费用',
          amount: null,
          stateLabel: '待确认',
        },
        {
          kind: 'notary-summary',
          caseId: material.caseId,
          businessNo: material.businessNo,
          sourceId: 'shared-source',
          sourceType: 'NOTARY_MATTER_EVIDENCE',
          category: 'SAMPLE',
          label: '样品费用',
          amount: '0.00',
          stateLabel: '已知',
        },
      ]),
    );
    const wrapper = panel();
    await view(wrapper, 'notary-summary');
    expect(wrapper.findAll('li')).toHaveLength(3);
    expect(wrapper.text()).toContain('来源：公证事项证据');
    expect(wrapper.text()).toContain('样品费用 · 已知 · 0.00');
    expect(wrapper.text()).toContain('披露费用 · 待确认 · 金额未知');
    expect(wrapper.text()).not.toContain('合计');
    expect(downloadMaterial).not.toHaveBeenCalled();
  });
  it.each([
    [403, '当前无完整费用账读取权限'],
    [404, '办理组或资料不存在'],
    [500, '资料读取失败'],
  ])(
    'shows an explicit %i failure instead of an empty list',
    async (status, message) => {
      loadPage.mockRejectedValueOnce(
        new ApiError('server-private-message', status, 'FAILED'),
      );
      const wrapper = panel();
      await view(wrapper, 'ledger');
      expect(wrapper.get('[role="alert"]').text()).toContain(message);
      expect(wrapper.text()).not.toContain('server-private-message');
      expect(wrapper.text()).not.toContain('当前页没有');
    },
  );
  it('aborts a download and ignores its late failure on context changes', async () => {
    const pending = deferred<void>();
    downloadMaterial.mockReturnValue(pending.promise);
    const wrapper = panel();
    await view(wrapper);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '下载原版本')!
      .trigger('click');
    const signal = downloadMaterial.mock.calls[0][1].signal;
    await wrapper.setProps({ contextKey: 'next-session' });
    expect(signal.aborted).toBe(true);
    pending.reject(new ApiError('late', 403, 'FORBIDDEN'));
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain(material.fileName);
  });
  it('aborts pending work on unmount', async () => {
    const pending = deferred<GroupResourcePageView>();
    loadPage.mockReturnValue(pending.promise);
    const wrapper = panel();
    await view(wrapper);
    const signal = loadPage.mock.calls[0][0].signal;
    wrapper.unmount();
    expect(signal.aborted).toBe(true);
    pending.resolve(page());
    await flushPromises();
  });
});
