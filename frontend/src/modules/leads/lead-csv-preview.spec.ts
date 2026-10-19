import { describe, expect, it } from 'vitest';
import type { CreateLeadInput, InfringementType } from '../../api/leads';
import {
  LeadCsvPreviewSession,
  type LeadCsvParsedRow,
} from './lead-csv-preview';

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
    needDisclose: false,
    products: [
      { title: '合成商品', quantity: 0, commentCount: 3, unitPrice: '1.50' },
    ],
    leadScreenshotContentVersionIds: [],
  };
}

function validRow(rowNumber: number, input = leadInput()): LeadCsvParsedRow {
  return { rowNumber, status: 'valid', input, suspectedDuplicates: [] };
}

function beginFile(session: LeadCsvPreviewSession, fileName = 'A.csv'): number {
  const generation = session.beginFile(fileName);
  if (generation === null) throw new Error('The preview session is closed');
  return generation;
}

function requireSelection(session: LeadCsvPreviewSession) {
  const selection = session.selection();
  if (selection === null) throw new Error('No rows selected');
  return selection;
}

describe('lead CSV preview session', () => {
  it('starts closed and cannot read or select a file until opened', () => {
    const session = new LeadCsvPreviewSession();
    expect(session.snapshot()).toMatchObject({
      phase: 'closed',
      fileName: null,
      rows: [],
      selectedRowNumbers: [],
    });
    expect(session.beginFile('A.csv')).toBeNull();
    expect(session.selectRows(0, [1])).toBe(false);
    expect(session.selection()).toBeNull();
  });

  it('shows row errors and duplicate hints without automatically selecting rows', () => {
    const session = new LeadCsvPreviewSession();
    session.open();
    const generation = beginFile(session);
    const rows: LeadCsvParsedRow[] = [
      {
        rowNumber: 2,
        status: 'valid',
        input: leadInput(),
        suspectedDuplicates: ['疑似与已有线索重复'],
      },
      { rowNumber: 3, status: 'invalid', errors: ['缺少客户', '商品价格非法'] },
    ];
    expect(session.acceptParsed(generation, rows)).toBe(true);
    expect(session.snapshot()).toMatchObject({ phase: 'ready', rows });
    expect(session.selection()).toBeNull();
    expect(session.selectRows(generation, [2])).toBe(true);
    expect(requireSelection(session).rows).toEqual([
      { rowNumber: 2, input: leadInput() },
    ]);
  });

  it('accepts only explicitly chosen valid preview rows and keeps preview order', () => {
    const session = new LeadCsvPreviewSession();
    session.open();
    const generation = beginFile(session);
    session.acceptParsed(generation, [validRow(2), validRow(4), validRow(5)]);
    expect(session.selectRows(generation, [5, 2, 5])).toBe(true);
    expect(requireSelection(session).rows.map((row) => row.rowNumber)).toEqual([
      2, 5,
    ]);
    expect(session.selectRows(generation, [])).toBe(true);
    expect(session.selection()).toBeNull();
  });

  it('rejects invalid and absent row identities as a whole selection', () => {
    const session = new LeadCsvPreviewSession();
    session.open();
    const generation = beginFile(session);
    session.acceptParsed(generation, [
      validRow(2),
      { rowNumber: 3, status: 'invalid', errors: ['缺少客户'] },
    ]);
    expect(session.selectRows(generation, [2, 3])).toBe(false);
    expect(session.selectRows(generation, [2, 99])).toBe(false);
    expect(session.selection()).toBeNull();
  });

  it('clears A on cancel and reopening cannot expose or select its rows', () => {
    const session = new LeadCsvPreviewSession();
    session.open();
    const generation = beginFile(session);
    session.acceptParsed(generation, [validRow(2)]);
    session.selectRows(generation, [2]);
    const selection = requireSelection(session);
    session.cancel();
    expect(session.isCurrentSelection(selection)).toBe(false);
    session.open();
    expect(session.snapshot()).toMatchObject({
      phase: 'empty',
      fileName: null,
      rows: [],
      selectedRowNumbers: [],
    });
    expect(session.selectRows(generation, [2])).toBe(false);
    expect(session.selection()).toBeNull();
  });

  it('opening an already open session also invalidates its current batch', () => {
    const session = new LeadCsvPreviewSession();
    session.open();
    const generation = beginFile(session);
    session.acceptParsed(generation, [validRow(2)]);
    session.selectRows(generation, [2]);
    session.open();
    expect(session.selection()).toBeNull();
    expect(session.acceptParsed(generation, [validRow(2)])).toBe(false);
  });

  it('replacing A with B clears selection and rejects late parse and selection events', () => {
    const session = new LeadCsvPreviewSession();
    session.open();
    const first = beginFile(session);
    session.acceptParsed(first, [validRow(2, leadInput('A店铺'))]);
    session.selectRows(first, [2]);
    const oldSelection = requireSelection(session);
    const second = beginFile(session, 'B.csv');
    expect(session.selection()).toBeNull();
    expect(session.selectRows(second, [2])).toBe(false);
    expect(session.isCurrentSelection(oldSelection)).toBe(false);
    expect(session.acceptParsed(first, [validRow(2)])).toBe(false);
    expect(session.failFile(first)).toBe(false);
    expect(
      session.acceptParsed(second, [validRow(2, leadInput('B店铺'))]),
    ).toBe(true);
    expect(session.selectRows(first, [2])).toBe(false);
    expect(session.selection()).toBeNull();
    session.selectRows(second, [2]);
    expect(requireSelection(session).rows[0]?.input.shopName).toBe('B店铺');
  });

  it('ignores a pending read after cancellation and after reopening', () => {
    const session = new LeadCsvPreviewSession();
    session.open();
    const generation = beginFile(session);
    session.cancel();
    expect(session.acceptParsed(generation, [validRow(2)])).toBe(false);
    expect(session.failFile(generation)).toBe(false);
    session.open();
    expect(session.acceptParsed(generation, [validRow(2)])).toBe(false);
    expect(session.snapshot().phase).toBe('empty');
  });

  it('a failed read removes the previous batch and cannot later succeed', () => {
    const session = new LeadCsvPreviewSession();
    session.open();
    const first = beginFile(session);
    session.acceptParsed(first, [validRow(2)]);
    session.selectRows(first, [2]);
    const second = beginFile(session, 'B.csv');
    expect(session.failFile(second)).toBe(true);
    expect(session.snapshot()).toMatchObject({
      phase: 'error',
      fileName: null,
      rows: [],
      selectedRowNumbers: [],
    });
    expect(session.acceptParsed(second, [validRow(2)])).toBe(false);
    expect(session.selection()).toBeNull();
    const third = beginFile(session, 'C.csv');
    expect(session.acceptParsed(third, [validRow(4)])).toBe(true);
  });

  it('cannot replace an accepted preview with a duplicate callback', () => {
    const session = new LeadCsvPreviewSession();
    session.open();
    const generation = beginFile(session);
    session.acceptParsed(generation, [validRow(2, leadInput('已展示'))]);
    session.selectRows(generation, [2]);
    expect(
      session.acceptParsed(generation, [validRow(2, leadInput('迟到覆盖'))]),
    ).toBe(false);
    expect(session.failFile(generation)).toBe(false);
    expect(requireSelection(session).rows[0]?.input.shopName).toBe('已展示');
  });

  it('invalidates captured selections when the user changes or clears selection', () => {
    const session = new LeadCsvPreviewSession();
    session.open();
    const generation = beginFile(session);
    session.acceptParsed(generation, [validRow(2), validRow(3)]);
    session.selectRows(generation, [2]);
    const first = requireSelection(session);
    expect(session.isCurrentSelection(first)).toBe(true);
    session.selectRows(generation, [3]);
    expect(session.isCurrentSelection(first)).toBe(false);
    const second = requireSelection(session);
    session.selectRows(generation, []);
    expect(session.isCurrentSelection(second)).toBe(false);
  });

  it('rejects copied stamps with substituted input or an unselected preview row', () => {
    const session = new LeadCsvPreviewSession();
    session.open();
    const generation = beginFile(session);
    session.acceptParsed(generation, [validRow(2), validRow(3)]);
    session.selectRows(generation, [2]);
    const selection = requireSelection(session);
    expect(
      session.isCurrentSelection({
        ...selection,
        rows: [{ rowNumber: 2, input: leadInput('替换的输入') }],
      }),
    ).toBe(false);
    expect(
      session.isCurrentSelection({
        ...selection,
        rows: [{ rowNumber: 3, input: leadInput() }],
      }),
    ).toBe(false);
  });

  it('rejects a fabricated object even when its stamps and contents match', () => {
    const session = new LeadCsvPreviewSession();
    session.open();
    const generation = beginFile(session);
    session.acceptParsed(generation, [validRow(2)]);
    session.selectRows(generation, [2]);
    const selection = requireSelection(session);
    expect(session.isCurrentSelection({ ...selection })).toBe(false);
    expect(session.isCurrentSelection(selection)).toBe(true);
  });

  it('keeps issued captures immutable including nested products and arrays', () => {
    const session = new LeadCsvPreviewSession();
    session.open();
    const generation = beginFile(session);
    session.acceptParsed(generation, [validRow(2)]);
    session.selectRows(generation, [2]);
    const selection = requireSelection(session);
    const row = selection.rows[0]!;
    expect(Reflect.set(row.input, 'shopName', '篡改输入')).toBe(false);
    expect(Reflect.set(row.input.products[0]!, 'unitPrice', '999')).toBe(false);
    expect(Reflect.set(row.input.products, '0', leadInput().products[0])).toBe(
      false,
    );
    expect(Reflect.set(row.input.infringementTypes, '0', 'OTHER')).toBe(false);
    expect(
      Reflect.set(row.input.leadScreenshotContentVersionIds, '0', 'x'),
    ).toBe(false);
    expect(Reflect.set(row, 'rowNumber', 3)).toBe(false);
    expect(
      Reflect.set(selection.rows, '0', { rowNumber: 3, input: leadInput() }),
    ).toBe(false);
    expect(Reflect.set(selection, 'rows', [])).toBe(false);
    expect(session.isCurrentSelection(selection)).toBe(true);
    expect(row.input).toEqual(leadInput());
  });

  it('preserves exact manual input fields and multiple products without re-estimating', () => {
    const session = new LeadCsvPreviewSession();
    session.open();
    const generation = beginFile(session);
    const input: CreateLeadInput = {
      ...leadInput(),
      reservedLeadId: 'reserved-a',
      shopExternalId: '00123',
      remark: '保留原输入',
      products: [
        ...leadInput().products,
        {
          url: 'https://example.com/item',
          quantity: 2,
          commentCount: 5,
          unitPrice: '99999999999999.99',
        },
      ],
      leadScreenshotContentVersionIds: ['content-version-a'],
    };
    session.acceptParsed(generation, [validRow(2, input)]);
    session.selectRows(generation, [2]);
    expect(requireSelection(session).rows[0]?.input).toEqual(input);
  });

  it('isolates stored input and row feedback from mutations of parser results or snapshots', () => {
    const session = new LeadCsvPreviewSession();
    session.open();
    const generation = beginFile(session);
    const input = leadInput();
    const infringementTypes: InfringementType[] = ['TRADEMARK'];
    const contentVersionIds = ['content-a'];
    input.infringementTypes = infringementTypes;
    input.leadScreenshotContentVersionIds = contentVersionIds;
    const expectedInput = {
      ...leadInput(),
      leadScreenshotContentVersionIds: ['content-a'],
    };
    const hints = ['疑似重复'];
    const errors = ['缺少客户'];
    session.acceptParsed(generation, [
      { rowNumber: 2, status: 'valid', input, suspectedDuplicates: hints },
      { rowNumber: 3, status: 'invalid', errors },
    ]);
    input.shopName = '外部修改';
    input.products[0]!.unitPrice = '999';
    infringementTypes.push('OTHER');
    contentVersionIds.push('content-b');
    hints.push('外部提示');
    errors.push('外部错误');
    const preview = session.snapshot();
    const row = preview.rows[0];
    if (row?.status !== 'valid')
      throw new Error('Expected a valid preview row');
    expect(row.input).toEqual(expectedInput);
    expect(row.suspectedDuplicates).toEqual(['疑似重复']);
    expect(preview.rows[1]).toEqual({
      rowNumber: 3,
      status: 'invalid',
      errors: ['缺少客户'],
    });
    row.input.products[0]!.title = '快照修改';
    session.selectRows(generation, [2]);
    const selection = requireSelection(session);
    expect(
      Reflect.set(selection.rows[0]!.input, 'shopName', '提交快照修改'),
    ).toBe(false);
    expect(requireSelection(session).rows[0]?.input).toEqual(expectedInput);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects ambiguous preview row identity %s and discards the batch',
    (rowNumber) => {
      const session = new LeadCsvPreviewSession();
      session.open();
      const generation = beginFile(session);
      expect(session.acceptParsed(generation, [validRow(rowNumber)])).toBe(
        false,
      );
      expect(session.snapshot().phase).toBe('error');
      expect(session.selection()).toBeNull();
    },
  );

  it('rejects duplicate row identities instead of selecting two inputs under one identity', () => {
    const session = new LeadCsvPreviewSession();
    session.open();
    const generation = beginFile(session);
    expect(session.acceptParsed(generation, [validRow(2), validRow(2)])).toBe(
      false,
    );
    expect(session.snapshot().rows).toEqual([]);
  });

  it('an empty or entirely invalid preview never produces a selection', () => {
    const session = new LeadCsvPreviewSession();
    session.open();
    const first = beginFile(session);
    expect(session.acceptParsed(first, [])).toBe(true);
    expect(session.selection()).toBeNull();
    const second = beginFile(session, 'B.csv');
    session.acceptParsed(second, [
      { rowNumber: 2, status: 'invalid', errors: ['缺少客户'] },
    ]);
    expect(session.selectRows(second, [2])).toBe(false);
    expect(session.selection()).toBeNull();
  });
});
