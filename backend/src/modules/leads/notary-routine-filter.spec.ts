import {
  matchingNotaryRightsHolderIds,
  notaryKeywordWhere,
  notaryRoutineShopWhere,
} from './notary-routine-filter';

describe('notary routine keyword filter', () => {
  it('resolves matching holder IDs inside the actor department', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'holder-id' }]);
    await expect(
      matchingNotaryRightsHolderIds(
        { rightsHolder: { findMany } } as never,
        'department-id',
        ' 名_% ',
      ),
    ).resolves.toEqual(['holder-id']);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        departmentId: 'department-id',
        name: { contains: '名\\_\\%', mode: 'insensitive' },
      },
      select: { id: true },
    });
  });

  it('keeps number and shop branches when no holder name matches', () => {
    expect(notaryKeywordWhere('NT', []).OR).toEqual(
      expect.arrayContaining([
        { businessNo: { contains: 'NT', mode: 'insensitive' } },
        { rightsHolderId: { in: [] } },
        notaryRoutineShopWhere('NT'),
      ]),
    );
  });
  it('matches party names and numbers while using only the effective shop', () => {
    const keyword = ' 名_% ';
    const match = { contains: '名\\_\\%', mode: 'insensitive' };

    expect(notaryKeywordWhere(keyword, ['holder-id'])).toEqual({
      OR: [
        { businessNo: match },
        { sourceLead: { is: { customer: { is: { name: match } } } } },
        { rightsHolderId: { in: ['holder-id'] } },
        { sourceLead: { is: { businessNo: match } } },
        notaryRoutineShopWhere(keyword),
      ],
    });
    expect(notaryRoutineShopWhere(keyword)).toEqual({
      OR: [
        { routineProfile: { is: { shopName: match } } },
        {
          routineProfile: { is: null },
          sourceLead: { is: { shopName: match } },
        },
      ],
    });
  });
});
