import { flushPromises, mount } from '@vue/test-utils';
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
  it('keeps all progress choices available in a collapsed multi-select filter', async () => {
    const wrapper = mount(EvidencePage);
    await flushPromises();

    expect(wrapper.find<HTMLDetailsElement>('.stage-filter').element.open).toBe(
      false,
    );
    expect(wrapper.findAll('.stage-row input[type="checkbox"]')).toHaveLength(
      16,
    );
    expect(wrapper.find('.stage-filter summary').text()).toContain('已选 0 项');
    await wrapper
      .findAll('.stage-row label')
      .find((label) => label.text().includes('待匹配'))!
      .get('input')
      .setValue(true);
    await flushPromises();
    expect(wrapper.find<HTMLDetailsElement>('.stage-filter').element.open).toBe(
      true,
    );
    expect(wrapper.find('.stage-filter summary').text()).toContain('已选 1 项');
    expect(api.listEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({ stages: ['PENDING_MATCH'] }),
      expect.any(Object),
    );
    await wrapper.get('.stage-row button').trigger('click');
    await flushPromises();
    expect(wrapper.find('.stage-filter summary').text()).toContain('已选 0 项');
    expect(api.listEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({ stages: [] }),
      expect.any(Object),
    );
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
    await wrapper
      .findAll('button')
      .filter((button) => button.text() === '查看')[0]
      .trigger('click');
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
  it('keeps the source chooser closed when its pending group read completes after closing', async () => {
    const existing = await api.getEvidenceGroup();
    api.listEvidenceGroups.mockResolvedValue({
      items: [
        {
          groupId: existing.groupId,
          sourceKind: existing.sourceKind,
          sourceId: existing.sourceId,
          businessNo: 'NT-1',
          shopName: '测试店铺',
          activeItemCount: 2,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    let finishRead: ((value: unknown) => void) | undefined;
    api.getEvidenceGroup.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    const wrapper = mount(EvidencePage);
    await flushPromises();
    await wrapper
      .findAll('button')
      .filter((button) => button.text() === '选择案件编辑证物')[0]
      .trigger('click');
    await flushPromises();
    await wrapper
      .findAll('button')
      .filter((button) => button.text() === '编辑证物')[0]
      .trigger('click');
    await wrapper
      .findAll('[role="dialog"] button')
      .filter((button) => button.text() === '关闭')[0]
      .trigger('click');
    finishRead?.(existing);
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(api.saveEvidenceGroup).not.toHaveBeenCalled();
    expect(api.saveEvidenceSourceGroup).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('shows a failed load as unknown data rather than a zero-item warehouse and can retry', async () => {
    const loaded = await api.listEvidence();
    api.listEvidence.mockRejectedValueOnce(new Error('暂时无法读取'));
    const wrapper = mount(EvidencePage);
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toBe('暂时无法读取');
    expect(wrapper.text()).toContain('证物数量待加载');
    expect(wrapper.text()).not.toContain('没有匹配的证物');
    api.listEvidence.mockResolvedValue(loaded);
    await wrapper
      .findAll('button')
      .filter((button) => button.text() === '重试')[0]
      .trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('共 2 件证物');
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
    await wrapper
      .findAll('button')
      .filter((button) => button.text() === '编辑')[0]
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
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '查看')
      ?.trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').text()).toContain('N1');
    expect(wrapper.find('[role="dialog"]').text()).toContain('N2');
    expect(wrapper.find('[role="dialog"]').text()).toContain('EV-B');
  });

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
    await wrapper
      .findAll('button')
      .filter((button) => button.text() === '编辑')[0]
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
    await wrapper
      .findAll('button')
      .filter((button) => button.text() === '编辑')[0]
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

  it.each([false, true])(
    'opens a real empty source without a dummy item; persisted=%s',
    async (persisted) => {
      const empty = {
        groupId: persisted ? 'empty-group' : null,
        groupVersion: persisted ? 4 : 0,
        sourceKind: 'CASE',
        sourceId: 'case-empty',
        sourceVersion: 9,
        case: {
          id: 'case-empty',
          platform: null,
          shopName: null,
          caseNo: null,
          stage: 'PENDING_MATCH',
          lawyerName: null,
        },
        items: [],
        paperCertificates: [],
      };
      api.listEvidenceGroups.mockResolvedValue({
        items: [
          {
            ...empty,
            caseId: 'case-empty',
            businessNo: 'IP-EMPTY',
            shopName: null,
            activeItemCount: 0,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      api.getEvidenceGroup.mockResolvedValue(empty);
      api.getEvidenceSourceGroup.mockResolvedValue(empty);
      api.saveEvidenceGroup.mockResolvedValue({ changed: false, group: empty });
      api.saveEvidenceSourceGroup.mockResolvedValue({
        changed: false,
        group: empty,
      });
      const wrapper = mount(EvidencePage);
      await flushPromises();
      await wrapper
        .findAll('button')
        .filter((button) => button.text() === '选择案件编辑证物')[0]
        .trigger('click');
      await flushPromises();
      await wrapper
        .findAll('button')
        .filter((button) => button.text() === '编辑证物')[0]
        .trigger('click');
      await flushPromises();
      expect(wrapper.findAll('input[aria-label="证物编号"]')).toHaveLength(1);
      await wrapper.find('input[aria-label="证物编号"]').setValue('NEW-EV');
      await wrapper
        .findAll('button')
        .filter((button) => button.text() === '保存')[0]
        .trigger('click');
      await flushPromises();
      if (persisted) {
        expect(api.saveEvidenceGroup).toHaveBeenCalledWith(
          'empty-group',
          expect.objectContaining({ expectedGroupVersion: 4 }),
          expect.any(String),
        );
        expect(api.saveEvidenceSourceGroup).not.toHaveBeenCalled();
      } else {
        expect(api.saveEvidenceSourceGroup).toHaveBeenCalledWith(
          'CASE',
          'case-empty',
          {
            expectedGroupVersion: 0,
            expectedSourceVersion: 9,
            rows: [
              {
                displayCode: 'NEW-EV',
                shelfLocation: '',
                status: 'UNDELIVERED',
                manualStatus: false,
              },
            ],
          },
          expect.any(String),
        );
      }
    },
  );
});
