import { describe, expect, it } from 'vitest';
import {
  caseListQueryKey,
  parseCaseListQuery,
  serializeCaseListQuery,
} from './case-list-query';

describe('case list query URL contract', () => {
  it('keeps only the unified keyword and case type, ignoring old saved text and sort parameters', () => {
    const parsed = parseCaseListQuery({
      q: '  法院甲  ',
      caseType: 'CIVIL',
      customerName: '旧客户',
      shopName: '旧店铺',
      sortBy: 'businessNo',
      sortDirection: 'asc',
    });
    expect(parsed).toEqual({
      ok: true,
      value: { q: '法院甲', caseType: 'CIVIL' },
    });
    if (!parsed.ok) throw new Error('Expected valid query');
    expect(serializeCaseListQuery(parsed.value)).toEqual({
      q: '法院甲',
      caseType: 'CIVIL',
    });
    expect(caseListQueryKey(parsed.value)).toBe(
      'q=%E6%B3%95%E9%99%A2%E7%94%B2&caseType=CIVIL',
    );
  });

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

  it.each([
    [{ q: ['重复', '条件'] }, '必须且只能出现一次'],
    [{ q: 'x'.repeat(201) }, '不能超过200个字符'],
    [{ caseType: 'OTHER' }, '案件类型无效'],
  ])('rejects invalid active filter %j', (query, message) => {
    const result = parseCaseListQuery(query);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(message);
  });

  it('ignores invalid legacy fields rather than applying hidden conditions', () => {
    expect(parseCaseListQuery({ sortBy: 'id', shopName: ['a', 'b'] })).toEqual({
      ok: true,
      value: {},
    });
  });
});
