import { ClientCaseService } from './client-case.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  clientCustomerId: '33333333-3333-4333-8333-333333333333',
  authorizationRevision: 1,
};
const caseId = '44444444-4444-4444-8444-444444444444';

describe('ClientCaseService', () => {
  it.each(['WAITING_ARCHIVE', 'ARCHIVED'])(
    'keeps %s in RECORDED with only the existing client projection',
    async (stage) => {
      const f = fixture();
      const original = await f.db.case.findFirst();
      const poisoned = {
        ...original,
        stage,
        version: 25,
        executionFinish: {
          id: 'secret',
          reason: 'secret',
          basisNote: 'secret',
          finishedAt: new Date(),
        },
        finishedAt: 'secret',
        auditEventId: 'secret',
        archive: { archiveReason: 'secret', recordedByUserId: 'secret' },
        closure: { closeAmt: '123.45', note: 'secret' },
      };
      f.db.case.findFirst.mockResolvedValue(poisoned);
      f.db.case.findMany.mockResolvedValue([poisoned]);
      const list = await f.service.list(actor, 'RECORDED', 1, 20);
      const detail = await f.service.get(actor, caseId);
      expect(list.items[0].stage).toBe(stage);
      expect(detail.stage).toBe(stage);
      for (const projection of [list.items[0], detail])
        for (const key of [
          'executionFinish',
          'finishId',
          'finishedAt',
          'reason',
          'basisNote',
          'auditEventId',
          'canFinishExecution',
          'archive',
          'closure',
          'closeAmt',
          'archiveReason',
          'canArchive',
          'canCorrectArchive',
        ])
          expect(projection).not.toHaveProperty(key);
      expect(f.db.case.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            stage: { in: expect.arrayContaining([stage]) },
          }),
        }),
      );
    },
  );
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
            executionConfirmation: null,
            executionMailing: null,
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
          executionConfirmation: null,
          executionMailing: null,
        }),
      },
    };
    const materials = {
      listFrozenCaseComplaintMailingFiles: jest.fn().mockResolvedValue([]),
      listFrozenCaseExecutionMailingFiles: jest.fn().mockResolvedValue([]),
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
          stage: {
            in: ['WAITING_COMPLAINT_STAMP', 'WAITING_EXECUTION_STAMP'],
          },
        }),
      }),
    );
  });

  it('keeps a judgment-stage case in the client recorded projection without internal hearing facts', async () => {
    const f = fixture();
    f.db.case.findMany.mockResolvedValue([
      {
        id: caseId,
        businessNo: 'CA-1',
        stage: 'WAITING_JUDGMENT',
        version: 9,
        rightsHolder: { name: '持权企业' },
        defendants: [],
      },
    ]);
    const result = await f.service.list(actor, 'RECORDED', 1, 20);
    expect(result.items[0].stage).toBe('WAITING_JUDGMENT');
    expect(result.items[0]).not.toHaveProperty('hearing');
    expect(f.db.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stage: { in: expect.arrayContaining(['WAITING_JUDGMENT']) },
        }),
      }),
    );
  });

  it('keeps a second-instance case visible to the client without exposing internal second-instance facts', async () => {
    const f = fixture();
    f.db.case.findMany.mockResolvedValue([
      {
        id: caseId,
        businessNo: 'CA-1',
        stage: 'SECOND_INSTANCE',
        version: 12,
        rightsHolder: { name: '持权企业' },
        defendants: [],
      },
    ]);
    f.db.case.findFirst.mockResolvedValue({
      ...(await f.db.case.findFirst()),
      stage: 'SECOND_INSTANCE',
      version: 12,
    });
    const list = await f.service.list(actor, 'RECORDED', 1, 20);
    const detail = await f.service.get(actor, caseId);
    expect(list.items[0].stage).toBe('SECOND_INSTANCE');
    expect(list.items[0]).not.toHaveProperty('secondInstance');
    expect(detail.stage).toBe('SECOND_INSTANCE');
    expect(detail).not.toHaveProperty('secondInstance');
    expect(detail).not.toHaveProperty('judgmentNextStep');
  });

  it('keeps execution confirmation visible from the recorded list through detail without internal submission fields', async () => {
    const f = fixture();
    f.db.case.findMany.mockResolvedValue([
      {
        id: caseId,
        businessNo: 'CA-1',
        stage: 'WAITING_EXECUTION_CONFIRMATION',
        version: 15,
        rightsHolder: { name: '持权企业' },
        defendants: [],
      },
    ]);
    f.db.case.findFirst.mockResolvedValue({
      ...(await f.db.case.findFirst()),
      stage: 'WAITING_EXECUTION_CONFIRMATION',
      version: 15,
    });
    const list = await f.service.list(actor, 'RECORDED', 1, 20);
    const detail = await f.service.get(actor, list.items[0].id);
    expect(f.db.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stage: {
            in: expect.arrayContaining(['WAITING_EXECUTION_CONFIRMATION']),
          },
        }),
      }),
    );
    expect(list.items[0].stage).toBe('WAITING_EXECUTION_CONFIRMATION');
    expect(detail.stage).toBe('WAITING_EXECUTION_CONFIRMATION');
    expect(detail).not.toHaveProperty('executionSubmission');
    expect(detail).not.toHaveProperty('changeReason');
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

  it('keeps complaint and execution frozen receipts separate from pending drafts', async () => {
    const f = fixture();
    f.db.case.findFirst.mockResolvedValue({
      ...(await f.db.case.findFirst()),
      stage: 'WAITING_COMPLAINT_STAMP',
      complaintMailing: {
        mailedAt: new Date('2026-10-03T00:00:00Z'),
        recordedAt: new Date('2026-10-03T01:00:00Z'),
      },
      executionConfirmation: { id: 'execution-confirmation' },
      executionMailing: {
        id: 'execution-mailing',
        mailedAt: new Date('2026-10-04T00:00:00Z'),
        recordedAt: new Date('2026-10-04T01:00:00Z'),
      },
    });
    const file = (contentVersionId: string) => ({
      materialId: `material-${contentVersionId}`,
      contentVersionId,
      originalFilename: `${contentVersionId}.pdf`,
      mimeType: 'application/pdf',
    });
    f.materials.listFrozenCaseComplaintMailingFiles.mockResolvedValue([
      file('complaint-receipt'),
    ]);
    f.materials.listFrozenCaseExecutionMailingFiles.mockResolvedValue([
      file('execution-receipt'),
    ]);
    f.materials.listOwnerMaterials.mockResolvedValue({
      items: [
        {
          id: 'complaint-receipt-material',
          category: 'MAIL_RECEIPT',
          contentVersions: [
            { id: 'complaint-receipt', ...file('complaint-receipt') },
          ],
        },
        {
          id: 'execution-receipt-material',
          category: 'MAIL_RECEIPT',
          contentVersions: [
            { id: 'execution-receipt', ...file('execution-receipt') },
          ],
        },
        {
          id: 'draft-receipt-material',
          category: 'MAIL_RECEIPT',
          contentVersions: [{ id: 'draft-receipt', ...file('draft-receipt') }],
        },
      ],
      total: 3,
    });

    const detail = await f.service.get(actor, caseId);

    expect(detail.complaintMailing?.receiptFiles).toEqual([
      file('complaint-receipt'),
    ]);
    expect(detail.executionMailing?.files).toEqual([file('execution-receipt')]);
    expect(detail.pendingReceiptFiles).toEqual([
      { ...file('draft-receipt'), materialId: 'draft-receipt-material' },
    ]);
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
