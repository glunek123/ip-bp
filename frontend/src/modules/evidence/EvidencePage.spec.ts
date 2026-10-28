import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EvidencePage from './EvidencePage.vue';

const api = vi.hoisted(() => ({
  listEvidence: vi.fn(),
  matchingEvidenceIds: vi.fn(),
  getEvidenceGroup: vi.fn(),
  getEvidenceItemGroup: vi.fn(),
  getEvidenceSourceGroup: vi.fn(),
  listEvidenceGroups: vi.fn(),
  saveEvidenceGroup: vi.fn(),
  saveEvidenceSourceGroup: vi.fn(),
  bulkEvidenceStatus: vi.fn(),
  exportSelectedEvidence: vi.fn(),
}));
vi.mock('../../api/evidence', () => api);
const materials = vi.hoisted(() => ({ downloadMaterialVersion: vi.fn() }));
vi.mock('../../api/materials', () => materials);
const transport = vi.hoisted(() => ({ requestJson: vi.fn() }));
vi.mock('../../api/http', async (original) => ({
  ...(await original<typeof import('../../api/http')>()),
  ...transport,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const first = {
  id: 'item-a',
  caseId: 'case-1',
  groupId: 'case-1',
  displayCode: 'EV-A',
  shelfLocation: null,
  status: 'UNDELIVERED',
  remark: null,
  provenance: '公证购买',
  name: '实物',
  kind: 'PHYSICAL',
  collectedOn: null,
  keeperName: null,
  platform: 'TAOBAO',
  shopName: '测试店铺',
  caseNo: 'CASE-1',
  stage: 'WAITING_HEARING',
  lawyerName: 'Lin',
  hearingOn: null,
  closedOn: null,
  paperCertificates: [
    {
      id: 'paper-1',
      number: 'N1',
      status: 'NOT_ISSUED',
      issuedOn: null,
      officeName: null,
      pages: null,
      contentVersionId: null,
      contentMaterialId: null,
      electronicFiles: [],
    },
    {
      id: 'paper-2',
      number: 'N2',
      status: 'MAILED_TO_LAWYER',
      issuedOn: null,
      officeName: null,
      pages: null,
      contentVersionId: null,
      contentMaterialId: null,
      electronicFiles: [],
    },
  ],
};
const second = {
  ...first,
  id: 'item-b',
  displayCode: 'EV-B',
  paperCertificates: [],
};
const counts = {
  statuses: {
    ALL: 2,
    UNDELIVERED: 2,
    IN_STOCK: 0,
    MAILED_TO_LAWYER: 0,
    DESTROYED: 0,
  },
  stages: { WAITING_HEARING: 1 },
  allStageCases: 1,
};

beforeEach(() => {
  vi.resetAllMocks();
  api.matchingEvidenceIds.mockResolvedValue(['item-a', 'item-b']);
  api.listEvidence.mockResolvedValue({
    items: [first, second],
    total: 2,
    page: 1,
    pageSize: 20,
    counts,
  });
  api.getEvidenceGroup.mockResolvedValue({
    groupId: 'case-1',
    groupVersion: 1,
    sourceKind: 'NOTARY_MATTER',
    sourceId: 'matter-1',
    sourceVersion: 5,
    case: {
      id: 'case-1',
      platform: 'TAOBAO',
      shopName: '测试店铺',
      caseNo: 'CASE-1',
      stage: 'WAITING_HEARING',
      lawyerName: 'Lin',
    },
    items: [first, second],
    paperCertificates: first.paperCertificates,
  });
  api.getEvidenceItemGroup.mockImplementation((itemId: string) =>
    api.getEvidenceGroup(itemId),
  );
});

describe('EvidencePage', () => {
  function sourceGroup(sourceId: string, shopName: string) {
    return {
      groupId: null,
      groupVersion: 0,
      sourceKind: 'CASE' as const,
      sourceId,
      sourceVersion: 7,
      case: {
        id: sourceId,
        platform: 'TAOBAO',
        shopName,
        caseNo: `NO-${sourceId}`,
        stage: 'WAITING_HEARING',
        lawyerName: '办案律师',
      },
      items: [],
      paperCertificates: [],
    };
  }
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (cause: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  }
  async function mountSource(sourceId: string) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/evidence', component: EvidencePage }],
    });
    await router.push({
      path: '/evidence',
      query: { entrySourceKind: 'CASE', entrySourceId: sourceId },
    });
    await router.isReady();
    const wrapper = mount(EvidencePage, { global: { plugins: [router] } });
    return { router, wrapper };
  }

  it('opens the existing source editor from a case-detail entry and creates the first manual evidence row', async () => {
    const source = {
      groupId: null,
      groupVersion: 0,
      sourceKind: 'CASE',
      sourceId: 'case-empty',
      sourceVersion: 7,
      case: {
        id: 'case-empty',
        platform: 'TAOBAO',
        shopName: '空案件店铺',
        caseNo: 'CASE-EMPTY',
        stage: 'WAITING_HEARING',
        lawyerName: '办案律师',
      },
      items: [],
      paperCertificates: [],
    };
    api.getEvidenceSourceGroup.mockResolvedValue(source);
    api.saveEvidenceSourceGroup.mockResolvedValue({
      changed: true,
      group: {
        ...source,
        groupId: 'group-new',
        groupVersion: 1,
        items: [
          {
            ...first,
            id: 'item-new',
            groupId: 'group-new',
            caseId: 'case-empty',
            displayCode: 'EV-NEW',
            shelfLocation: 'A-01',
            status: 'IN_STOCK',
          },
        ],
      },
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/evidence', component: EvidencePage }],
    });
    await router.push({
      path: '/evidence',
      query: { entrySourceKind: 'CASE', entrySourceId: 'case-empty' },
    });
    await router.isReady();
    const wrapper = mount(EvidencePage, { global: { plugins: [router] } });
    await flushPromises();

    expect(api.getEvidenceSourceGroup).toHaveBeenCalledWith(
      'CASE',
      'case-empty',
    );
    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe(
      '编辑证物',
    );
    expect(wrapper.text()).not.toContain('选择案件编辑证物');
    await wrapper.get('input[aria-label="证物编号"]').setValue('EV-NEW');
    await wrapper.get('input[aria-label="货架号"]').setValue('A-01');
    await wrapper
      .findAll('[role="dialog"] button')
      .find((button) => button.text() === '保存')!
      .trigger('click');
    await flushPromises();

    expect(api.saveEvidenceSourceGroup).toHaveBeenCalledWith(
      'CASE',
      'case-empty',
      expect.objectContaining({
        expectedSourceVersion: 7,
        expectedGroupVersion: 0,
        rows: [
          expect.objectContaining({
            displayCode: 'EV-NEW',
            shelfLocation: 'A-01',
            status: 'IN_STOCK',
          }),
        ],
      }),
      expect.any(String),
    );
    expect(router.currentRoute.value.query.entrySourceId).toBeUndefined();
    wrapper.unmount();
  });

  it('keeps a late list-group response from replacing the selected case source editor', async () => {
    const firstGroup = await api.getEvidenceGroup();
    const pendingListGroup = deferred<typeof firstGroup>();
    api.getEvidenceGroup.mockReturnValue(pendingListGroup.promise);
    api.getEvidenceSourceGroup.mockImplementation(
      (_kind: string, sourceId: string) =>
        Promise.resolve(
          sourceGroup(
            sourceId,
            sourceId === 'case-a' ? '来源甲店铺' : '来源乙店铺',
          ),
        ),
    );
    const { router, wrapper } = await mountSource('case-a');
    await flushPromises();

    await wrapper.get('tbody tr').trigger('click');
    expect(api.getEvidenceGroup).toHaveBeenCalledWith('case-1');
    await router.replace({
      path: '/evidence',
      query: { entrySourceKind: 'CASE', entrySourceId: 'case-b' },
    });
    await flushPromises();
    expect(wrapper.get('[role="dialog"]').text()).toContain('来源乙店铺');

    pendingListGroup.resolve(firstGroup);
    await flushPromises();

    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe(
      '编辑证物',
    );
    expect(wrapper.get('[role="dialog"]').text()).toContain('来源乙店铺');
    expect(wrapper.get('[role="dialog"]').text()).not.toContain('测试店铺');
    wrapper.unmount();
  });

  it('does not reopen a source editor when its URL is cleared before the read returns', async () => {
    const pendingSource = deferred<ReturnType<typeof sourceGroup>>();
    api.getEvidenceSourceGroup.mockReturnValue(pendingSource.promise);
    const { router, wrapper } = await mountSource('case-a');
    await flushPromises();
    expect(api.getEvidenceSourceGroup).toHaveBeenCalledWith('CASE', 'case-a');

    await router.replace('/evidence');
    await flushPromises();
    pendingSource.resolve(sourceGroup('case-a', '来源甲店铺'));
    await flushPromises();

    expect(router.currentRoute.value.query.entrySourceId).toBeUndefined();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('来源甲店铺');
    expect(api.saveEvidenceSourceGroup).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('clears the prior source editor before showing a permission error for a new source', async () => {
    api.getEvidenceSourceGroup.mockImplementation(
      (_kind: string, sourceId: string) =>
        sourceId === 'case-a'
          ? Promise.resolve(sourceGroup('case-a', '来源甲店铺'))
          : Promise.reject(new Error('当前账号无权查看证物')),
    );
    const { router, wrapper } = await mountSource('case-a');
    await flushPromises();
    expect(wrapper.get('[role="dialog"]').text()).toContain('来源甲店铺');

    await router.replace({
      path: '/evidence',
      query: { entrySourceKind: 'CASE', entrySourceId: 'case-b' },
    });
    await flushPromises();

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toBe('当前账号无权查看证物');
    expect(wrapper.text()).not.toContain('来源甲店铺');
    expect(api.saveEvidenceSourceGroup).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('does not open the previously selected evidence while a new filter is loading', async () => {
    const wrapper = mount(EvidencePage);
    await flushPromises();
    await wrapper.get('tbody tr input[type=checkbox]').setValue(true);
    api.listEvidence.mockImplementationOnce(() => new Promise(() => {}));
    await wrapper.get('input[placeholder="搜索办案律师…"]').setValue('新筛选');
    const edit = wrapper
      .findAll('button')
      .find((button) => button.text() === '编辑');
    expect(edit?.attributes('disabled')).toBeDefined();
    await wrapper.get('tbody tr').trigger('click');
    expect(api.getEvidenceGroup).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('groups page and list actions and keeps the empty table structure available', async () => {
    api.listEvidence.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      counts: {
        statuses: {
          ALL: 0,
          UNDELIVERED: 0,
          IN_STOCK: 0,
          MAILED_TO_LAWYER: 0,
          DESTROYED: 0,
        },
        stages: {},
        allStageCases: 0,
      },
    });
    const wrapper = mount(EvidencePage);
    await flushPromises();

    expect(wrapper.get('h1.sr-only').text()).toBe('证物管理');
    expect(wrapper.text()).not.toContain('选择案件编辑证物');
    expect(
      wrapper
        .find('.filters')
        .element.compareDocumentPosition(wrapper.find('.list-card').element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(wrapper.find('.list-card > .actions.operation-bar').exists()).toBe(
      true,
    );
    expect(
      wrapper
        .find('.list-card > .actions')
        .element.compareDocumentPosition(wrapper.find('.table-wrap').element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(wrapper.find('.table-wrap').exists()).toBe(true);
    expect(wrapper.text()).toContain('没有匹配的证物');
    expect(wrapper.find('.pager.operation-bar').exists()).toBe(false);
    wrapper.unmount();
  });

  it('hides pagination when one page contains all evidence', async () => {
    api.listEvidence.mockResolvedValueOnce({
      items: [first],
      total: 1,
      page: 1,
      pageSize: 20,
      counts,
    });
    const wrapper = mount(EvidencePage);
    await flushPromises();

    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    expect(wrapper.find('.pager.operation-bar').exists()).toBe(false);
    wrapper.unmount();
  });

  it('keeps a previous-page path when page two reports a shrunken total', async () => {
    api.listEvidence.mockImplementation(
      (requestedFilter: { page?: number }) => {
        const requestedPage = requestedFilter.page ?? 1;
        return Promise.resolve({
          items: requestedPage === 1 ? [first, second] : [first],
          total: requestedPage === 1 ? 21 : 1,
          page: requestedPage,
          pageSize: 20,
          counts,
        });
      },
    );
    const wrapper = mount(EvidencePage);
    await flushPromises();
    await wrapper.get('.pager button:last-child').trigger('click');
    await flushPromises();

    const pager = wrapper.get('.pager.operation-bar');
    expect(pager.text()).toContain('第 2 页');
    expect(pager.findAll('button')[0]!.attributes('disabled')).toBeUndefined();
    expect(pager.findAll('button')[1]!.attributes('disabled')).toBeDefined();
    await pager.findAll('button')[0]!.trigger('click');
    await flushPromises();
    expect(api.listEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1 }),
      expect.anything(),
    );
    wrapper.unmount();
  });

  it('searches, selects and clears the server-filtered progress multi-select', async () => {
    const wrapper = mount(EvidencePage);
    await flushPromises();

    expect(wrapper.findAll('.stage-filter .el-select')).toHaveLength(1);
    const search = wrapper.find('.stage-filter input');
    await search.setValue('待匹配');
    await wrapper.find('.stage-filter .el-select__wrapper').trigger('click');
    await flushPromises();
    const option = document.body.querySelector<HTMLElement>(
      '.evidence-stage-options .el-select-dropdown__item',
    );
    expect(option?.textContent).toContain('待匹配');
    option?.click();
    await flushPromises();
    expect(wrapper.find('.stage-filter').text()).toContain('已选 1 项');
    expect(api.listEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({ stages: ['PENDING_MATCH'] }),
      expect.any(Object),
    );
    wrapper
      .findComponent({ name: 'ElSelect' })
      .vm.$emit('update:modelValue', []);
    await flushPromises();
    expect(wrapper.find('.stage-filter').text()).toContain('已选 0 项');
    expect(api.listEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({ stages: [] }),
      expect.any(Object),
    );
    wrapper.unmount();
  });

  it('sends one-sided hearing and closing dates unchanged to the server filters', async () => {
    const wrapper = mount(EvidencePage);
    await flushPromises();
    const hearing = wrapper.get('[aria-label="开庭日期"]');
    expect((hearing.element as HTMLDetailsElement).open).toBe(false);
    await hearing.get('summary').trigger('click');
    await hearing.findAll('input')[0]!.setValue('2026-03-04');
    await flushPromises();
    expect(
      hearing.findAll('.range-value').map((value) => value.text()),
    ).toEqual(['2026-03-04', '结束日期']);
    expect(api.listEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({ hearFrom: '2026-03-04' }),
      expect.any(Object),
    );

    const closing = wrapper.get('[aria-label="结案日期"]');
    await closing.get('summary').trigger('click');
    await closing.findAll('input')[1]!.setValue('2026-03-31');
    await flushPromises();
    expect(
      closing.findAll('.range-value').map((value) => value.text()),
    ).toEqual(['开始日期', '2026-03-31']);
    expect(api.listEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({
        hearFrom: '2026-03-04',
        closeTo: '2026-03-31',
      }),
      expect.any(Object),
    );
    await hearing.get('summary').trigger('click');
    await hearing.get('summary').trigger('click');
    await hearing.get('.panel-actions button').trigger('click');
    await flushPromises();
    expect(hearing.find('summary').text()).toContain('开始日期');
    expect(hearing.find('summary').text()).toContain('结束日期');
    expect(api.listEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({ hearFrom: undefined, hearTo: undefined }),
      expect.any(Object),
    );
    await hearing.get('.panel-actions button:last-child').trigger('click');
    expect((hearing.element as HTMLDetailsElement).open).toBe(false);
    wrapper.unmount();
  });

  it.each([
    { filename: '证物清单.csv', csv: '' },
    { filename: '证物清单.csv', csv: ' \t\r\n\u3000' },
    { filename: '', csv: '编号\r\nEV-1\r\n' },
    { filename: ' \t\r\n\u3000', csv: '编号\r\nEV-1\r\n' },
  ])(
    'shows the actual export decoder error without downloading or reporting success: %j',
    async (response) => {
      const actual =
        await vi.importActual<typeof import('../../api/evidence')>(
          '../../api/evidence',
        );
      api.exportSelectedEvidence.mockImplementation(
        actual.exportSelectedEvidence,
      );
      transport.requestJson.mockResolvedValue(response);
      const createObjectURL = vi.fn(() => 'blob:export');
      vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      const wrapper = mount(EvidencePage);
      try {
        await flushPromises();
        await wrapper.find('input[aria-label="选择证物 EV-A"]').setValue(true);
        await wrapper
          .findAll('button')
          .filter((button) => button.text() === '导出清单')[0]
          .trigger('click');
        await flushPromises();
        expect(wrapper.find('[role="alert"]').text()).toBe(
          '证物接口响应格式无效',
        );
        expect(createObjectURL).not.toHaveBeenCalled();
        expect(click).not.toHaveBeenCalled();
        expect(wrapper.text()).not.toContain('已导出所选');
        expect(api.exportSelectedEvidence).toHaveBeenCalledWith(['item-a']);
      } finally {
        wrapper.unmount();
      }
    },
  );

  it('downloads the explicitly chosen electronic file by its exact material and version IDs', async () => {
    const existing = await api.getEvidenceGroup();
    api.getEvidenceGroup.mockResolvedValue({
      ...existing,
      paperCertificates: [
        {
          ...existing.paperCertificates[0],
          electronicFiles: [
            {
              materialId: 'material-1',
              contentVersionId: 'version-1',
              filename: '证书一.pdf',
            },
            {
              materialId: 'material-2',
              contentVersionId: 'version-2',
              filename: '证书二.pdf',
            },
          ],
        },
      ],
    });
    materials.downloadMaterialVersion.mockResolvedValue(undefined);
    const wrapper = mount(EvidencePage);
    await flushPromises();
    await wrapper.get('tbody tr').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').text()).toContain('证书一.pdf');
    await wrapper
      .findAll('[role="dialog"] button')
      .filter((button) => button.text() === '下载 证书二.pdf')[0]
      .trigger('click');
    await flushPromises();
    expect(materials.downloadMaterialVersion).toHaveBeenCalledTimes(1);
    expect(materials.downloadMaterialVersion).toHaveBeenCalledWith(
      'material-2',
      'version-2',
    );
    wrapper.unmount();
  });
  it('keeps existing evidence editing available after removing the list-level source entry', async () => {
    const wrapper = mount(EvidencePage);
    await flushPromises();
    expect(wrapper.text()).not.toContain('选择案件编辑证物');
    await wrapper.get('tbody tr input[type=checkbox]').setValue(true);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '编辑')!
      .trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').attributes('aria-label')).toBe(
      '编辑证物',
    );
    expect(api.getEvidenceGroup).toHaveBeenCalledWith('case-1');
    wrapper.unmount();
  });
  it('shows a failed load as unknown data rather than a zero-item warehouse and can retry', async () => {
    const loaded = await api.listEvidence();
    api.listEvidence.mockRejectedValueOnce(new Error('暂时无法读取'));
    const wrapper = mount(EvidencePage);
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toBe('暂时无法读取');
    expect(wrapper.text()).not.toContain('证物数量待加载');
    expect(wrapper.text()).not.toContain('没有匹配的证物');
    api.listEvidence.mockResolvedValue(loaded);
    await wrapper
      .findAll('button')
      .filter((button) => button.text() === '重试')[0]
      .trigger('click');
    await flushPromises();
    expect(wrapper.text()).not.toContain('共 2 件证物');
  });
  it('does not prefill a mixed empty/nonempty remark and distinguishes duplicate paper numbers', async () => {
    const existing = await api.getEvidenceGroup();
    api.getEvidenceGroup.mockResolvedValue({
      ...existing,
      items: [
        { ...first, remark: null },
        { ...second, remark: '另一个备注' },
      ],
      paperCertificates: first.paperCertificates.map((paper) => ({
        ...paper,
        number: '重复编号',
      })),
    });
    const wrapper = mount(EvidencePage);
    await flushPromises();
    await wrapper.get('tbody tr input[type=checkbox]').setValue(true);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '编辑')!
      .trigger('click');
    await flushPromises();
    expect(
      (
        wrapper.find('input[placeholder="证物备注"]')
          .element as HTMLInputElement
      ).value,
    ).toBe('');
    expect(wrapper.find('[role="dialog"]').text()).toContain(
      '重复编号 · 记录 paper-1',
    );
    expect(wrapper.find('[role="dialog"]').text()).toContain(
      '重复编号 · 记录 paper-2',
    );
  });
  it('shows every associated paper record and keeps source separate from editable remark', async () => {
    const wrapper = mount(EvidencePage);
    await flushPromises();
    expect(wrapper.text()).toContain('N1 / N2');
    await wrapper.get('tbody tr').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').text()).toContain('N1');
    expect(wrapper.find('[role="dialog"]').text()).toContain('N2');
    expect(wrapper.find('[role="dialog"]').text()).toContain('EV-B');
  });

  it('shows Chinese platform and provenance labels with a safe unknown fallback', async () => {
    const existing = await api.getEvidenceGroup();
    api.getEvidenceGroup.mockResolvedValue({
      ...existing,
      case: { ...existing.case, platform: 'TAOBAO' },
      items: [
        { ...first, provenance: 'notary.certificate_issued' },
        { ...second, provenance: 'notary.unknown_event' },
        { ...second, id: 'item-c', provenance: 'toString' },
      ],
    });
    const wrapper = mount(EvidencePage);
    await flushPromises();
    await wrapper.get('tbody tr').trigger('click');
    await flushPromises();
    const dialogText = wrapper.get('[role="dialog"]').text();
    expect(dialogText).toContain('平台：淘宝');
    expect(dialogText).toContain('来源：公证出证');
    expect(dialogText).toContain('来源：—');
    expect(dialogText).not.toContain('TAOBAO');
    expect(dialogText).not.toContain('notary.certificate_issued');
    expect(dialogText).not.toContain('notary.unknown_event');
    expect(dialogText).not.toContain('toString');
    wrapper.unmount();
  });

  it.each(['FUTURE_PLATFORM', 'toString', '__proto__'])(
    'does not show an unknown platform code in the evidence group view: %s',
    async (platform) => {
      const existing = await api.getEvidenceGroup();
      api.getEvidenceGroup.mockResolvedValue({
        ...existing,
        case: { ...existing.case, platform },
      });
      const wrapper = mount(EvidencePage);
      await flushPromises();
      await wrapper.get('tbody tr').trigger('click');
      await flushPromises();
      const dialogText = wrapper.get('[role="dialog"]').text();
      expect(dialogText).toContain('平台：—');
      expect(dialogText).not.toContain(platform);
      wrapper.unmount();
    },
  );

  it('keeps selection across filters and sends selected IDs to the bulk dialog', async () => {
    const wrapper = mount(EvidencePage);
    await flushPromises();
    await wrapper.find('input[aria-label="选择证物 EV-A"]').setValue(true);
    await wrapper.findAll('.status-row button')[1].trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('已勾选 1 件证物');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '批量更改状态')
      ?.trigger('click');
    await flushPromises();
    expect(api.getEvidenceItemGroup).toHaveBeenCalledWith('item-a');
    await wrapper
      .findAll('[role="dialog"] select')[1]
      .setValue('MAILED_TO_LAWYER');
    expect(wrapper.find('[role="dialog"]').text()).toContain('N2');
  });

  it('selects the entire filter collection, including rows on another page, and can invert it', async () => {
    api.matchingEvidenceIds.mockResolvedValue(['item-a', 'item-b', 'item-c']);
    const wrapper = mount(EvidencePage);
    await flushPromises();
    await wrapper
      .find('input[aria-label="全选或反选当前筛选集合"]')
      .setValue(true);
    await flushPromises();
    expect(wrapper.text()).toContain('已勾选 3 件证物');
    await wrapper
      .find('input[aria-label="全选或反选当前筛选集合"]')
      .setValue(false);
    await flushPromises();
    expect(wrapper.text()).toContain('已勾选 0 件证物');
  });

  it('auto-stocks a completed draft, respects a manual status choice and cancels without a write', async () => {
    const wrapper = mount(EvidencePage);
    await flushPromises();
    await wrapper.get('tbody tr input[type=checkbox]').setValue(true);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '编辑')!
      .trigger('click');
    await flushPromises();
    const shelf = wrapper.findAll('input[aria-label="货架号"]')[0];
    const status = wrapper.findAll('select[aria-label="证物状态"]')[0];
    await shelf.setValue('A3');
    expect((status.element as HTMLSelectElement).value).toBe('IN_STOCK');
    await status.setValue('UNDELIVERED');
    await shelf.setValue('A4');
    expect((status.element as HTMLSelectElement).value).toBe('UNDELIVERED');
    await wrapper
      .findAll('button')
      .filter((button) => button.text() === '取消')[0]
      .trigger('click');
    expect(api.saveEvidenceGroup).not.toHaveBeenCalled();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(first.shelfLocation).toBeNull();
  });

  it('reuses an unknown group-save request key and displays no-change feedback inside the dialog', async () => {
    const wrapper = mount(EvidencePage);
    await flushPromises();
    await wrapper.get('tbody tr input[type=checkbox]').setValue(true);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '编辑')!
      .trigger('click');
    await flushPromises();
    const snapshot = api.getEvidenceGroup.mock.results[0].value;
    api.saveEvidenceGroup
      .mockRejectedValueOnce(new Error('请求结果未知'))
      .mockResolvedValueOnce({ changed: false, group: await snapshot });
    await wrapper
      .findAll('button')
      .filter((button) => button.text() === '保存')[0]
      .trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="dialog"] [role="alert"]').text()).toBe(
      '请求结果未知',
    );
    await wrapper
      .findAll('button')
      .filter((button) => button.text() === '保存')[0]
      .trigger('click');
    await flushPromises();
    expect(api.saveEvidenceGroup.mock.calls[0][2]).toBe(
      api.saveEvidenceGroup.mock.calls[1][2],
    );
    expect(wrapper.find('[role="dialog"] [role="status"]').text()).toBe(
      '未做任何修改',
    );
  });

  it('changes only the explicitly selected second paper record', async () => {
    api.bulkEvidenceStatus.mockResolvedValue({
      changedEvidence: 0,
      changedPaperCertificates: 1,
    });
    const wrapper = mount(EvidencePage);
    await flushPromises();
    await wrapper.find('input[aria-label="选择证物 EV-A"]').setValue(true);
    await wrapper
      .findAll('button')
      .filter((button) => button.text() === '批量更改状态')[0]
      .trigger('click');
    await flushPromises();
    await wrapper.findAll('[role="dialog"] select')[1].setValue('NOT_ISSUED');
    await wrapper.findAll('[role="dialog"] fieldset input')[1].setValue(true);
    await wrapper
      .findAll('button')
      .filter((button) => button.text() === '保存')[0]
      .trigger('click');
    await flushPromises();
    expect(api.bulkEvidenceStatus).toHaveBeenCalledWith(
      {
        evidenceIds: ['item-a'],
        paperCertificateIds: ['paper-2'],
        paperStatus: 'NOT_ISSUED',
      },
      expect.any(String),
    );
  });
});
