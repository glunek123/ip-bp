import { CaseReadService } from './case-read.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};

describe('CaseReadService', () => {
  function fixture() {
    const db = {
      userAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
      },
      lawyerAccountBinding: {
        findFirst: jest.fn().mockResolvedValue({ id: 'binding-1' }),
      },
      case: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    const access = {
      buildLeadScope: jest.fn(),
      authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
      canAuthorizeLead: jest.fn().mockResolvedValue(false),
      buildCaseScope: jest
        .fn()
        .mockResolvedValue({ departmentId: actor.departmentId }),
      canAuthorizeCase: jest.fn().mockResolvedValue(true),
    };
    const materials = {
      listFrozenCertificateFiles: jest.fn().mockResolvedValue([]),
      listFrozenCaseComplaintFiles: jest.fn().mockResolvedValue([]),
      listFrozenCaseComplaintConfirmationFile: jest
        .fn()
        .mockResolvedValue(null),
      listFrozenCaseComplaintMailingFiles: jest.fn().mockResolvedValue([]),
    };
    return {
      db,
      access,
      materials,
      service: new CaseReadService(
        db as never,
        access as never,
        materials as never,
      ),
    };
  }
  it('lists only currently authorized internal department cases', async () => {
    const f = fixture();
    expect(
      await (f.service.list as (...args: unknown[]) => Promise<unknown>)(
        actor,
        1,
        20,
        'department',
      ),
    ).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      counts: {
        PENDING_MATCH: 0,
        WAITING_COMPLAINT: 0,
        WAITING_COMPLAINT_CONFIRMATION: 0,
        WAITING_COMPLAINT_STAMP: 0,
        WAITING_FILING: 0,
        WAITING_FORMAL_ACCEPTANCE: 0,
        WAITING_HEARING: 0,
      },
    });
    expect(f.access.authorizeDepartmentAction).toHaveBeenCalledWith(
      actor,
      'case.read',
    );
    expect(f.db.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: actor.departmentId,
        }),
      }),
    );
  });
  it('denies client and notary accounts before querying cases', async () => {
    const f = fixture();
    await expect(
      f.service.list(
        { ...actor, clientCustomerId: '33333333-3333-4333-8333-333333333333' },
        1,
        20,
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    await expect(
      f.service.list(
        { ...actor, notaryOfficeId: '44444444-4444-4444-8444-444444444444' },
        1,
        20,
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.db.case.findMany).not.toHaveBeenCalled();
  });

  it('lists only current primary assignments for a lawyer account', async () => {
    const f = fixture();
    const lawyer = { ...actor, lawyerAccountId: actor.userId };
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'LAWYER',
      active: true,
    });
    await f.service.list(lawyer, 1, 20);
    expect(f.access.authorizeDepartmentAction).not.toHaveBeenCalled();
    expect(f.db.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: actor.departmentId,
          lawyers: {
            some: expect.objectContaining({
              role: 'PRIMARY',
              endedAt: null,
            }),
          },
        }),
      }),
    );
  });

  it('reads four fees by original source without inventing a court case number', async () => {
    const f = fixture();
    const record = {
      id: 'case-1',
      businessNo: 'CA-1',
      stage: 'PENDING_MATCH',
      version: 1,
      matchedAt: null,
      matchedOn: null,
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
      defendants: [],
      lawyers: [],
      createdAt: new Date('2026-09-28T00:00:00.000Z'),
      courtCaseNo: null,
      owner: { id: actor.userId, displayName: '负责人' },
      department: { id: actor.departmentId, name: '品维' },
      customer: { id: 'customer-1', name: '客户' },
      rightsHolder: { id: 'rights-1', name: '主体' },
      sourceLead: {
        id: 'lead-1',
        businessNo: 'LD-1',
      },
      sourceNotaryMatter: {
        id: 'matter-1',
        businessNo: 'NT-1',
        evidence: {
          matterId: 'matter-1',
          sampleFeeState: 'KNOWN',
          sampleFeeAmount: { toString: () => '200' },
        },
      },
      certificate: {
        id: 'certificate-1',
        certificateNo: '证001',
        certificateDate: new Date('2026-09-28T00:00:00.000Z'),
        issuedAt: new Date('2026-09-28T01:00:00.000Z'),
        needDisclose: false,
        fees: [
          {
            category: 'NOTARY',
            state: 'KNOWN',
            amount: { toString: () => '100' },
          },
          { category: 'INVESTIGATION', state: 'PENDING', amount: null },
          {
            category: 'DISCLOSURE',
            state: 'KNOWN',
            amount: { toString: () => '0' },
          },
        ],
      },
    };
    f.db.case.findFirst.mockResolvedValue(record);
    const result = await f.service.get(actor, 'case-1');
    expect(result).toMatchObject({
      courtCaseNo: null,
      fees: [
        {
          category: 'NOTARY',
          state: 'KNOWN',
          amount: '100.00',
          sourceType: 'NOTARY_CERTIFICATE_FEE',
          sourceId: 'certificate-1',
        },
        {
          category: 'SAMPLE',
          state: 'KNOWN',
          amount: '200.00',
          sourceType: 'NOTARY_MATTER_EVIDENCE',
          sourceId: 'matter-1',
        },
        {
          category: 'INVESTIGATION',
          state: 'PENDING',
          amount: null,
          sourceType: 'NOTARY_CERTIFICATE_FEE',
        },
        {
          category: 'DISCLOSURE',
          state: 'KNOWN',
          amount: '0.00',
          sourceType: 'NOTARY_CERTIFICATE_FEE',
        },
      ],
    });
    expect(f.db.case.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'case-1', departmentId: actor.departmentId },
      }),
    );
    f.db.case.findFirst.mockResolvedValue({
      ...record,
      stage: 'WAITING_COMPLAINT',
      matchedAt: new Date('2026-09-29T09:00:00.000Z'),
      matchedOn: new Date('2026-09-28T00:00:00.000Z'),
      lawyers: [
        {
          id: 'assignment-1',
          role: 'PRIMARY',
          startedAt: new Date('2026-09-29T09:00:00.000Z'),
          endedAt: null,
          lawyer: {
            id: 'lawyer-1',
            fullName: '张律师',
            lawFirm: null,
            phone: null,
          },
        },
      ],
    });
    await expect(f.service.get(actor, 'case-1')).resolves.toMatchObject({
      matchedOn: '2026-09-28',
      matchedAt: '2026-09-29T09:00:00.000Z',
      lawyers: [{ fullName: '张律师', lawFirm: null }],
      canSubmitComplaint: true,
      complaint: null,
    });
    f.db.case.findFirst.mockResolvedValue({
      ...record,
      stage: 'WAITING_COMPLAINT_CONFIRMATION',
      matchedAt: new Date('2026-09-29T09:00:00.000Z'),
      complaintAmountState: 'KNOWN',
      complaintAmount: '12.34',
      complaintPendingReason: null,
      complaintSubmittedAt: new Date('2026-09-30T09:00:00.000Z'),
      complaintSubmittedByUserId: actor.userId,
    });
    f.materials.listFrozenCaseComplaintFiles.mockResolvedValue([
      {
        purpose: 'COMPLAINT',
        materialId: 'material-1',
        contentVersionId: 'version-1',
        originalFilename: '诉状.pdf',
        mimeType: 'application/pdf',
      },
    ]);
    await expect(f.service.get(actor, 'case-1')).resolves.toMatchObject({
      canSubmitComplaint: false,
      canConfirmComplaint: true,
      complaint: {
        amountState: 'KNOWN',
        amount: '12.34',
        complaintFiles: [{ contentVersionId: 'version-1' }],
        authorizationFiles: [],
      },
    });
    f.db.case.findFirst.mockResolvedValue({
      ...record,
      stage: 'WAITING_COMPLAINT_STAMP',
      matchedAt: new Date('2026-09-29T09:00:00.000Z'),
      complaintAmountState: 'KNOWN',
      complaintAmount: '12.34',
      complaintPendingReason: null,
      complaintSubmittedAt: new Date('2026-09-30T09:00:00.000Z'),
      complaintSubmittedByUserId: actor.userId,
      complaintConfirmation: {
        confirmedComplaintContentVersionId: 'version-2',
        amountState: 'PENDING',
        amount: null,
        pendingReason: '待核实',
        changeNote: '金额待核实',
        confirmDisclose: true,
        confirmedByUserId: actor.userId,
        confirmedAt: new Date('2026-10-02T09:00:00.000Z'),
      },
      complaintMailing: null,
    });
    f.materials.listFrozenCaseComplaintConfirmationFile.mockResolvedValue({
      materialId: 'material-2',
      contentVersionId: 'version-2',
      originalFilename: '修订诉状.pdf',
      mimeType: 'application/pdf',
    });
    await expect(f.service.get(actor, 'case-1')).resolves.toMatchObject({
      canConfirmComplaint: false,
      canMailComplaint: true,
      complaintMailing: null,
      complaint: {
        amount: '12.34',
        complaintFiles: [{ contentVersionId: 'version-1' }],
      },
      complaintConfirmation: {
        confirmedComplaintContentVersionId: 'version-2',
        amountState: 'PENDING',
        amount: null,
        pendingReason: '待核实',
        changeNote: '金额待核实',
        confirmDisclose: true,
        complaintFile: { contentVersionId: 'version-2' },
      },
    });
    f.db.case.findFirst.mockResolvedValue({
      ...record,
      stage: 'WAITING_FILING',
      complaintConfirmation: {
        confirmedComplaintContentVersionId: 'version-2',
        amountState: 'PENDING',
        amount: null,
        pendingReason: '待核实',
        changeNote: '金额待核实',
        confirmDisclose: true,
        confirmedByUserId: actor.userId,
        confirmedAt: new Date('2026-10-02T09:00:00.000Z'),
      },
      complaintMailing: {
        mailedAt: new Date('2026-10-02T00:00:00.000Z'),
        recordedAt: new Date('2026-10-03T03:00:00.000Z'),
        recordedByUserId: actor.userId,
        actorType: 'INTERNAL',
      },
    });
    f.materials.listFrozenCaseComplaintMailingFiles.mockResolvedValue([
      {
        materialId: 'receipt',
        contentVersionId: 'receipt-version',
        originalFilename: '凭证.pdf',
        mimeType: 'application/pdf',
      },
    ]);
    await expect(f.service.get(actor, 'case-1')).resolves.toMatchObject({
      canMailComplaint: false,
      complaintMailing: {
        mailedAt: '2026-10-02',
        receiptFiles: [{ contentVersionId: 'receipt-version' }],
      },
    });
  });
  it('scopes mine by case ownership and keeps stage counts independent of filter', async () => {
    const f = fixture();
    f.db.case.groupBy.mockResolvedValue([
      { stage: 'PENDING_MATCH', _count: { _all: 2 } },
    ]);
    const result = await (
      f.service.list as (...args: unknown[]) => Promise<unknown>
    )(actor, 1, 20, 'mine', 'WAITING_COMPLAINT');
    expect(result).toMatchObject({
      counts: {
        PENDING_MATCH: 2,
        WAITING_COMPLAINT: 0,
        WAITING_COMPLAINT_CONFIRMATION: 0,
        WAITING_COMPLAINT_STAMP: 0,
        WAITING_FILING: 0,
      },
    });
    expect(f.db.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          departmentId: actor.departmentId,
          responsibleUserId: actor.userId,
          stage: 'WAITING_COMPLAINT',
        },
      }),
    );
    expect(f.db.case.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          departmentId: actor.departmentId,
          responsibleUserId: actor.userId,
        },
      }),
    );
  });
  it('returns public list fields without internal ownership relation data', async () => {
    const f = fixture();
    f.db.case.findMany.mockResolvedValue([
      {
        id: 'case-1',
        businessNo: 'CA-1',
        stage: 'PENDING_MATCH',
        version: 1,
        createdAt: new Date('2026-09-28T00:00:00.000Z'),
        responsibleUserId: actor.userId,
        responsibleMembership: { teamId: 'team-private' },
        owner: { id: actor.userId, displayName: '负责人' },
        sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
        sourceNotaryMatter: { id: 'matter-1', businessNo: 'NT-1' },
      },
    ]);
    const result = await f.service.list(actor, 1, 20);
    expect(result.items[0]).not.toHaveProperty('responsibleMembership');
    expect(result.items[0]).not.toHaveProperty('responsibleUserId');
    expect(result.items[0]).toMatchObject({
      owner: { id: actor.userId },
      canMatch: true,
    });
  });
});
