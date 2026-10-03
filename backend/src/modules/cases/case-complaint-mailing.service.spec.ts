import { CaseComplaintMailingService } from './case-complaint-mailing.service';

const departmentId = '22222222-2222-4222-8222-222222222222';
const caseId = '33333333-3333-4333-8333-333333333333';
const customerId = '44444444-4444-4444-8444-444444444444';
const receiptId = '55555555-5555-4555-8555-555555555555';
const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId,
  authorizationRevision: 1,
};
const input = {
  expectedVersion: 4,
  idempotencyKey: 'mail-1',
  mailedAt: '2026-10-02',
  mailReceiptContentVersionIds: [receiptId],
};
const tomorrowInShanghai = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + 48 * 60 * 60 * 1000));

describe('CaseComplaintMailingService', () => {
  function fixture() {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: caseId }]),
      case: {
        findFirst: jest.fn().mockResolvedValue({
          id: caseId,
          departmentId,
          customerId,
          stage: 'WAITING_COMPLAINT_STAMP',
          version: 4,
          responsibleUserId: actor.userId,
          responsibleMembership: { teamId: null },
          complaintConfirmation: { id: 'confirmation-1' },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
      },
      customerAccountBinding: {
        findFirst: jest.fn().mockResolvedValue({ id: 'binding-1' }),
      },
      caseComplaintMailingReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      caseComplaintMailing: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: {
        create: jest
          .fn()
          .mockResolvedValue({ id: '66666666-6666-4666-8666-666666666666' }),
      },
    };
    const database = {
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) =>
        fn(tx),
      ),
    };
    const access = { authorizeCase: jest.fn().mockResolvedValue(undefined) };
    const materials = {
      assertAvailableVersions: jest
        .fn()
        .mockResolvedValue([
          { contentVersionId: receiptId, purpose: 'MAIL_RECEIPT' },
        ]),
      freezeCaseComplaintMailingReferences: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    return {
      tx,
      database,
      access,
      materials,
      service: new CaseComplaintMailingService(
        database as never,
        access as never,
        materials as never,
      ),
    };
  }

  it('uses one transaction for internal mailing, fact, audit, freeze and receipt', async () => {
    const f = fixture();
    const result = await f.service.mail(actor, caseId, input);
    expect(result).toMatchObject({
      id: caseId,
      stage: 'WAITING_FILING',
      version: 5,
      mailedAt: '2026-10-02',
      recordedAt: expect.any(String),
    });
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.complaint.mail',
      expect.objectContaining({ departmentId }),
      f.tx,
    );
    expect(f.tx.case.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        stage: 'WAITING_COMPLAINT_STAMP',
        version: 4,
      }),
      data: { stage: 'WAITING_FILING', version: { increment: 1 } },
    });
    expect(f.tx.caseComplaintMailing.create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(
      f.materials.freezeCaseComplaintMailingReferences,
    ).toHaveBeenCalledTimes(1);
    expect(f.tx.caseComplaintMailingReceipt.create).toHaveBeenCalledTimes(1);
  });

  it('rechecks active client binding and target enterprise before replay', async () => {
    const f = fixture();
    const client = { ...actor, clientCustomerId: customerId };
    const result = await f.service.mail(client, caseId, input);
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerAccountBindingId: 'binding-1',
        }),
      }),
    );
    const receipt =
      f.tx.caseComplaintMailingReceipt.create.mock.calls[0][0].data;
    f.tx.caseComplaintMailingReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: receipt.requestFingerprint,
      resultSnapshot: receipt.resultSnapshot,
    });
    expect(await f.service.mail(client, caseId, input)).toEqual(result);
    expect(f.tx.case.updateMany).toHaveBeenCalledTimes(1);
    f.tx.customerAccountBinding.findFirst.mockResolvedValue(null);
    await expect(f.service.mail(client, caseId, input)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    f.tx.customerAccountBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
    });
    f.tx.case.findFirst.mockResolvedValue({
      ...(await f.tx.case.findFirst()),
      customerId: 'other-customer',
    });
    await expect(f.service.mail(client, caseId, input)).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
    });
  });

  it('replays the same semantic request with a different JSON property order', async () => {
    const f = fixture();
    const first = await f.service.mail(actor, caseId, input);
    const receipt =
      f.tx.caseComplaintMailingReceipt.create.mock.calls[0][0].data;
    f.tx.caseComplaintMailingReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: receipt.requestFingerprint,
      resultSnapshot: receipt.resultSnapshot,
    });
    const reordered = {
      mailReceiptContentVersionIds: [receiptId],
      mailedAt: '2026-10-02',
      idempotencyKey: 'mail-1',
      expectedVersion: 4,
    };
    expect(await f.service.mail(actor, caseId, reordered)).toEqual(first);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    await expect(
      f.service.mail(actor, caseId, { ...reordered, mailedAt: '2026-10-01' }),
    ).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_CONFLICT' },
    });
  });

  it.each([
    { ...input, mailedAt: tomorrowInShanghai() },
    { ...input, mailedAt: '2026-02-30' },
    { ...input, mailReceiptContentVersionIds: [] },
    { ...input, mailReceiptContentVersionIds: [receiptId, receiptId] },
    { ...input, expectedVersion: 0 },
  ])('rejects invalid request before a transaction', async (bad) => {
    const f = fixture();
    await expect(f.service.mail(actor, caseId, bad)).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
    expect(f.database.$transaction).not.toHaveBeenCalled();
  });
});
