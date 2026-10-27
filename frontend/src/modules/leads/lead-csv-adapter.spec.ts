import { describe, expect, it } from 'vitest';
import type { LeadFormContext } from '../../api/leads';
import {
  createLeadCsvTemplate,
  LeadCsvHeaderError,
  parseLeadCsvPreview,
  type LeadCsvMappingContext,
} from './lead-csv-adapter';
import { LeadCsvParseError } from './lead-csv-parser';

const header = [
  '客户',
  '权利主体',
  '案件类型',
  '运营',
  '线索来源',
  '平台',
  '侵权类型',
  '线索发现日期',
  '店铺名',
  '店铺ID',
  '是否需要披露',
  '线索备注',
  '商品链接',
  '商品名称',
  '销量',
  '单价',
  '评论数',
];
const context: LeadCsvMappingContext = {
  operatorDisplayName: '真实运营',
  formContext: {
    operators: [
      { id: 'operator-1', displayName: '真实运营', username: 'operator.one' },
    ],
    customers: [
      {
        id: 'customer-1',
        name: '甲客户',
        rightsHolders: [{ id: 'holder-1', name: '甲主体' }],
      },
    ],
    dictionaries: {
      caseTypes: [{ value: 'CIVIL', label: '民事' }],
      infringementTypes: [
        { value: 'TRADEMARK', label: '商标权' },
        { value: 'ART_COPYRIGHT', label: '美术作品著作权' },
      ],
      sources: [
        { value: 'ONLINE', label: '线上' },
        { value: 'OFFLINE', label: '线下' },
      ],
      platforms: {
        ONLINE: [{ value: 'TAOBAO', label: '淘宝' }],
        OFFLINE: [{ value: 'OTHER', label: '其他' }],
      },
    },
  } satisfies LeadFormContext,
};
const encoder = new TextEncoder();
const base = [
  '甲客户',
  '',
  '民事',
  '',
  '线上',
  '淘宝',
  '商标权、美术作品著作权',
  '2026-10-19 10:00',
  '甲店铺',
  '',
  '否',
  '备注',
  '',
  '商品甲',
  '0',
  '1.50',
  '3',
];

function csv(rows: readonly string[][], columns = header): Uint8Array {
  return encoder.encode(
    [columns.join(','), ...rows.map((row) => row.join(','))].join('\r\n'),
  );
}

describe('lead CSV business adapter', () => {
  it('keeps blank legacy operator for the actor and resolves a different unique username', () => {
    const blank = parseLeadCsvPreview(csv([base]), context)[0];
    expect(blank).toMatchObject({ status: 'valid' });
    if (blank?.status === 'valid') expect(blank.operatorText).toBeUndefined();
    const named = [...base];
    named[3] = ' ＯＰＥＲＡＴＯＲ．ＯＮＥ ';
    const parsed = parseLeadCsvPreview(csv([named]), context)[0];
    expect(parsed).toMatchObject({
      status: 'valid',
      operatorText: 'ＯＰＥＲＡＴＯＲ．ＯＮＥ',
    });
    const ambiguousContext = {
      ...context,
      formContext: {
        ...context.formContext,
        operators: [
          { id: 'first', displayName: '同名', username: 'first' },
          { id: 'second', displayName: '同名', username: 'second' },
        ],
      },
    };
    named[3] = '同名';
    expect(
      parseLeadCsvPreview(csv([named]), ambiguousContext)[0],
    ).toMatchObject({
      status: 'invalid',
      errors: [expect.stringContaining('歧义')],
    });
  });
  it('requires an explicit unit price while accepting a known zero', () => {
    const emptyPrice = [...base];
    emptyPrice[15] = '';
    const blankPricePreview = parseLeadCsvPreview(csv([emptyPrice]), context);
    expect(blankPricePreview[0]).toMatchObject({
      status: 'invalid',
      errors: ['商品1单价不能为空；已知为零请填0或0.00'],
    });

    const knownZero = [...emptyPrice];
    knownZero[15] = '0.00';
    const knownZeroPreview = parseLeadCsvPreview(csv([knownZero]), context);
    expect(knownZeroPreview[0]).toMatchObject({
      status: 'valid',
      input: {
        products: [{ quantity: 0, unitPrice: '0.00', commentCount: 3 }],
      },
    });
  });

  it('maps exact authorized identities, multiple products, Shanghai time and explicit zeros', () => {
    const columns = [
      ...header,
      '商品2链接',
      '商品2名称',
      '商品2销量',
      '商品2单价',
      '商品2评论数',
    ];
    const row = [...base, 'https://example.com/p', '', '2', '2.25', '0'];
    const parsed = parseLeadCsvPreview(csv([row], columns), context);
    expect(parsed).toEqual([
      {
        rowNumber: 2,
        status: 'valid',
        suspectedDuplicates: [],
        input: {
          customerId: 'customer-1',
          rightsHolderId: 'holder-1',
          caseType: 'CIVIL',
          infringementTypes: ['TRADEMARK', 'ART_COPYRIGHT'],
          source: 'ONLINE',
          platform: 'TAOBAO',
          foundAt: '2026-10-19T02:00:00.000Z',
          shopName: '甲店铺',
          needDisclose: false,
          remark: '备注',
          products: [
            {
              title: '商品甲',
              quantity: 0,
              unitPrice: '1.50',
              commentCount: 3,
            },
            {
              url: 'https://example.com/p',
              quantity: 2,
              unitPrice: '2.25',
              commentCount: 0,
            },
          ],
          leadScreenshotContentVersionIds: [],
        },
      },
    ]);
  });

  it('keeps physical start lines and marks only complete in-file duplicates', () => {
    const first = [...base];
    const quoted = [...base];
    quoted[11] = '"备注\r\n第二行"';
    const parsed = parseLeadCsvPreview(csv([first, first, quoted]), context);
    expect(parsed.map((row) => row.rowNumber)).toEqual([2, 3, 4]);
    expect(parsed[1]).toMatchObject({
      status: 'valid',
      suspectedDuplicates: ['疑似与本文件第2行完整输入重复'],
    });
    expect(parsed[2]).toMatchObject({
      status: 'valid',
      suspectedDuplicates: [],
    });
    const afterQuoted = parseLeadCsvPreview(csv([quoted, first]), context);
    expect(afterQuoted.map((row) => row.rowNumber)).toEqual([2, 4]);
  });

  it('ignores empty records but preserves invalid nonempty rows and explicit offset time', () => {
    const row = [...base];
    row[1] = '甲主体';
    row[3] = '真实运营';
    row[6] = '商标权、TRADEMARK';
    row[7] = '2026-10-19T10:00:00+08:00';
    const bad = [...row];
    bad[7] = '2026-10-19T10:00:00';
    const parsed = parseLeadCsvPreview(
      csv([Array(17).fill(''), row, bad]),
      context,
    );
    expect(parsed.map((item) => item.rowNumber)).toEqual([3, 4]);
    expect(parsed[0]).toMatchObject({
      status: 'valid',
      input: {
        foundAt: '2026-10-19T02:00:00.000Z',
        infringementTypes: ['TRADEMARK'],
      },
    });
    expect(parsed[1]).toMatchObject({ status: 'invalid' });
  });

  it('keeps business mistakes as unselectable rows without guessing names or zeroing invalid numbers', () => {
    const wrong = [...base];
    wrong[0] = '未知客户';
    wrong[3] = '别的运营';
    wrong[7] = '2026-02-30';
    wrong[12] = 'javascript:alert(1)';
    wrong[14] = '-2';
    wrong[15] = '"1,000"';
    const parsed = parseLeadCsvPreview(csv([wrong]), context);
    expect(parsed[0]?.status).toBe('invalid');
    if (parsed[0]?.status !== 'invalid')
      throw new Error('Expected invalid row');
    expect(parsed[0].errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('客户名称'),
        expect.stringContaining('运营'),
        expect.stringContaining('日历'),
        expect.stringContaining('商品1链接'),
        expect.stringContaining('商品1销量'),
      ]),
    );
  });

  it('rejects ambiguous holders, mismatched source/platform and missing disclosure', () => {
    const ambiguous = {
      ...context,
      formContext: {
        ...context.formContext,
        customers: [
          {
            ...context.formContext.customers[0]!,
            rightsHolders: [
              { id: 'holder-1', name: '同名' },
              { id: 'holder-2', name: '同名' },
            ],
          },
        ],
      },
    };
    const row = [...base];
    row[1] = '同名';
    row[4] = '线下';
    row[10] = '';
    const parsed = parseLeadCsvPreview(csv([row]), ambiguous);
    expect(parsed[0]).toMatchObject({ status: 'invalid' });
    if (parsed[0]?.status !== 'invalid')
      throw new Error('Expected invalid row');
    expect(parsed[0].errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('权利主体'),
        expect.stringContaining('平台'),
        expect.stringContaining('披露'),
      ]),
    );
  });

  it('rejects structural header and width errors for the whole file', () => {
    expect(() =>
      parseLeadCsvPreview(csv([base], [...header].reverse()), context),
    ).toThrow(LeadCsvHeaderError);
    expect(() =>
      parseLeadCsvPreview(csv([base.slice(0, 16)]), context),
    ).toThrow(LeadCsvHeaderError);
    expect(() =>
      parseLeadCsvPreview(encoder.encode('"broken'), context),
    ).toThrow(LeadCsvParseError);
  });

  it('uses backend NFKC text rules before length checks and duplicate comparison', () => {
    const first = [...base];
    first[8] = 'Ａ店铺';
    first[9] = 'ＩＤ';
    first[12] = 'https://example.com/Ａ';
    const same = [...base];
    same[8] = 'A店铺';
    same[9] = 'ID';
    same[12] = 'https://example.com/A';
    const long = [...base];
    long[8] = 'ﬃ'.repeat(67);
    const longProduct = [...base];
    longProduct[13] = 'ﬃ'.repeat(67);
    const longRemark = [...base];
    longRemark[11] = 'ﬃ'.repeat(1667);
    const parsed = parseLeadCsvPreview(
      csv([first, same, long, longProduct, longRemark]),
      context,
    );
    expect(parsed[0]).toMatchObject({
      status: 'valid',
      input: {
        shopName: 'A店铺',
        shopExternalId: 'ID',
        products: [{ url: 'https://example.com/A' }],
      },
    });
    expect(parsed[1]).toMatchObject({
      status: 'valid',
      suspectedDuplicates: ['疑似与本文件第2行完整输入重复'],
    });
    expect(parsed[2]).toMatchObject({ status: 'invalid' });
    if (parsed[2]?.status !== 'invalid')
      throw new Error('Expected invalid row');
    expect(parsed[2].errors).toEqual(
      expect.arrayContaining([expect.stringContaining('店铺名')]),
    );
    expect(parsed[3]).toMatchObject({ status: 'invalid' });
    expect(parsed[4]).toMatchObject({ status: 'invalid' });
  });

  it('checks product estimate with exact cents and accepts a valid IPv6 HTTP URL', () => {
    const boundary = [...base];
    boundary[12] = 'http://[::1]/p';
    boundary[13] = '';
    boundary[14] = '1';
    boundary[15] = '9999999999999999.99';
    const over = [...boundary];
    over[14] = '2';
    const parsed = parseLeadCsvPreview(csv([boundary, over]), context);
    expect(parsed[0]).toMatchObject({
      status: 'valid',
      input: { products: [{ url: 'http://[::1]/p' }] },
    });
    expect(parsed[1]).toMatchObject({ status: 'invalid' });
    if (parsed[1]?.status !== 'invalid')
      throw new Error('Expected invalid row');
    expect(parsed[1].errors).toEqual(
      expect.arrayContaining([expect.stringContaining('估算额超过')]),
    );
  });

  it('matches DTO URL host rules for whitespace, localhost, domains and IP literals', () => {
    const makeRow = (url: string) => {
      const row = [...base];
      row[12] = url;
      return row;
    };
    const parsed = parseLeadCsvPreview(
      csv([
        makeRow('https://example.com/a b'),
        makeRow('http://localhost/p'),
        makeRow('http://:@example.com/p'),
        makeRow('http://[::1]:/p'),
        makeRow('HTTPS://EXAMPLE.COM/p'),
        makeRow('http://example.com:/p'),
        makeRow('http://127.0.0.1/p'),
        makeRow('http://[0:0:0:0:0:0:0:1]/p'),
      ]),
      context,
    );
    for (const index of [0, 1, 2, 3]) {
      expect(parsed[index]).toMatchObject({ status: 'invalid' });
      if (parsed[index]?.status !== 'invalid')
        throw new Error('Expected invalid URL row');
      expect(parsed[index].errors).toEqual(
        expect.arrayContaining([expect.stringContaining('商品1链接')]),
      );
    }
    for (const index of [4, 5, 6, 7])
      expect(parsed[index]).toMatchObject({ status: 'valid' });
  });

  it('accepts pure digit counts with redundant zero prefixes but rejects the numeric bound', () => {
    const padded = [...base];
    padded[14] = `000${'0'.repeat(30)}1`;
    padded[16] = '001';
    const over = [...base];
    over[14] = '0002147483648';
    const parsed = parseLeadCsvPreview(csv([padded, over]), context);
    expect(parsed[0]).toMatchObject({
      status: 'valid',
      input: { products: [{ quantity: 1, commentCount: 1 }] },
    });
    expect(parsed[1]).toMatchObject({ status: 'invalid' });
  });

  it('uses historical Shanghai offset with seconds and rejects ambiguous or missing wall times', () => {
    const old = [...base];
    old[7] = '1900-01-01 10:00:00';
    const gap = [...base];
    gap[7] = '1988-04-17 02:30';
    const repeated = [...base];
    repeated[7] = '1988-09-11 01:30';
    const parsed = parseLeadCsvPreview(csv([old, gap, repeated]), context);
    expect(parsed[0]).toMatchObject({
      status: 'valid',
      input: { foundAt: '1900-01-01T01:54:17.000Z' },
    });
    expect(parsed[1]).toMatchObject({ status: 'invalid' });
    expect(parsed[2]).toMatchObject({ status: 'invalid' });
  });

  it('accepts a complete 100-product header and enforces record limit including blank records', () => {
    const columns = [...header];
    const row = [...base];
    for (let product = 2; product <= 100; product++) {
      columns.push(
        `商品${product}链接`,
        `商品${product}名称`,
        `商品${product}销量`,
        `商品${product}单价`,
        `商品${product}评论数`,
      );
      row.push(
        '',
        product === 100 ? '末商品' : '',
        product === 100 ? '0' : '',
        product === 100 ? '0.00' : '',
        product === 100 ? '0' : '',
      );
    }
    const parsed = parseLeadCsvPreview(csv([row], columns), context);
    expect(columns).toHaveLength(512);
    expect(parsed[0]).toMatchObject({ status: 'valid' });
    if (parsed[0]?.status !== 'valid') throw new Error('Expected valid row');
    expect(parsed[0].input.products).toHaveLength(2);

    const blankRecords = `${header.join(',')}\n${'\n'.repeat(1000)}`;
    expect(parseLeadCsvPreview(encoder.encode(blankRecords), context)).toEqual(
      [],
    );
    expect(() =>
      parseLeadCsvPreview(encoder.encode(`${blankRecords}\n`), context),
    ).toThrow(LeadCsvParseError);
  });

  it('produces a safe, immediately fillable 17-column template', () => {
    const template = createLeadCsvTemplate(context);
    expect(template).toBe(`${header.join(',')}\r\n`);
    expect(template).not.toContain('真实运营');
    expect(template).not.toContain('甲客户');
  });
});
