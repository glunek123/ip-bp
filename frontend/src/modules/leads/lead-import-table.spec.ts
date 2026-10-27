import { describe, expect, it } from 'vitest';
import type { LeadCsvMappingContext } from './lead-csv-adapter';
import {
  mapLeadTableRows,
  officialLeadColumns,
  suggestLeadColumnMapping,
} from './lead-import-table';

const context: LeadCsvMappingContext = {
  operatorDisplayName: '运营甲',
  formContext: {
    customers: [
      {
        id: 'customer',
        name: '客户甲',
        rightsHolders: [{ id: 'holder', name: '主体甲' }],
      },
    ],
    dictionaries: {
      caseTypes: [{ value: 'CIVIL', label: '民事' }],
      infringementTypes: [{ value: 'TRADEMARK', label: '商标权' }],
      sources: [{ value: 'ONLINE', label: '线上' }],
      platforms: { ONLINE: [{ value: 'TAOBAO', label: '淘宝' }], OFFLINE: [] },
    },
  },
};
const values = [
  '客户甲',
  '主体甲',
  '',
  '2026-10-27',
  '民事',
  '线上',
  '淘宝',
  '甲店',
  '',
  'https://example.com/one',
  '第一件',
  '0',
  '0',
  '0',
  '',
  '',
  '否',
  '商标权',
  '运营甲',
];

describe('19-column lead import mapping', () => {
  it('accepts reordered aliases and fixed numbered product groups', () => {
    const headers = [
      ...officialLeadColumns,
      '商品名称2',
      '商品链接2',
      '销量2',
      '单价2',
      '评论数2',
      '截图2',
      '商品名称3',
      '商品链接3',
      '销量3',
      '单价3',
      '评论数3',
      '截图3',
    ];
    headers[7] = '店铺名称';
    headers[9] = '商品网址';
    const cells = [
      ...values,
      '',
      '',
      '',
      '',
      '',
      '',
      '第三件',
      'https://example.com/three',
      '2',
      '3.00',
      '0',
      'https://images.example/3.png',
    ];
    const mapping = suggestLeadColumnMapping(headers);
    expect(mapping.missingFields).toEqual([]);
    const row = mapLeadTableRows(
      [{ rowNumber: 7, cells }],
      mapping,
      context,
    )[0];
    expect(row?.status).toBe('valid');
    if (row?.status !== 'valid') return;
    expect(row.input.products).toHaveLength(2);
    expect(row.input.products[1]?.title).toBe('第三件');
    expect(row.remoteScreenshots).toEqual([
      {
        productNumber: 2,
        sourceGroupNumber: 3,
        urls: ['https://images.example/3.png'],
      },
    ]);
  });
  it('reports blanks and supplied system number at the source row', () => {
    const mapping = suggestLeadColumnMapping(officialLeadColumns);
    const cells = [...values];
    cells[2] = 'CA-USER';
    cells[11] = '';
    expect(
      mapLeadTableRows([{ rowNumber: 9, cells }], mapping, context)[0],
    ).toMatchObject({
      rowNumber: 9,
      status: 'invalid',
      errors: expect.arrayContaining([
        expect.stringContaining('案件单号由系统生成'),
        expect.stringContaining('商品1销量不能为空'),
      ]),
    });
  });
  it('leaves unknown and duplicate columns for explicit mapping', () => {
    const mapping = suggestLeadColumnMapping([
      ...officialLeadColumns,
      '客户',
      '内部编码',
    ]);
    expect(mapping.fields['客户']).toBeNull();
    expect(mapping.ambiguousColumns).toEqual([19]);
    expect(mapping.unknownColumns).toEqual([20]);
  });
});
