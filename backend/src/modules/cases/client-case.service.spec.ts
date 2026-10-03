import { ClientCaseService } from './client-case.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  clientCustomerId: '33333333-3333-4333-8333-333333333333',
  authorizationRevision: 1,
};
const caseId = '44444444-4444-4444-8444-444444444444';

describe('ClientCaseService', () => {
  function fixture() {
    const db = {
      customerAccountBinding: {
        findFirst: jest.fn().mockResolvedValue({ id: 'binding-1' }),
      },
      case: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: caseId,
            businessNo: 'CA-1',
            stage: 'WAITING_COMPLAINT_STAMP',
            version: 4,
            rightsHolder: { name: '持权企业' },
            defendants: [{ name: '被告企业' }],
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue({
          id: caseId,
          businessNo: 'CA-1',
          stage: 'WAITING_COMPLAINT_STAMP',
          version: 4,
          rightsHolder: { name: '持权企业' },
          defendants: [{ name: '被告企业' }],
          complaintConfirmation: {
            confirmedAt: new Date('2026-10-02T01:00:00Z'),
            confirmedComplaintContentVersionId: 'confirmed-version',
            amountState: 'KNOWN',
            amount: { toString: () => '123.45' },
          },
          complaintMailing: null,
        }),
      },
    };
    const materials = {
      listOwnerMaterials: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'complaint-material',
            category: 'COMPLAINT',
            contentVersions: [
              {
                id: 'confirmed-version',
                originalFilename: '确认诉状.pdf',
                mimeType: 'application/pdf',
              },
            ],
          },
          {
            id: 'auth-material',
            category: 'AUTHORIZATION',
            contentVersions: [
              {
                id: 'auth-version',
                originalFilename: '授权书.pdf',
                mimeType: 'application/pdf',
              },
            ],
          },
        ],
        total: 2,
      }),
    };
    return {
      db,
      materials,
      service: new ClientCaseService(db as never, materials as never),
    };
  }

  it('uses department, enterprise and confirmed case predicates for pending list', async () => {
    const f = fixture();
    const result = await f.service.list(actor, 'PENDING', 1, 20);
    expect(result.items).toMatchObject([
      {
        id: caseId,
        stage: 'WAITING_COMPLAINT_STAMP',
        rightsHolderName: '持权企业',
        defendantNames: ['被告企业'],
      },
    ]);
    expect(f.db.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: actor.departmentId,
          customerId: actor.clientCustomerId,
          complaintConfirmation: { isNot: null },
          stage: 'WAITING_COMPLAINT_STAMP',
        }),
      }),
    );
  });

  it('projects only confirmed file, submitted authorization and safe mailing facts', async () => {
    const f = fixture();
    const detail = await f.service.get(actor, caseId);
    expect(detail).toMatchObject({
      id: caseId,
      complaintFile: { contentVersionId: 'confirmed-version' },
      authorizationFiles: [{ contentVersionId: 'auth-version' }],
      rightsHolderName: '持权企业',
      defendantNames: ['被告企业'],
      confirmedAmountState: 'KNOWN',
      confirmedAmount: '123.45',
      complaintMailing: null,
      canMailComplaint: true,
    });
    expect(detail).not.toHaveProperty('fees');
    expect(detail).not.toHaveProperty('owner');
    expect(detail).not.toHaveProperty('complaintAmount');
  });

  it('refuses a revoked binding and never queries cases', async () => {
    const f = fixture();
    f.db.customerAccountBinding.findFirst.mockResolvedValue(null);
    await expect(f.service.list(actor, 'PENDING', 1, 20)).rejects.toMatchObject(
      {
        response: { code: 'ACTION_FORBIDDEN' },
      },
    );
    expect(f.db.case.findMany).not.toHaveBeenCalled();
  });
});
