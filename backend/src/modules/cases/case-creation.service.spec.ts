import { CaseCreationService } from './case-creation.service';

describe('CaseCreationService', () => {
  it('creates exactly one source case in the caller transaction with no invented court number', async () => {
    const tx = {
      $queryRawUnsafe: jest
        .fn()
        .mockImplementation(async (sql: string) =>
          sql.includes('customer_business_number_counters')
            ? [{ last_value: 5n }]
            : [{ business_no: '00120260928005', business_id: '001' }],
        ),
      case: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _max: { sourceLeadOrdinal: null } }),
        create: jest
          .fn()
          .mockResolvedValue({ id: 'case-1', businessNo: '00120260928005' }),
      },
    };
    const facts = {
      departmentId: 'department-1',
      sourceLeadId: 'lead-1',
      sourceNotaryMatterId: 'matter-1',
      certificateId: 'certificate-1',
      customerId: 'customer-1',
      rightsHolderId: 'rights-1',
      responsibleUserId: 'owner-1',
      issuedAt: new Date('2026-09-28T00:00:00.000Z'),
    };
    expect(
      await new CaseCreationService().createFromNotaryCertificate(
        tx as never,
        facts,
      ),
    ).toEqual({ id: 'case-1', businessNo: '00120260928005' });
    expect(tx.case.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceNotaryMatterId: facts.sourceNotaryMatterId,
        certificateId: facts.certificateId,
        businessNo: '00120260928005',
        sourceLeadOrdinal: 1,
        courtCaseNo: null,
      }),
      select: { id: true, businessNo: true },
    });
  });

  it('uses -02 for the second case of the same source lead without a daily allocation', async () => {
    const tx = {
      $queryRawUnsafe: jest
        .fn()
        .mockImplementation(async (sql: string) =>
          sql.includes('customer_business_number_counters')
            ? [{ last_value: 5n }]
            : [{ business_no: '00120261026005', business_id: '001' }],
        ),
      case: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _max: { sourceLeadOrdinal: 1 } }),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'case-2',
          businessNo: data.businessNo,
        })),
      },
    };
    const result = await new CaseCreationService().createFromNotaryCertificate(
      tx as never,
      {
        departmentId: 'department-1',
        sourceLeadId: 'lead-1',
        sourceNotaryMatterId: 'matter-2',
        certificateId: 'certificate-2',
        customerId: 'customer-1',
        rightsHolderId: 'rights-1',
        responsibleUserId: 'owner-1',
        issuedAt: new Date('2026-10-27T00:00:00Z'),
      },
    );
    expect(result.businessNo).toBe('00120261026005-02');
    expect(tx.case.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceLeadOrdinal: 2,
          businessNo: '00120261026005-02',
        }),
      }),
    );
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it.each([
    { name: 'unready global sequence', businessId: '001', lastValue: -1n },
    { name: 'uninitialized source customer', businessId: null, lastValue: 5n },
  ])(
    'refuses source case creation with $name',
    async ({ businessId, lastValue }) => {
      const tx = {
        $queryRawUnsafe: jest
          .fn()
          .mockImplementation(async (sql: string) =>
            sql.includes('customer_business_number_counters')
              ? [{ last_value: lastValue }]
              : [{ business_no: 'LD-20261026-001', business_id: businessId }],
          ),
        case: { aggregate: jest.fn(), create: jest.fn() },
      };
      await expect(
        new CaseCreationService().createFromNotaryCertificate(tx as never, {
          departmentId: 'department-1',
          sourceLeadId: 'lead-1',
          sourceNotaryMatterId: 'matter-1',
          certificateId: 'certificate-1',
          customerId: 'customer-1',
          rightsHolderId: 'rights-1',
          responsibleUserId: 'owner-1',
          issuedAt: new Date('2026-10-26T00:00:00Z'),
        }),
      ).rejects.toMatchObject({
        response: { code: 'CUSTOMER_NUMBER_NOT_INITIALIZED' },
      });
      expect(tx.case.aggregate).not.toHaveBeenCalled();
      expect(tx.case.create).not.toHaveBeenCalled();
    },
  );
});
