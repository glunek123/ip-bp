import { describe, expect, it } from 'vitest';
import {
  caseListQueryKey,
  parseCaseListQuery,
  serializeCaseListQuery,
} from './case-list-query';

describe('case list query URL contract', () => {
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
