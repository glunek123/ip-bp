import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { VNode } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ElCheckbox } from 'element-plus/es/components/checkbox/index.mjs';
import type { CreateLeadInput, LeadFormContext } from '../../api/leads';
import type { LeadCsvParsedRow, LeadCsvPreview } from './lead-csv-preview';
import LeadCsvPreviewPanel from './LeadCsvPreviewPanel.vue';

type CheckboxValue = boolean | number | string;

const formContext: LeadFormContext = {
  customers: [
    {
      id: 'customer-a',
      name: '客户甲',
      rightsHolders: [{ id: 'holder-a', name: '主体甲' }],
    },
  ],
  dictionaries: {
    caseTypes: [],
    infringementTypes: [],
    sources: [],
    platforms: { ONLINE: [], OFFLINE: [] },
  },
};

function mountWithContext(snapshot: LeadCsvPreview) {
  return mount(LeadCsvPreviewPanel, { props: { snapshot, formContext } });
}

function vnodeHandler<T>(vnode: VNode, name: string): (value: T) => unknown {
  const handler = vnode?.props?.[name];
  if (typeof handler !== 'function')
    throw new Error(`Expected a mounted VNode ${name} handler`);
  return handler as (value: T) => unknown;
}

function leadInput(shopName = '合成店铺'): CreateLeadInput {
  return {
    customerId: 'customer-a',
    rightsHolderId: 'holder-a',
    caseType: 'CIVIL',
    infringementTypes: ['TRADEMARK'],
    source: 'ONLINE',
    platform: 'TAOBAO',
    foundAt: '2026-10-19T02:00:00.000Z',
    shopName,
    shopExternalId: '00123',
    needDisclose: false,
    remark: '原样显示的备注',
    products: [
      {
        url: 'https://example.com/a',
        title: '商品甲',
        quantity: 0,
        unitPrice: '99999999999999.99',
        commentCount: 3,
      },
      {
        url: 'https://example.com/b',
        title: '商品乙',
        quantity: 2,
        unitPrice: '1.50',
        commentCount: 5,
      },
    ],
    leadScreenshotContentVersionIds: ['content-version-a'],
    reservedLeadId: 'hidden-reserved-lead-id',
  };
}

function validRow(
  rowNumber: number,
  shopName?: string,
  suspectedDuplicates: readonly string[] = [],
): LeadCsvParsedRow {
  return {
    rowNumber,
    status: 'valid',
    input: leadInput(shopName),
    suspectedDuplicates,
  };
}

function readySnapshot(
  rows: readonly LeadCsvParsedRow[],
  selectedRowNumbers: readonly number[] = [],
  generation = 8,
): LeadCsvPreview {
  return {
    generation,
    phase: 'ready',
    fileName: '运营线索.csv',
    rows,
    selectedRowNumbers,
  };
}

describe('LeadCsvPreviewPanel', () => {
  it.each([
    ['closed', '预览已关闭。'],
    ['empty', '尚未选择导入文件。'],
    ['reading', '正在读取当前文件…'],
    ['error', '文件读取失败，当前预览已清除。请重新选择文件。'],
  ] as const)(
    'shows the %s state without inventing an import result',
    (phase, text) => {
      const wrapper = mount(LeadCsvPreviewPanel, {
        props: {
          snapshot: {
            generation: 4,
            phase,
            fileName: null,
            rows: [],
            selectedRowNumbers: [],
          },
        },
      });
      expect(wrapper.text()).toContain(text);
      expect(wrapper.find('[data-test="csv-confirm-request"]').exists()).toBe(
        false,
      );
      expect(wrapper.text()).not.toContain('导入成功');
    },
  );

  it('displays the active file, row errors and duplicate hints without selecting rows', () => {
    const wrapper = mountWithContext(
      readySnapshot([
        validRow(2, '甲店铺', ['已有相近店铺名称']),
        {
          rowNumber: 3,
          status: 'invalid',
          errors: ['客户无法匹配', '商品单价非法'],
        },
      ]),
    );
    expect(wrapper.get('[data-test="csv-file-name"]').text()).toContain(
      '运营线索.csv',
    );
    expect(
      wrapper.get('[data-test="csv-row-2"] input').element,
    ).not.toHaveProperty('checked', true);
    expect(wrapper.get('[data-test="csv-row-2"]').text()).toContain(
      '疑似重复：已有相近店铺名称',
    );
    expect(wrapper.get('[data-test="csv-row-3"]').text()).toContain(
      '客户无法匹配',
    );
    expect(wrapper.get('[data-test="csv-row-3"]').text()).toContain(
      '商品单价非法',
    );
    expect(
      wrapper.get('[data-test="csv-row-3"]').attributes('aria-disabled'),
    ).toBe('true');
    expect(wrapper.find('[data-test="csv-row-3"] input').exists()).toBe(false);
    expect(
      wrapper.get('[data-test="csv-confirm-request"]').attributes('disabled'),
    ).toBeDefined();
    expect(wrapper.emitted('confirmRequest')).toBeUndefined();
  });

  it('does not nest labels around valid-row checkboxes or render them for invalid rows', () => {
    const wrapper = mountWithContext(
      readySnapshot([
        validRow(2),
        { rowNumber: 3, status: 'invalid', errors: ['无效行'] },
      ]),
    );
    const validRowElement = wrapper.get('[data-test="csv-row-2"]').element;
    const invalidRowElement = wrapper.get('[data-test="csv-row-3"]').element;

    expect(validRowElement.querySelector('label label')).toBeNull();
    expect(
      validRowElement.querySelector('input[type="checkbox"]'),
    ).not.toBeNull();
    expect(invalidRowElement.querySelector('label')).toBeNull();
    expect(
      invalidRowElement.querySelector('input[type="checkbox"]'),
    ).toBeNull();
  });

  it('marks missing or ambiguous customer and rights-holder mappings unavailable', () => {
    const customer = formContext.customers[0]!;
    const contexts: Array<LeadFormContext | undefined> = [
      undefined,
      {
        ...formContext,
        customers: [
          ...formContext.customers,
          { ...customer, id: 'customer-b', name: ' 客户甲 ' },
        ],
      },
      {
        ...formContext,
        customers: [{ ...customer, rightsHolders: [] }],
      },
    ];

    for (const context of contexts) {
      const snapshot = readySnapshot([validRow(2)], [2]);
      const props = {
        snapshot,
        formContext: context as LeadFormContext,
      };
      const wrapper = mount(LeadCsvPreviewPanel, { props });
      const row = wrapper.get('[data-test="csv-row-2"]');

      expect(row.text()).toContain('客户或权利主体不可用');
      expect(row.text()).not.toContain('customer-a');
      expect(row.text()).not.toContain('holder-a');
      expect(row.get('[data-test="csv-row-unavailable"]')).toBeDefined();
      expect(row.find('input[type="checkbox"]').exists()).toBe(false);
      expect(
        wrapper.get('[data-test="csv-confirm-request"]').attributes('disabled'),
      ).toBeDefined();
    }
  });

  it('renders Chinese business labels while preserving the encoded input and recorded product fields', () => {
    const snapshot = readySnapshot([validRow(2)]);
    const original = structuredClone(snapshot);
    const wrapper = mountWithContext(snapshot);
    const text = wrapper.get('[data-test="csv-row-2"]').text();
    for (const expected of [
      '客户甲',
      '主体甲',
      '民事',
      '商标权',
      '线上',
      '淘宝',
      '商品链接',
      '2026/10/19 10:00:00',
      '合成店铺',
      '00123',
      '否',
      '原样显示的备注',
      'https://example.com/a',
      '商品甲',
      '0',
      '99999999999999.99',
      '3',
      'https://example.com/b',
      '商品乙',
      '2',
      '1.50',
      '5',
      'content-version-a',
    ])
      expect(text).toContain(expected);
    for (const code of ['CIVIL', 'TRADEMARK', 'ONLINE', 'TAOBAO', 'URL'])
      expect(text).not.toContain(code);
    expect(snapshot).toEqual(original);
    expect(text).not.toContain('估算');
    expect(text).not.toContain('hidden-reserved-lead-id');
    expect(text).not.toContain('预留线索 ID');
    expect(text).not.toContain('customer-a');
    expect(text).not.toContain('holder-a');
  });

  it('displays foundAt in Shanghai time while preserving the UTC input value', () => {
    const input = leadInput();
    input.foundAt = '2026-10-18T16:30:00.000Z';
    const snapshot = readySnapshot([
      {
        rowNumber: 2,
        status: 'valid',
        input,
        suspectedDuplicates: [],
      },
    ]);
    const wrapper = mountWithContext(snapshot);
    const rowText = wrapper.get('[data-test="csv-row-2"]').text();

    expect(rowText).toContain('2026/10/19 00:30:00');
    expect(rowText).not.toContain('2026-10-18T16:30:00.000Z');
    expect(snapshot.rows[0]?.status).toBe('valid');
    if (snapshot.rows[0]?.status === 'valid')
      expect(snapshot.rows[0].input.foundAt).toBe('2026-10-18T16:30:00.000Z');
  });

  it('emits an explicit valid-row selection request with the displayed generation', async () => {
    const wrapper = mountWithContext(
      readySnapshot([
        validRow(2),
        { rowNumber: 3, status: 'invalid', errors: ['无效行'] },
        validRow(4),
      ]),
    );
    await wrapper.get('[data-test="csv-row-4"] input').setValue(true);
    expect(wrapper.emitted('selectRows')).toEqual([
      [{ generation: 8, rowNumbers: [4] }],
    ]);
    expect(wrapper.emitted('confirmRequest')).toBeUndefined();
  });

  it('keeps selection order in the preview and never includes invalid rows', async () => {
    const wrapper = mountWithContext(
      readySnapshot(
        [
          validRow(2),
          { rowNumber: 3, status: 'invalid', errors: ['无效行'] },
          validRow(4),
        ],
        [2],
      ),
    );
    await wrapper.get('[data-test="csv-row-4"] input').setValue(true);
    expect(wrapper.emitted('selectRows')?.[0]?.[0]).toEqual({
      generation: 8,
      rowNumbers: [2, 4],
    });
    expect(wrapper.get('[data-test="csv-row-2"] input').element).toHaveProperty(
      'checked',
      true,
    );
  });

  it('emits confirm intent only for a current nonempty valid selection', async () => {
    const wrapper = mountWithContext(
      readySnapshot([validRow(2), validRow(4)], [4]),
    );
    const confirm = wrapper.get('[data-test="csv-confirm-request"]');
    expect(confirm.attributes('disabled')).toBeUndefined();
    await confirm.trigger('click');
    expect(wrapper.emitted('confirmRequest')).toEqual([[{ generation: 8 }]]);
    expect(wrapper.emitted('selectRows')).toBeUndefined();
  });

  it('does not confirm missing, duplicate, invalid or stale row selections', async () => {
    const rows: LeadCsvParsedRow[] = [
      validRow(2),
      { rowNumber: 3, status: 'invalid', errors: ['无效行'] },
    ];
    for (const selectedRowNumbers of [[], [2, 2], [3], [99]]) {
      const wrapper = mountWithContext(readySnapshot(rows, selectedRowNumbers));
      expect(
        wrapper.get('[data-test="csv-confirm-request"]').attributes('disabled'),
      ).toBeDefined();
      await wrapper.get('[data-test="csv-confirm-request"]').trigger('click');
      expect(wrapper.emitted('confirmRequest')).toBeUndefined();
      wrapper.unmount();
    }
    const stale = mount(LeadCsvPreviewPanel, {
      props: {
        snapshot: {
          ...readySnapshot(rows, [2]),
          phase: 'reading',
          generation: 9,
          selectedRowNumbers: [],
        },
      },
    });
    expect(stale.find('[data-test="csv-confirm-request"]').exists()).toBe(
      false,
    );
  });

  it('sends cancel intent with the generation shown in the active preview', async () => {
    const wrapper = mount(LeadCsvPreviewPanel, {
      props: { snapshot: readySnapshot([validRow(2)], [], 13) },
    });
    await wrapper.get('[data-test="csv-cancel-request"]').trigger('click');
    expect(wrapper.emitted('cancelRequest')).toEqual([[{ generation: 13 }]]);
    expect(wrapper.emitted('confirmRequest')).toBeUndefined();
  });

  it('uses only the currently displayed generation when the host replaces the file snapshot', async () => {
    const wrapper = mountWithContext(
      readySnapshot([validRow(2, 'A店铺')], [], 21),
    );
    await wrapper.get('[data-test="csv-row-2"] input').setValue(true);
    await wrapper.setProps({
      snapshot: readySnapshot([validRow(2, 'B店铺')], [], 22),
    });
    expect(wrapper.get('[data-test="csv-file-name"]').text()).toContain(
      '运营线索.csv',
    );
    expect(wrapper.get('[data-test="csv-row-2"]').text()).toContain('B店铺');
    await wrapper.get('[data-test="csv-cancel-request"]').trigger('click');
    expect(wrapper.emitted('cancelRequest')?.at(-1)?.[0]).toEqual({
      generation: 22,
    });
    expect(wrapper.emitted('selectRows')?.[0]?.[0]).toEqual({
      generation: 21,
      rowNumbers: [2],
    });
  });

  it('rejects the captured old checkbox VNode handler after replacing its batch', async () => {
    const wrapper = mountWithContext(
      readySnapshot([validRow(2, 'A店铺')], [], 31),
    );
    const checkbox = wrapper.getComponent(ElCheckbox);
    const oldHandler = vnodeHandler<CheckboxValue>(
      checkbox.vm.$.vnode,
      'onChange',
    );
    oldHandler(true);
    expect(wrapper.emitted('selectRows')).toHaveLength(1);
    await wrapper.setProps({
      snapshot: readySnapshot([validRow(2, 'B店铺')], [], 32),
    });
    oldHandler(false);
    expect(wrapper.emitted('selectRows')).toHaveLength(1);
    expect(wrapper.emitted('selectRows')?.[0]?.[0]).toEqual({
      generation: 31,
      rowNumbers: [2],
    });
  });

  it('rejects the captured old cancel VNode handler after replacing its batch', async () => {
    const wrapper = mount(LeadCsvPreviewPanel, {
      props: { snapshot: readySnapshot([validRow(2)], [], 41) },
    });
    const cancel = wrapper
      .findAllComponents(ElButton)
      .find(
        (button) => button.attributes('data-test') === 'csv-cancel-request',
      );
    if (!cancel) throw new Error('Expected the cancel button component');
    const oldHandler = vnodeHandler<MouseEvent>(cancel.vm.$.vnode, 'onClick');
    oldHandler(new globalThis.MouseEvent('click'));
    await wrapper.setProps({
      snapshot: readySnapshot([validRow(2, 'B店铺')], [], 42),
    });
    oldHandler(new globalThis.MouseEvent('click'));
    expect(wrapper.emitted('cancelRequest')).toEqual([[{ generation: 41 }]]);
  });

  it('rejects the captured old confirm VNode handler after replacing its batch', async () => {
    const wrapper = mountWithContext(readySnapshot([validRow(2)], [2], 51));
    const confirm = wrapper
      .findAllComponents(ElButton)
      .find(
        (button) => button.attributes('data-test') === 'csv-confirm-request',
      );
    if (!confirm) throw new Error('Expected the confirm button component');
    const oldHandler = vnodeHandler<MouseEvent>(confirm.vm.$.vnode, 'onClick');
    oldHandler(new globalThis.MouseEvent('click'));
    await wrapper.setProps({
      snapshot: readySnapshot([validRow(2, 'B店铺')], [2], 52),
    });
    oldHandler(new globalThis.MouseEvent('click'));
    expect(wrapper.emitted('confirmRequest')).toEqual([[{ generation: 51 }]]);
  });
});
