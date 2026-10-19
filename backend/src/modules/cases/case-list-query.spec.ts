import { caseListOrderBy, caseListTextWhere } from './case-list-query';

describe('case list query builders', () => {
  it('escapes LIKE metacharacters literally and intersects named filters', () => {
    expect(
      caseListTextWhere({
        q: '  A%_\\  ',
        customerName: '  客%户  ',
        rightsHolderName: ' 权_利 ',
        courtCaseNo: ' (2026)\\1 ',
      }),
    ).toEqual({
      AND: [
        {
          OR: [
            { businessNo: { contains: 'A\\%\\_\\\\', mode: 'insensitive' } },
            { courtCaseNo: { contains: 'A\\%\\_\\\\', mode: 'insensitive' } },
            {
              customer: {
                is: { name: { contains: 'A\\%\\_\\\\', mode: 'insensitive' } },
              },
            },
            {
              rightsHolder: {
                is: { name: { contains: 'A\\%\\_\\\\', mode: 'insensitive' } },
              },
            },
            {
              defendants: {
                some: {
                  name: { contains: 'A\\%\\_\\\\', mode: 'insensitive' },
                },
              },
            },
          ],
        },
        {
          customer: {
            is: { name: { contains: '客\\%户', mode: 'insensitive' } },
          },
        },
        {
          rightsHolder: {
            is: { name: { contains: '权\\_利', mode: 'insensitive' } },
          },
        },
        { courtCaseNo: { contains: '(2026)\\\\1', mode: 'insensitive' } },
      ],
    });
    expect(caseListTextWhere({ q: ' ', customerName: '\t' })).toEqual({});
  });

  it('uses database sorting with a stable id tie break', () => {
    expect(caseListOrderBy({})).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
    expect(
      caseListOrderBy({ sortBy: 'businessNo', sortDirection: 'asc' }),
    ).toEqual([{ businessNo: 'asc' }, { id: 'asc' }]);
    expect(caseListOrderBy({ sortBy: 'rightsHolderName' })).toEqual([
      { rightsHolder: { name: 'desc' } },
      { id: 'asc' },
    ]);
  });
});
