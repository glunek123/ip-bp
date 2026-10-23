import {
  caseListOrderBy,
  caseListTextWhere,
  caseListDepartmentTextWhere,
} from './case-list-query';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CasePageQueryDto } from './case-read.dto';
import { CaseListExportInput } from './case-list-export.dto';

describe('case list query builders', () => {
  it.each(['shopName', 'defendantName', 'courtName', 'lawyerName', 'caseType'])(
    'rejects null, repeated parameters and invalid values for %s in list and CSV',
    (key) => {
      for (const metatype of [CasePageQueryDto, CaseListExportInput]) {
        for (const value of [
          null,
          ['A', 'B'],
          123,
          key === 'caseType' ? 'OTHER' : 'x'.repeat(201),
        ]) {
          expect(
            validateSync(plainToInstance(metatype, { [key]: value }), {
              whitelist: true,
              forbidNonWhitelisted: true,
            }).map((error) => error.property),
          ).toContain(key);
        }
      }
    },
  );

  it('keeps normal and external shop/type sources disjoint, matches any defendant and only current PRIMARY lawyers', () => {
    const where = caseListTextWhere({
      shopName: ' A%_\\ ',
      caseType: 'CIVIL',
      defendantName: ' B_ ',
      lawyerName: ' C% ',
    });
    expect(where.AND).toEqual([
      {
        OR: [
          {
            AND: [
              expect.objectContaining({
                externalEntry: { is: null },
                sourceLeadId: { not: null },
                sourceNotaryMatterId: { not: null },
                certificateId: { not: null },
              }),
              {
                sourceLead: {
                  is: {
                    shopName: { contains: 'A\\%\\_\\\\', mode: 'insensitive' },
                  },
                },
              },
            ],
          },
          {
            AND: [
              expect.objectContaining({
                sourceLeadId: null,
                sourceNotaryMatterId: null,
                certificateId: null,
                externalEntry: { isNot: null },
              }),
              {
                externalEntry: {
                  is: {
                    known: {
                      path: ['shopName'],
                      string_contains: 'A\\%\\_\\\\',
                      mode: 'insensitive',
                    },
                  },
                },
              },
            ],
          },
        ],
      },
      {
        OR: [
          expect.objectContaining({
            AND: expect.arrayContaining([
              { sourceLead: { is: { caseType: 'CIVIL' } } },
            ]),
          }),
          expect.objectContaining({
            AND: expect.arrayContaining([
              {
                externalEntry: {
                  is: { known: { path: ['caseType'], equals: 'CIVIL' } },
                },
              },
            ]),
          }),
        ],
      },
      {
        defendants: {
          some: { name: { contains: 'B\\_', mode: 'insensitive' } },
        },
      },
      {
        lawyers: {
          some: {
            role: 'PRIMARY',
            endedAt: null,
            lawyer: {
              is: { fullName: { contains: 'C\\%', mode: 'insensitive' } },
            },
          },
        },
      },
    ]);
  });

  it('gates lower priority courts on absent higher sources and resolves known court IDs once by department', async () => {
    const filingCourt = {
      findMany: jest.fn().mockResolvedValue([{ id: 'court-1' }]),
    };
    const where = await caseListDepartmentTextWhere(
      { filingCourt } as never,
      'department',
      { courtName: ' 法%院 ' },
    );
    expect(filingCourt.findMany).toHaveBeenCalledWith({
      where: {
        departmentId: 'department',
        name: { contains: '法\\%院', mode: 'insensitive' },
      },
      select: { id: true },
    });
    const noAcceptanceCourt = {
      OR: [
        { acceptance: { is: null } },
        { acceptance: { is: { courtId: null } } },
      ],
    };
    expect(where.AND).toEqual([
      {
        OR: [
          {
            acceptance: {
              is: {
                court: {
                  is: { name: { contains: '法\\%院', mode: 'insensitive' } },
                },
              },
            },
          },
          {
            AND: [
              noAcceptanceCourt,
              {
                filingSubmission: {
                  is: {
                    courtName: { contains: '法\\%院', mode: 'insensitive' },
                  },
                },
              },
            ],
          },
          {
            AND: [
              noAcceptanceCourt,
              { filingSubmission: { is: null } },
              expect.objectContaining({
                sourceLeadId: null,
                sourceNotaryMatterId: null,
                certificateId: null,
              }),
              {
                externalEntry: {
                  is: {
                    OR: [{ known: { path: ['courtId'], equals: 'court-1' } }],
                  },
                },
              },
            ],
          },
        ],
      },
    ]);
    await caseListDepartmentTextWhere({ filingCourt } as never, 'department', {
      courtName: ' ',
    });
    expect(filingCourt.findMany).toHaveBeenCalledTimes(1);
  });
  it('keeps all five special filters together with old keyword filtering', () => {
    const query = {
      q: 'old',
      shopName: '店铺',
      defendantName: '被告',
      courtName: '法院',
      lawyerName: '律师',
      caseType: 'CIVIL' as const,
    };
    const where = caseListTextWhere(query);
    expect(where.AND).toHaveLength(6);
  });

  it.each([CasePageQueryDto, CaseListExportInput])(
    'accepts and trims new fields in list and inherited CSV DTO %#',
    (metatype) => {
      const query = plainToInstance(metatype, {
        shopName: ' 店铺 ',
        defendantName: ' 被告 ',
        courtName: ' 法院 ',
        lawyerName: ' 律师 ',
        caseType: 'CIVIL',
      });
      expect(
        validateSync(query, { whitelist: true, forbidNonWhitelisted: true }),
      ).toEqual([]);
      expect(query).toMatchObject({
        shopName: '店铺',
        defendantName: '被告',
        courtName: '法院',
        lawyerName: '律师',
        caseType: 'CIVIL',
      });
    },
  );
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
