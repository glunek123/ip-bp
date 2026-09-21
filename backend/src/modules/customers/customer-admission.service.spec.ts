import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { MaterialService, ValidatedMaterialVersionFact } from '../materials';
import {
  AdmitCustomerDto,
  CUSTOMER_IDENTITY_COMPATIBILITY,
  CustomerTypeCode,
  IdentityTypeCode,
} from './customer-admission.dto';
import { CustomerAdmissionService } from './customer-admission.service';

const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
};
const customerId = '33333333-3333-4333-8333-333333333333';
const fullVersionId = '44444444-4444-4444-8444-444444444444';
const frontVersionId = '55555555-5555-4555-8555-555555555555';
const backVersionId = '66666666-6666-4666-8666-666666666666';

const compatibilityPairs = (
  Object.entries(CUSTOMER_IDENTITY_COMPATIBILITY) as Array<
    [CustomerTypeCode, readonly IdentityTypeCode[]]
  >
).flatMap(([customerType, identityTypes]) =>
  identityTypes.map((identityType) => [customerType, identityType] as const),
);

function command(overrides: Partial<AdmitCustomerDto> = {}): AdmitCustomerDto {
  return {
    expectedVersion: 1,
    customerType: 'ENTERPRISE',
    name: ' 上海示例企业 ',
    identityType: 'BUSINESS_LICENSE',
    identityNumber: ' 9131-0000-abcd-1234 ',
    issuingCountryOrRegion: ' 中国 ',
    identityValidFrom: '2026-01-01',
    identityValidTo: '2036-01-01',
    identityValidityMode: 'FIXED',
    admissionContactName: ' 张三 ',
    admissionContactPhone: ' +86 138-0013-8000 ',
    identityDocumentContentVersionIds: [fullVersionId],
    ...overrides,
  };
}

function materialFact(
  contentVersionId: string,
  purpose: 'IDENTITY_FULL' | 'IDENTITY_FRONT' | 'IDENTITY_BACK',
  mimeType: string,
): ValidatedMaterialVersionFact {
  return {
    departmentId: actor.departmentId,
    materialId: `77777777-7777-4777-8777-${contentVersionId.slice(-12)}`,
    contentVersionId,
    purpose,
    mimeType,
    ownerType: 'CUSTOMER',
    ownerId: customerId,
    category: 'CUSTOMER_IDENTITY',
  } as ValidatedMaterialVersionFact;
}

describe('CustomerAdmissionService', () => {
  const buildCustomerScope = jest.fn();
  const accessControl = {
    buildCustomerScope,
  } as unknown as AccessControlService;
  const assertAvailableVersions = jest.fn();
  const freezeReferences = jest.fn();
  const materials = {
    assertAvailableVersions,
    freezeReferences,
  } as unknown as MaterialService;
  const transaction = jest.fn();
  const receiptFindOutside = jest.fn();
  const customerFindOutside = jest.fn();
  const database = {
    customerAdmissionReceipt: { findUnique: receiptFindOutside },
    customer: { findFirst: customerFindOutside },
    $transaction: transaction,
  } as unknown as DatabaseService;
  const service = new CustomerAdmissionService(
    database,
    accessControl,
    materials,
  );

  const current = {
    id: customerId,
    name: '旧草稿名',
    normalizedName: '旧草稿名',
    customerType: null,
    identityType: null,
    identityNumber: null,
    normalizedIdentityNumber: null,
    issuingCountryOrRegion: null,
    category: null,
    region: null,
    admissionContactName: null,
    admissionContactPhone: null,
    admissionContactEmail: null,
    identityValidFrom: null,
    identityValidTo: null,
    identityValidityMode: null,
    admittedAt: null,
    profileStatus: 'DRAFT' as const,
    departmentId: actor.departmentId,
    responsibleUserId: actor.userId,
    teamId: null,
    version: 1,
    updatedAt: new Date('2026-09-21T02:00:00.000Z'),
  };
  const updated = {
    ...current,
    name: '上海示例企业',
    normalizedName: '上海示例企业',
    customerType: 'ENTERPRISE',
    identityType: 'BUSINESS_LICENSE',
    identityNumber: '9131-0000-ABCD-1234',
    normalizedIdentityNumber: '91310000ABCD1234',
    issuingCountryOrRegion: '中国',
    admissionContactName: '张三',
    admissionContactPhone: '+86 138-0013-8000',
    identityValidFrom: new Date('2026-01-01T00:00:00.000Z'),
    identityValidTo: new Date('2036-01-01T00:00:00.000Z'),
    identityValidityMode: 'FIXED' as const,
    admittedAt: new Date('2026-09-21T03:00:00.000Z'),
    profileStatus: 'ADMITTED' as const,
    version: 2,
    updatedAt: new Date('2026-09-21T03:00:00.000Z'),
  };

  let customerFindFirst: jest.Mock;
  let customerUpdateMany: jest.Mock;
  let customerFindUnique: jest.Mock;
  let receiptFindUnique: jest.Mock;
  let receiptCreate: jest.Mock;
  let auditCreate: jest.Mock;
  let queryRaw: jest.Mock;
  let tx: Record<string, unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    buildCustomerScope.mockResolvedValue({ departmentId: actor.departmentId });
    customerFindFirst = jest
      .fn()
      .mockImplementation(({ where }) =>
        typeof where?.id === 'object' && where.id?.not === customerId
          ? Promise.resolve(null)
          : Promise.resolve(current),
      );
    customerUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    customerFindUnique = jest.fn().mockResolvedValue(updated);
    receiptFindUnique = jest.fn().mockResolvedValue(null);
    receiptCreate = jest.fn().mockResolvedValue({ id: 'receipt-1' });
    auditCreate = jest.fn().mockResolvedValue({ id: 'audit-1' });
    queryRaw = jest.fn().mockResolvedValue([{ id: customerId }]);
    tx = {
      $queryRawUnsafe: queryRaw,
      customer: {
        findFirst: customerFindFirst,
        updateMany: customerUpdateMany,
        findUnique: customerFindUnique,
      },
      customerAdmissionReceipt: {
        findUnique: receiptFindUnique,
        create: receiptCreate,
      },
      auditEvent: { create: auditCreate },
    };
    transaction.mockImplementation(async (callback, options) => {
      expect(options).toEqual({ isolationLevel: 'Serializable' });
      return callback(tx);
    });
    assertAvailableVersions.mockResolvedValue([
      materialFact(fullVersionId, 'IDENTITY_FULL', 'application/pdf'),
    ]);
    freezeReferences.mockResolvedValue({ count: 1 });
    receiptFindOutside.mockResolvedValue(null);
  });

  it.each(compatibilityPairs)(
    'admits the supported %s and %s compatibility pair',
    async (customerType, identityType) => {
      await expect(
        service.admit(
          actor,
          customerId,
          `matrix-${customerType}-${identityType}`,
          command({
            customerType: customerType as CustomerTypeCode,
            identityType: identityType as IdentityTypeCode,
            identityDocumentContentVersionIds: [fullVersionId],
          }),
        ),
      ).resolves.toMatchObject({ profileStatus: 'admitted', version: 2 });
    },
  );

  it('rejects a customer and identity type outside the compatibility map', async () => {
    await expect(
      service.admit(
        actor,
        customerId,
        'bad-matrix',
        command({
          customerType: 'ENTERPRISE',
          identityType: 'PASSPORT',
        }),
      ),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_ADMISSION_INCOMPLETE' },
    });
    expect(assertAvailableVersions).not.toHaveBeenCalled();
  });

  it.each([
    { customerType: 'FREE_TEXT' },
    { identityType: 'FREE_TEXT' },
    { identityValidityMode: 'FREE_TEXT', identityValidTo: undefined },
  ])(
    'rejects unknown controlled codes at the service boundary %#',
    async (override) => {
      await expect(
        service.admit(
          actor,
          customerId,
          'unknown-code',
          command(override as Partial<AdmitCustomerDto>),
        ),
      ).rejects.toMatchObject({
        response: { code: 'CUSTOMER_ADMISSION_INCOMPLETE' },
      });
      expect(assertAvailableVersions).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      mode: 'FIXED' as const,
      from: '2026-01-01',
      to: '2036-01-01',
      storedTo: new Date('2036-01-01T00:00:00.000Z'),
    },
    {
      mode: 'LONG_TERM' as const,
      from: '2026-01-01',
      to: undefined,
      storedTo: null,
    },
    {
      mode: 'NOT_STATED' as const,
      from: undefined,
      to: undefined,
      storedTo: null,
    },
  ])(
    'stores $mode identity validity without inventing dates',
    async (validity) => {
      await service.admit(
        actor,
        customerId,
        `validity-${validity.mode}`,
        command({
          identityValidityMode: validity.mode,
          identityValidFrom: validity.from,
          identityValidTo: validity.to,
        }),
      );

      expect(customerUpdateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: customerId, version: 1 }),
        data: expect.objectContaining({
          identityValidityMode: validity.mode,
          identityValidTo: validity.storedTo,
        }),
      });
    },
  );

  it.each([
    command({ identityValidTo: undefined }),
    command({ identityValidFrom: '2037-01-01', identityValidTo: '2036-01-01' }),
    command({
      identityValidityMode: 'LONG_TERM',
      identityValidTo: '2036-01-01',
    }),
    command({
      identityValidityMode: 'NOT_STATED',
      identityValidTo: '2036-01-01',
    }),
  ])('rejects an inconsistent validity command %#', async (input) => {
    await expect(
      service.admit(actor, customerId, 'bad-validity', input),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_ADMISSION_INCOMPLETE' },
    });
    expect(customerUpdateMany).not.toHaveBeenCalled();
  });

  it.each([
    command({ admissionContactName: '' }),
    command({
      admissionContactPhone: undefined,
      admissionContactEmail: undefined,
    }),
  ])('requires one named contact and one contact method %#', async (input) => {
    await expect(
      service.admit(actor, customerId, 'bad-contact', input),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_ADMISSION_INCOMPLETE' },
    });
  });

  it.each([
    {
      label: 'one full PDF',
      ids: [fullVersionId],
      facts: [materialFact(fullVersionId, 'IDENTITY_FULL', 'application/pdf')],
    },
    {
      label: 'front and back images',
      ids: [frontVersionId, backVersionId],
      facts: [
        materialFact(frontVersionId, 'IDENTITY_FRONT', 'image/jpeg'),
        materialFact(backVersionId, 'IDENTITY_BACK', 'image/png'),
      ],
    },
  ])('accepts NATIONAL_ID with $label', async ({ ids, facts }) => {
    assertAvailableVersions.mockResolvedValueOnce(facts);
    await expect(
      service.admit(
        actor,
        customerId,
        `national-${ids.length}`,
        command({
          customerType: 'NATURAL_PERSON',
          identityType: 'NATIONAL_ID',
          identityDocumentContentVersionIds: ids,
        }),
      ),
    ).resolves.toMatchObject({ profileStatus: 'admitted' });
  });

  it.each([
    { facts: [materialFact(fullVersionId, 'IDENTITY_FULL', 'image/jpeg')] },
    { facts: [materialFact(frontVersionId, 'IDENTITY_FRONT', 'image/jpeg')] },
    {
      facts: [
        materialFact(frontVersionId, 'IDENTITY_FRONT', 'image/jpeg'),
        materialFact(fullVersionId, 'IDENTITY_FULL', 'application/pdf'),
      ],
    },
  ])(
    'rejects an incomplete NATIONAL_ID purpose combination %#',
    async ({ facts }) => {
      assertAvailableVersions.mockResolvedValueOnce(facts);
      await expect(
        service.admit(
          actor,
          customerId,
          'bad-national-materials',
          command({
            customerType: 'NATURAL_PERSON',
            identityType: 'NATIONAL_ID',
            identityDocumentContentVersionIds: facts.map(
              (fact) => fact.contentVersionId,
            ),
          }),
        ),
      ).rejects.toMatchObject({
        response: { code: 'CUSTOMER_DOCUMENT_INVALID' },
      });
      expect(freezeReferences).not.toHaveBeenCalled();
    },
  );

  it('requires IDENTITY_FULL for every non-NATIONAL_ID identity document', async () => {
    assertAvailableVersions.mockResolvedValueOnce([
      materialFact(frontVersionId, 'IDENTITY_FRONT', 'image/jpeg'),
    ]);
    await expect(
      service.admit(
        actor,
        customerId,
        'bad-other-purpose',
        command({ identityDocumentContentVersionIds: [frontVersionId] }),
      ),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_DOCUMENT_INVALID' },
    });
  });

  it.each(['invalid', 'cross-owner', 'deleted', 'wrong-department'])(
    'does not bypass MaterialService for a %s content version',
    async (reason) => {
      assertAvailableVersions.mockRejectedValueOnce(
        new BadRequestException({
          code: 'MATERIAL_VERSION_INVALID',
          message: reason,
        }),
      );
      await expect(
        service.admit(actor, customerId, `material-${reason}`, command()),
      ).rejects.toMatchObject({
        response: { code: 'MATERIAL_VERSION_INVALID' },
      });
      expect(assertAvailableVersions).toHaveBeenCalledWith(tx, actor, {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        category: 'CUSTOMER_IDENTITY',
        contentVersionIds: [fullVersionId],
        minCount: 1,
        maxCount: 10,
      });
      expect(freezeReferences).not.toHaveBeenCalled();
    },
  );

  it('hides the target and writes nothing without customer.admit', async () => {
    buildCustomerScope.mockRejectedValueOnce(
      new ForbiddenException({
        code: 'CUSTOMER_ACTION_FORBIDDEN',
        message: 'forbidden',
      }),
    );
    await expect(
      service.admit(actor, customerId, 'forbidden', command()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(buildCustomerScope).toHaveBeenCalledWith(
      actor,
      'customer.admit',
      tx,
    );
    expect(queryRaw).not.toHaveBeenCalled();
    expect(assertAvailableVersions).not.toHaveBeenCalled();
  });

  it('returns CUSTOMER_NOT_FOUND for a customer outside the current department scope', async () => {
    customerFindFirst.mockResolvedValueOnce(null);
    await expect(
      service.admit(actor, customerId, 'wrong-department', command()),
    ).rejects.toMatchObject({ response: { code: 'CUSTOMER_NOT_FOUND' } });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('rejects a stale version before validating material versions', async () => {
    const stale = { ...current, version: 2 };
    customerFindFirst.mockResolvedValue(stale);
    await expect(
      service.admit(actor, customerId, 'stale', command()),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_VERSION_CONFLICT' },
    });
    expect(assertAvailableVersions).not.toHaveBeenCalled();
  });

  it('rejects a department identity duplicate before validating materials', async () => {
    customerFindFirst.mockImplementation(({ where }) =>
      typeof where?.id === 'object'
        ? Promise.resolve({ id: 'another-customer' })
        : Promise.resolve(current),
    );
    await expect(
      service.admit(actor, customerId, 'duplicate', command()),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_IDENTITY_DUPLICATE' },
    });
    expect(assertAvailableVersions).not.toHaveBeenCalled();
  });

  it('returns the exact original snapshot after a later routine edit', async () => {
    const original = await service.admit(
      actor,
      customerId,
      'same-key',
      command(),
    );
    const fingerprint = receiptCreate.mock.calls[0]?.[0]?.data
      .requestFingerprint as string;
    const resultSnapshot = receiptCreate.mock.calls[0]?.[0]?.data
      .resultSnapshot as unknown;
    const writesAfterFirst = customerUpdateMany.mock.calls.length;
    receiptFindUnique.mockResolvedValue({
      requestFingerprint: fingerprint,
      resultCustomerId: customerId,
      resultCustomerVersion: 2,
      resultSnapshot,
    });
    customerFindUnique.mockResolvedValue({
      ...updated,
      category: '后来修改的分类',
      version: 3,
      updatedAt: new Date('2026-09-21T04:00:00.000Z'),
    });

    await expect(
      service.admit(actor, customerId, 'same-key', command()),
    ).resolves.toEqual(original);
    expect(customerUpdateMany).toHaveBeenCalledTimes(writesAfterFirst);
    expect(freezeReferences).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(customerFindUnique).toHaveBeenCalledTimes(1);
  });

  it('returns a stable internal error for a corrupted receipt snapshot', async () => {
    const first = await service.admit(
      actor,
      customerId,
      'snapshot-seed',
      command(),
    );
    const fingerprint = receiptCreate.mock.calls[0]?.[0]?.data
      .requestFingerprint as string;
    receiptFindUnique.mockResolvedValue({
      requestFingerprint: fingerprint,
      resultCustomerId: customerId,
      resultCustomerVersion: first.version,
      resultSnapshot: { broken: true },
    });

    await expect(
      service.admit(actor, customerId, 'snapshot-seed', command()),
    ).rejects.toMatchObject({ response: { code: 'INTERNAL_ERROR' } });
  });

  it('rejects the same idempotency key with a different fingerprint', async () => {
    receiptFindUnique.mockResolvedValue({
      requestFingerprint: '0'.repeat(64),
      resultCustomerId: customerId,
      resultCustomerVersion: 2,
    });
    await expect(
      service.admit(actor, customerId, 'same-key', command()),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(customerUpdateMany).not.toHaveBeenCalled();
  });

  it('rolls back reference and customer writes when audit creation fails', async () => {
    auditCreate.mockRejectedValueOnce(new Error('audit failed'));
    await expect(
      service.admit(actor, customerId, 'audit-fails', command()),
    ).rejects.toThrow('audit failed');
    expect(freezeReferences).toHaveBeenCalledWith(tx, {
      departmentId: actor.departmentId,
      resourceType: 'customer',
      resourceId: customerId,
      facts: expect.any(Array),
    });
    expect(customerUpdateMany).toHaveBeenCalled();
    expect(receiptCreate).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('atomically freezes references, admits the customer, audits, and records the receipt', async () => {
    await expect(
      service.admit(actor, customerId, 'atomic-success', command()),
    ).resolves.toEqual({
      id: customerId,
      name: '上海示例企业',
      customerType: 'ENTERPRISE',
      identityType: 'BUSINESS_LICENSE',
      identityNumber: '9131-0000-ABCD-1234',
      issuingCountryOrRegion: '中国',
      identityValidFrom: '2026-01-01',
      identityValidTo: '2036-01-01',
      identityValidityMode: 'FIXED',
      admittedAt: '2026-09-21T03:00:00.000Z',
      category: null,
      region: null,
      admissionContactName: '张三',
      admissionContactPhone: '+86 138-0013-8000',
      admissionContactEmail: null,
      profileStatus: 'admitted',
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      version: 2,
      updatedAt: '2026-09-21T03:00:00.000Z',
    });
    expect(queryRaw).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      customerId,
      actor.departmentId,
    );
    expect(customerUpdateMany).toHaveBeenCalledWith({
      where: {
        id: customerId,
        departmentId: actor.departmentId,
        version: 1,
        profileStatus: 'DRAFT',
      },
      data: expect.objectContaining({
        customerType: 'ENTERPRISE',
        name: '上海示例企业',
        identityType: 'BUSINESS_LICENSE',
        identityNumber: '9131-0000-ABCD-1234',
        normalizedIdentityNumber: '91310000ABCD1234',
        profileStatus: 'ADMITTED',
        admittedAt: expect.any(Date),
        version: { increment: 1 },
      }),
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'customer.admitted',
        resourceId: customerId,
        details: {
          fromVersion: 1,
          toVersion: 2,
          customerType: 'ENTERPRISE',
          identityType: 'BUSINESS_LICENSE',
          identityValidityMode: 'FIXED',
          identityDocumentCount: 1,
        },
      }),
    });
    expect(receiptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        idempotencyKey: 'atomic-success',
        requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        resultCustomerId: customerId,
        resultCustomerVersion: 2,
        resultSnapshot: expect.objectContaining({
          id: customerId,
          profileStatus: 'admitted',
          version: 2,
        }),
      }),
    });
    expect(freezeReferences.mock.invocationCallOrder[0]).toBeLessThan(
      customerUpdateMany.mock.invocationCallOrder[0]!,
    );
    expect(customerUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(
      auditCreate.mock.invocationCallOrder[0]!,
    );
    expect(auditCreate.mock.invocationCallOrder[0]).toBeLessThan(
      receiptCreate.mock.invocationCallOrder[0]!,
    );
  });

  it('keeps unexpected transaction errors instead of manufacturing success', async () => {
    transaction.mockRejectedValueOnce(new ConflictException('serialization'));
    await expect(
      service.admit(actor, customerId, 'transaction-error', command()),
    ).rejects.toThrow('serialization');
  });

  it('retries P2034 and recovers the same-key snapshot receipt', async () => {
    const original = await service.admit(
      actor,
      customerId,
      'retry-key',
      command(),
    );
    const receipt = receiptCreate.mock.calls[0]?.[0]?.data;
    transaction.mockReset();
    transaction
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockImplementationOnce(async (callback, options) => {
        expect(options).toEqual({ isolationLevel: 'Serializable' });
        receiptFindUnique.mockResolvedValue(receipt);
        return callback(tx);
      });

    await expect(
      service.admit(actor, customerId, 'retry-key', command()),
    ).resolves.toEqual(original);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('retries P2034 and returns a version conflict when another command won', async () => {
    transaction.mockReset();
    transaction
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockImplementationOnce(async (callback, options) => {
        expect(options).toEqual({ isolationLevel: 'Serializable' });
        customerFindFirst.mockResolvedValue({ ...current, version: 2 });
        return callback(tx);
      });

    await expect(
      service.admit(actor, customerId, 'other-key', command()),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_VERSION_CONFLICT' },
    });
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('maps three consecutive P2034 failures to a stable version conflict', async () => {
    transaction.mockReset().mockRejectedValue({ code: 'P2034' });

    await expect(
      service.admit(actor, customerId, 'exhausted', command()),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_VERSION_CONFLICT' },
    });
    expect(transaction).toHaveBeenCalledTimes(3);
  });
});
