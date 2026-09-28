import {
  CertificateInput,
  NotaryCertificateService,
} from './notary-certificate.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
  notaryOfficeId: '33333333-3333-4333-8333-333333333333',
};
const matterId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const certificateVersionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const input: CertificateInput = {
  expectedVersion: 5,
  certificateNo: '（2026）证字001号',
  certificateDate: '2026-09-28',
  contentVersionIds: [certificateVersionId],
  needDisclose: false,
  disclosureContentVersionIds: [],
  fees: {
    notary: { state: 'KNOWN', amount: '100.00' },
    investigation: { state: 'PENDING', amount: null },
    disclosure: { state: 'KNOWN', amount: '0.00' },
  },
};

function fixture() {
  const tx = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: matterId }]),
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ accountType: 'NOTARY', active: true }),
    },
    notaryOfficeAccountBinding: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }),
    },
    notaryMatter: {
      findFirst: jest.fn().mockResolvedValue({
        id: matterId,
        departmentId: actor.departmentId,
        notaryOfficeId: actor.notaryOfficeId,
        stage: 'WAITING_CERTIFICATE',
        version: 5,
        sourceLeadId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        customerId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        rightsHolderId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        responsibleUserId: actor.userId,
        businessNo: 'NT-1',
        sourceLead: {
          needDisclose: false,
          responsibleUserId: actor.userId,
          teamId: null,
        },
        evidence: {
          sampleFeeState: 'KNOWN',
          sampleFeeAmount: { toString: () => '200.00' },
        },
        issuanceDecision: {
          id: '99999999-9999-4999-8999-999999999999',
          decision: 'ISSUE',
        },
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    notaryMatterCommandReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    notaryCertificate: {
      create: jest
        .fn()
        .mockResolvedValue({ id: '77777777-7777-4777-8777-777777777777' }),
    },
    notaryCertificateFee: {
      createMany: jest.fn().mockResolvedValue({ count: 3 }),
    },
    contentVersion: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: certificateVersionId,
          originalFilename: 'certificate.pdf',
          mimeType: 'application/pdf',
        },
      ]),
    },
    auditEvent: {
      create: jest
        .fn()
        .mockResolvedValue({ id: '66666666-6666-4666-8666-666666666666' }),
    },
  };
  const database = {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback(tx),
    ),
  };
  const materials = {
    assertAvailableVersions: jest.fn().mockResolvedValue([
      {
        materialId: '55555555-5555-4555-8555-555555555555',
        contentVersionId: certificateVersionId,
        purpose: 'NOTARY_CERTIFICATE',
        mimeType: 'application/pdf',
      },
    ]),
    freezeReferences: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const cases = {
    createFromNotaryCertificate: jest.fn().mockResolvedValue({
      id: '88888888-8888-4888-8888-888888888888',
      businessNo: 'CA-1',
    }),
    readReceiptIdentity: jest.fn(),
  };
  return {
    service: new NotaryCertificateService(
      database as never,
      materials as never,
      cases as never,
    ),
    tx,
    database,
    materials,
    cases,
  };
}

describe('NotaryCertificateService', () => {
  it('atomically archives one certificate and creates one case without copying sample fee', async () => {
    const f = fixture();
    const result = await f.service.issue(actor, matterId, 'issue-1', input);
    expect(result).toMatchObject({
      stage: 'ARCHIVED',
      version: 6,
      case: { businessNo: 'CA-1', stage: 'PENDING_MATCH' },
    });
    expect(f.tx.notaryMatter.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stage: 'WAITING_CERTIFICATE',
          version: 5,
        }),
        data: { stage: 'ARCHIVED', version: 6 },
      }),
    );
    expect(f.tx.notaryCertificateFee.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ category: 'NOTARY' }),
        expect.objectContaining({ category: 'INVESTIGATION' }),
        expect.objectContaining({ category: 'DISCLOSURE' }),
      ]),
    });
    expect(f.materials.freezeReferences).toHaveBeenCalled();
    expect(f.tx.auditEvent.create).toHaveBeenCalled();
    expect(f.tx.notaryMatterCommandReceipt.create).toHaveBeenCalled();
  });

  it('rejects a different office, inactive binding, or non notary account before writing', async () => {
    const f = fixture();
    f.tx.notaryOfficeAccountBinding.findFirst.mockResolvedValue(null);
    await expect(
      f.service.issue(actor, matterId, 'issue-1', input),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.tx.notaryMatter.updateMany).not.toHaveBeenCalled();
  });

  it('rejects stale version and non ISSUE stage without changing facts', async () => {
    const f = fixture();
    f.tx.notaryMatter.findFirst.mockResolvedValueOnce({
      ...(await f.tx.notaryMatter.findFirst()),
      version: 6,
    });
    await expect(
      f.service.issue(actor, matterId, 'stale-1', input),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    f.tx.notaryMatter.findFirst.mockResolvedValueOnce({
      ...(await f.tx.notaryMatter.findFirst()),
      stage: 'WAITING_RETURN',
    });
    await expect(
      f.service.issue(actor, matterId, 'wrong-stage-1', input),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    expect(f.tx.notaryCertificate.create).not.toHaveBeenCalled();
    expect(f.cases.createFromNotaryCertificate).not.toHaveBeenCalled();
  });

  it('replays the exact original result after current authorization and rejects a changed request', async () => {
    const f = fixture();
    const original = await f.service.issue(actor, matterId, 'replay-1', input);
    f.tx.notaryMatterCommandReceipt.findUnique.mockResolvedValue({
      requestFingerprint:
        f.tx.notaryMatterCommandReceipt.create.mock.calls[0][0].data
          .requestFingerprint,
      resultMatterId: matterId,
      resultMatterVersion: original.version,
      resultSnapshot: original,
    });
    f.cases.readReceiptIdentity.mockResolvedValue({
      id: original.case.id,
      businessNo: original.case.businessNo,
      certificate: {
        toVersion: original.version,
        certificateNo: original.certificate.certificateNo,
        certificateDate: new Date(
          `${original.certificate.certificateDate}T00:00:00.000Z`,
        ),
        issuedAt: new Date(original.certificate.issuedAt),
        needDisclose: false,
      },
    });
    expect(await f.service.issue(actor, matterId, 'replay-1', input)).toEqual(
      original,
    );
    f.tx.notaryOfficeAccountBinding.findFirst.mockResolvedValue(null);
    await expect(
      f.service.issue(actor, matterId, 'replay-1', input),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    f.tx.notaryOfficeAccountBinding.findFirst.mockResolvedValue({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
    await expect(
      f.service.issue(actor, matterId, 'replay-1', {
        ...input,
        certificateNo: 'another',
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(f.tx.notaryCertificate.create).toHaveBeenCalledTimes(1);
  });

  it('does not create a receipt when audit or frozen reference creation fails', async () => {
    for (const failure of ['audit', 'reference'] as const) {
      const f = fixture();
      if (failure === 'audit')
        f.tx.auditEvent.create.mockRejectedValue(
          new Error('audit unavailable'),
        );
      else
        f.materials.freezeReferences.mockRejectedValue(
          new Error('reference unavailable'),
        );
      await expect(
        f.service.issue(actor, matterId, `fail-${failure}`, input),
      ).rejects.toThrow();
      expect(f.tx.notaryMatterCommandReceipt.create).not.toHaveBeenCalled();
    }
  });

  it('rejects an unavailable certificate version before archiving', async () => {
    const f = fixture();
    f.materials.assertAvailableVersions.mockRejectedValue({
      response: { code: 'MATERIAL_VERSION_INVALID' },
    });
    await expect(
      f.service.issue(actor, matterId, 'invalid-file', input),
    ).rejects.toMatchObject({ response: { code: 'MATERIAL_VERSION_INVALID' } });
    expect(f.tx.notaryMatter.updateMany).not.toHaveBeenCalled();
  });

  it('rejects absent certificate, bad money, and disclosure without evidence', async () => {
    const f = fixture();
    for (const invalid of [
      { ...input, contentVersionIds: [] },
      {
        ...input,
        fees: { ...input.fees, notary: { state: 'KNOWN', amount: '-1.00' } },
      },
      { ...input, needDisclose: true },
    ]) {
      await expect(
        f.service.issue(actor, matterId, 'issue-1', invalid as never),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    }
    expect(f.database.$transaction).not.toHaveBeenCalled();
  });

  it('retries a PostgreSQL serialization conflict surfaced through Prisma P2010', async () => {
    const f = fixture();
    const serialization = {
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '40001' } } },
    };
    f.database.$transaction.mockRejectedValueOnce(serialization);
    await expect(
      f.service.issue(actor, matterId, 'retry-1', input),
    ).resolves.toMatchObject({
      stage: 'ARCHIVED',
      version: 6,
    });
    expect(f.database.$transaction).toHaveBeenCalledTimes(2);

    const exhausted = fixture();
    exhausted.database.$transaction.mockRejectedValue(serialization);
    await expect(
      exhausted.service.issue(actor, matterId, 'retry-2', input),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    expect(exhausted.database.$transaction).toHaveBeenCalledTimes(3);
  });
});
