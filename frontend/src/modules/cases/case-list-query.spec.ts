import { describe, expect, it } from 'vitest';
import {
  caseListQueryKey,
  parseCaseListQuery,
  serializeCaseListQuery,
} from './case-list-query';

describe('case list query URL contract', () => {
  it('keeps every supported text filter and case type while ignoring sort parameters', () => {
    const parsed = parseCaseListQuery({
      q: '  法院甲  ',
      caseType: 'CIVIL',
      customerName: ' 客户甲 ',
      rightsHolderName: '权利方甲',
      courtCaseNo: '案号甲',
      shopName: '店铺甲',
      defendantName: '被告甲',
      courtName: '法院甲',
      lawyerName: '律师甲',
      sortBy: 'businessNo',
      sortDirection: 'asc',
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        q: '法院甲',
        customerName: '客户甲',
        rightsHolderName: '权利方甲',
        courtCaseNo: '案号甲',
        shopName: '店铺甲',
        defendantName: '被告甲',
        courtName: '法院甲',
        lawyerName: '律师甲',
        caseType: 'CIVIL',
      },
    });
    if (!parsed.ok) throw new Error('Expected valid query');
    expect(serializeCaseListQuery(parsed.value)).toEqual({
      q: '法院甲',
      customerName: '客户甲',
      rightsHolderName: '权利方甲',
      courtCaseNo: '案号甲',
      shopName: '店铺甲',
      defendantName: '被告甲',
      courtName: '法院甲',
      lawyerName: '律师甲',
      caseType: 'CIVIL',
    });
    expect(caseListQueryKey(parsed.value)).toBe(
      'q=%E6%B3%95%E9%99%A2%E7%94%B2&customerName=%E5%AE%A2%E6%88%B7%E7%94%B2&rightsHolderName=%E6%9D%83%E5%88%A9%E6%96%B9%E7%94%B2&courtCaseNo=%E6%A1%88%E5%8F%B7%E7%94%B2&shopName=%E5%BA%97%E9%93%BA%E7%94%B2&defendantName=%E8%A2%AB%E5%91%8A%E7%94%B2&courtName=%E6%B3%95%E9%99%A2%E7%94%B2&lawyerName=%E5%BE%8B%E5%B8%88%E7%94%B2&caseType=CIVIL',
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
    [{ courtName: ['重复', '条件'] }, '必须且只能出现一次'],
    [{ lawyerName: 'x'.repeat(201) }, '不能超过200个字符'],
    [{ caseType: 'OTHER' }, '案件类型无效'],
  ])('rejects invalid active filter %j', (query, message) => {
    const result = parseCaseListQuery(query);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(message);
  });

  it('ignores unsupported sort fields rather than applying hidden conditions', () => {
    expect(parseCaseListQuery({ sortBy: 'id', sortDirection: 'asc' })).toEqual({
      ok: true,
      value: {},
    });
  });
});
