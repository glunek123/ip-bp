import { describe, expect, it } from 'vitest';
import {
  caseListQueryKey,
  parseCaseListQuery,
  serializeCaseListQuery,
} from './case-list-query';

describe('case list query URL contract', () => {
  it('normalizes all five specialized filters and includes each in the request key', () => {
    const query = {
      shopName: ' 店铺&甲 ',
      defendantName: ' 被告乙 ',
      courtName: ' 法院丙 ',
      lawyerName: ' 律师丁 ',
      caseType: 'CIVIL',
    };
    const parsed = parseCaseListQuery(query);
    expect(parsed).toEqual({
      ok: true,
      value: {
        shopName: '店铺&甲',
        defendantName: '被告乙',
        courtName: '法院丙',
        lawyerName: '律师丁',
        caseType: 'CIVIL',
      },
    });
    if (!parsed.ok) throw new Error('Expected valid query');
    expect(serializeCaseListQuery(parsed.value)).toEqual(parsed.value);
    for (const key of Object.keys(query))
      expect(caseListQueryKey(parsed.value)).toContain(`${key}=`);
  });

  it.each(['shopName', 'defendantName', 'courtName', 'lawyerName'])(
    'strictly validates specialized text %s',
    (key) => {
      expect(parseCaseListQuery({ [key]: ['a', 'b'] }).ok).toBe(false);
      expect(parseCaseListQuery({ [key]: null }).ok).toBe(false);
      expect(parseCaseListQuery({ [key]: 12 }).ok).toBe(false);
      expect(parseCaseListQuery({ [key]: 'a'.repeat(201) }).ok).toBe(false);
      expect(parseCaseListQuery({ [key]: '😀\uFE0F'.repeat(200) })).toEqual({
        ok: true,
        value: { [key]: '😀\uFE0F'.repeat(200) },
      });
      expect(parseCaseListQuery({ [key]: '  ' })).toEqual({
        ok: true,
        value: {},
      });
    },
  );

  it.each([
    'CIVIL',
    'CRIMINAL',
    'ADMINISTRATIVE',
    'INVESTIGATION',
    'NOTARIZATION',
    'HEARING_REPRESENTATION',
  ])('accepts the real case type %s', (caseType) => {
    expect(parseCaseListQuery({ caseType })).toEqual({
      ok: true,
      value: { caseType },
    });
  });

  it.each(['', 'OTHER', ['CIVIL', 'CIVIL'], null, 3])(
    'rejects invalid case type %j without widening the list',
    (caseType) => {
      expect(parseCaseListQuery({ caseType }).ok).toBe(false);
    },
  );
  it('trims text, drops blanks and retains only the six supported fields', () => {
    const parsed = parseCaseListQuery({
      q: '  被告甲  ',
      customerName: ' 客户 ',
      rightsHolderName: '   ',
      courtCaseNo: '（2026）民初1号',
      sortBy: 'businessNo',
      sortDirection: 'asc',
      unknown: 'ignored by the route owner',
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        q: '被告甲',
        customerName: '客户',
        courtCaseNo: '（2026）民初1号',
        sortBy: 'businessNo',
        sortDirection: 'asc',
      },
    });
    if (parsed.ok) {
      expect(serializeCaseListQuery(parsed.value)).toEqual({
        q: '被告甲',
        customerName: '客户',
        courtCaseNo: '（2026）民初1号',
        sortBy: 'businessNo',
        sortDirection: 'asc',
      });
    }
  });

  it.each([
    [{ q: ['重复', '条件'] }, '必须且只能出现一次'],
    [{ sortBy: 'id' }, '排序字段无效'],
    [{ sortDirection: 'sideways' }, '排序方向无效'],
    [{ customerName: 'x'.repeat(201) }, '不能超过200个字符'],
  ])('rejects invalid or repeated values: %j', (query, message) => {
    const result = parseCaseListQuery(query);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(message);
  });

  it.each([
    'a'.repeat(101),
    'a'.repeat(200),
    'a\uFE0F'.repeat(200),
    '😀\uFE0F'.repeat(200),
  ])('accepts legal query length case %#', (value) => {
    expect(parseCaseListQuery({ q: value })).toEqual({
      ok: true,
      value: { q: value },
    });
  });

  it('rejects 201 backend-counted characters, including variation selector pairs', () => {
    expect(parseCaseListQuery({ q: 'x'.repeat(201) }).ok).toBe(false);
    expect(parseCaseListQuery({ q: 'a\uFE0F'.repeat(201) }).ok).toBe(false);
  });

  it('builds a deterministic request key using only supported scalar fields', () => {
    expect(
      caseListQueryKey({
        q: '甲&乙',
        sortBy: 'createdAt',
        sortDirection: 'desc',
      }),
    ).toBe('q=%E7%94%B2%26%E4%B9%99&sortBy=createdAt&sortDirection=desc');
  });
});
