import { CaseCreationService } from './case-creation.service';

describe('CaseCreationService', () => {
  it('creates exactly one source case in the caller transaction with no invented court number', async () => {
    const tx = {
      caseNumberCounter: {
        upsert: jest.fn().mockResolvedValue({ lastValue: 12 }),
      },
      case: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'case-1', businessNo: 'CA-20260928-0012' }),
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
    ).toEqual({ id: 'case-1', businessNo: 'CA-20260928-0012' });
    expect(tx.case.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceNotaryMatterId: facts.sourceNotaryMatterId,
        certificateId: facts.certificateId,
        businessNo: 'CA-20260928-0012',
        courtCaseNo: null,
      }),
      select: { id: true, businessNo: true },
    });
  });
});
