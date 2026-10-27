import { ForbiddenException } from '@nestjs/common';
import {
  AccessControlService,
  AccessControlSnapshot,
} from '../../access-control/access-control.service';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { MaterialService } from '../materials';
import { CaseReadService } from './case-read.service';
import { CaseHandlingGroupRead } from './case-handling-group.read';
import { CaseHandlingGroupResourceRead } from './case-handling-group-resource.read';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const groupId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const visibleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const hiddenId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function fixture(feeReadable = true) {
  const source = (id: string, owner: string) => ({
    id,
    departmentId: actor.departmentId,
    businessNo: 'CASE-' + id[0],
    customerId: 'customer',
    stage: 'WAITING_ARCHIVE',
    responsibleUserId: owner,
    responsibleMembership: { teamId: null },
    customer: {
      id: 'customer',
      departmentId: actor.departmentId,
      name: 'Customer',
    },
  });
  const group = {
    id: groupId,
    departmentId: actor.departmentId,
    revision: 1,
    status: 'ACTIVE',
    createdAt: new Date('2026-10-21T00:00:00Z'),
    members: [
      { case: source(visibleId, actor.userId) },
      { case: source(hiddenId, 'other') },
    ],
  };
  const tx = {
    userAccount: {
      findUnique: jest.fn().mockResolvedValue({
        active: true,
        accountType: 'INTERNAL',
        displayName: 'User',
      }),
    },
    caseHandlingGroup: { findFirst: jest.fn().mockResolvedValue(group) },
    caseHandlingGroupMember: { findMany: jest.fn().mockResolvedValue([]) },
    feeRecord: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'original-fee',
          caseId: visibleId,
          amount: new Prisma.Decimal(0),
          type: '样品费',
          direction: '支出',
          status: '未发起',
          feeDate: new Date('2026-10-21T00:00:00Z'),
          source: 'notary',
          sourceKind: 'NOTARY_MATTER_EVIDENCE',
          sourceId: 'original-matter',
          note: null,
          version: 1,
          proofMaterialId: 'proof',
          proofContentVersionId: 'old-proof',
          proofContentVersion: { originalFilename: 'old-proof.pdf' },
          case: {
            businessNo: 'CASE-a',
            courtCaseNo: null,
            sourceLead: null,
            defendants: [],
            stage: 'WAITING_ARCHIVE',
          },
        },
      ]),
    },
  };
  const transactionState = { active: false };
  const database = {
    $transaction: jest.fn(
      async (run: (reader: typeof tx) => Promise<unknown>) => {
        transactionState.active = true;
        try {
          return await run(tx);
        } finally {
          transactionState.active = false;
        }
      },
    ),
  };
  const grants: AccessControlSnapshot['grants'] = [
    { action: 'case.read', scope: 'self' },
  ];
  if (feeReadable) grants.push({ action: 'fee.read', scope: 'department' });
  const access = new AccessControlService({
    loadSnapshot: jest
      .fn()
      .mockResolvedValue({ active: true, authorizationRevision: 1, grants }),
  });
  const cases = {
    get: jest.fn().mockResolvedValue({
      id: visibleId,
      businessNo: 'CASE-a',
      fees: [
        {
          category: 'NOTARY',
          state: 'KNOWN',
          amount: '0.00',
          sourceType: 'NOTARY_CERTIFICATE_FEE',
          sourceId: 'certificate',
        },
        {
          category: 'SAMPLE',
          state: 'PENDING',
          amount: null,
          sourceType: 'NOTARY_MATTER_EVIDENCE',
          sourceId: 'matter',
        },
      ],
    }),
  };
  const file = {
    materialId: 'material',
    contentVersionId: 'old-cv',
    originalFilename: 'old.pdf',
    mimeType: 'application/pdf',
    sizeBytes: '9007199254740993',
    sha256: 'a'.repeat(64),
    category: 'COMPLAINT',
    purpose: 'COMPLAINT',
    isCurrent: false,
  };
  const materials = {
    listCaseResourceMetadata: jest
      .fn()
      .mockResolvedValue([
        file,
        file,
        { ...file, contentVersionId: 'current-cv', isCurrent: true },
      ]),
  };
  const groups = new CaseHandlingGroupRead(
    database as unknown as DatabaseService,
    access,
  );
  const read = new CaseHandlingGroupResourceRead(
    groups,
    cases as unknown as CaseReadService,
    materials as unknown as MaterialService,
    access,
  );
  return { group, tx, cases, materials, read, transactionState };
}

describe('current visible group resource reads', () => {
  it('closes the group transaction before original detail/material reads and scopes the ledger inside it', async () => {
    const f = fixture();
    const detail = await f.cases.get();
    f.cases.get.mockImplementation(async () => {
      expect(f.transactionState.active).toBe(false);
      return detail;
    });
    f.materials.listCaseResourceMetadata.mockImplementation(async () => {
      expect(f.transactionState.active).toBe(false);
      return [];
    });
    f.tx.feeRecord.findMany.mockImplementation(async () => {
      expect(f.transactionState.active).toBe(true);
      return [];
    });
    await f.read.materialsPage(actor, groupId, {});
    await f.read.feesPage(actor, groupId, {});
  });

  it('queries only visible members, deduplicates exact versions, and pages visible rows', async () => {
    const f = fixture();
    const result = await f.read.materialsPage(actor, groupId, {
      page: 2,
      pageSize: 1,
    });
    expect(result).toMatchObject({
      groupId,
      revision: 1,
      status: 'ACTIVE',
      total: 2,
      page: 2,
      pageSize: 1,
      items: [
        {
          caseId: visibleId,
          businessNo: 'CASE-a',
          contentVersionId: 'old-cv',
          sizeBytes: '9007199254740993',
          isCurrent: false,
        },
      ],
    });
    expect(f.materials.listCaseResourceMetadata).toHaveBeenCalledTimes(1);
    expect(f.materials.listCaseResourceMetadata).toHaveBeenCalledWith(
      actor,
      visibleId,
    );
    expect(JSON.stringify(result)).not.toContain(hiddenId);
    const query = f.tx.caseHandlingGroup.findFirst.mock.calls[0]![0];
    expect(query.select.members.where).toEqual({
      case: {
        is: {
          departmentId: actor.departmentId,
          responsibleUserId: actor.userId,
        },
      },
    });
    expect(f.cases.get).not.toHaveBeenCalled();
    expect(f.tx.feeRecord.findMany).not.toHaveBeenCalled();
  });

  it('keeps original source summaries separate from paged ledger, zero, unknown and exact proof identities', async () => {
    const f = fixture();
    const result = await f.read.feesPage(actor, groupId, {
      page: 2,
      pageSize: 1,
    });
    expect(result.notarySummaries).toEqual([
      {
        caseId: visibleId,
        businessNo: 'CASE-a',
        category: 'NOTARY',
        state: 'KNOWN',
        amount: '0.00',
        sourceType: 'NOTARY_CERTIFICATE_FEE',
        sourceId: 'certificate',
      },
      {
        caseId: visibleId,
        businessNo: 'CASE-a',
        category: 'SAMPLE',
        state: 'PENDING',
        amount: null,
        sourceType: 'NOTARY_MATTER_EVIDENCE',
        sourceId: 'matter',
      },
    ]);
    expect(result).toMatchObject({
      canReadLedger: true,
      ledger: {
        total: 1,
        page: 2,
        pageSize: 1,
        items: [
          {
            feeId: 'original-fee',
            amount: '0.00',
            sourceKind: 'NOTARY_MATTER_EVIDENCE',
            sourceId: 'original-matter',
            proofMaterialId: 'proof',
            proofContentVersionId: 'old-proof',
            proofOriginalFilename: 'old-proof.pdf',
          },
        ],
      },
    });
    expect(f.cases.get).toHaveBeenCalledTimes(1);
    expect(f.cases.get).toHaveBeenCalledWith(actor, visibleId);
    const where = {
      departmentId: actor.departmentId,
      caseId: { in: [visibleId] },
      deletedAt: null,
      cancellation: { is: null },
      case: {
        is: {
          departmentId: actor.departmentId,
          responsibleUserId: actor.userId,
        },
      },
    };
    expect(f.tx.feeRecord.count).toHaveBeenCalledWith({ where });
    expect(f.tx.feeRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 1, take: 1 }),
    );
    expect(JSON.stringify(result)).not.toContain(hiddenId);
    expect(result).not.toHaveProperty('summary');
    expect(result.ledger!.items[0]).not.toHaveProperty('id');
    expect(result.ledger!.items[0]).not.toHaveProperty('courtCaseNo');
  });

  it('returns null rather than an empty readable ledger when fee.read is absent', async () => {
    const f = fixture(false);
    const result = await f.read.feesPage(actor, groupId, {});
    expect(result.canReadLedger).toBe(false);
    expect(result.ledger).toBeNull();
    expect(result.notarySummaries).toHaveLength(2);
    expect(f.tx.feeRecord.count).not.toHaveBeenCalled();
    expect(f.tx.feeRecord.findMany).not.toHaveBeenCalled();
  });

  it('reads dissolved groups with their exact revision and current source permissions', async () => {
    const f = fixture();
    f.group.status = 'DISSOLVED';
    f.group.revision = 2;
    await expect(
      f.read.materialsPage(actor, groupId, {}),
    ).resolves.toMatchObject({ status: 'DISSOLVED', revision: 2 });
    await expect(f.read.feesPage(actor, groupId, {})).resolves.toMatchObject({
      status: 'DISSOLVED',
      revision: 2,
    });
  });

  it.each([
    { status: 'ACTIVE', revision: 2 },
    { status: 'DISSOLVED', revision: 1 },
    { status: 'ACTIVE', revision: 2147483647 },
  ])('fails closed on invalid group snapshots %j', async (state) => {
    const f = fixture();
    Object.assign(f.group, state);
    await expect(
      f.read.materialsPage(actor, groupId, {}),
    ).rejects.toMatchObject({ response: { code: 'INVALID_GROUP_STATE' } });
    await expect(f.read.feesPage(actor, groupId, {})).rejects.toMatchObject({
      response: { code: 'INVALID_GROUP_STATE' },
    });
    expect(f.materials.listCaseResourceMetadata).not.toHaveBeenCalled();
    expect(f.cases.get).not.toHaveBeenCalled();
  });

  it.each([
    { page: 2147483649, pageSize: 1 },
    { page: 1.5 },
    { pageSize: 101 },
    { caseIds: [hiddenId] },
    { departmentId: 'other' },
  ])('rejects malformed scope or overflowing offset %j', async (query) => {
    const f = fixture();
    expect(() => f.read.materialsPage(actor, groupId, query)).toThrow();
    expect(() => f.read.feesPage(actor, groupId, query)).toThrow();
    expect(f.tx.caseHandlingGroup.findFirst).not.toHaveBeenCalled();
  });

  it('accepts the exact maximum offset without exposing hidden totals', async () => {
    const f = fixture();
    const page = 2147483648;
    await expect(
      f.read.materialsPage(actor, groupId, { page, pageSize: 1 }),
    ).resolves.toMatchObject({
      page,
      pageSize: 1,
      total: 2,
      items: [],
    });
    f.tx.feeRecord.findMany.mockResolvedValue([]);
    await f.read.feesPage(actor, groupId, { page, pageSize: 1 });
    expect(f.tx.feeRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 2147483647 }),
    );
  });

  it('rejects revoked, external, fully hidden and malformed group requests before resource reads', async () => {
    for (const external of [
      { ...actor, lawyerAccountId: 'lawyer' },
      { ...actor, clientCustomerId: 'client' },
      { ...actor, notaryOfficeId: 'office' },
      { ...actor, authorizationRevision: 2 },
    ]) {
      const f = fixture();
      await expect(
        f.read.feesPage(external, groupId, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.cases.get).not.toHaveBeenCalled();
      expect(f.tx.feeRecord.count).not.toHaveBeenCalled();
    }
    const hidden = fixture();
    hidden.group.members[0]!.case.responsibleUserId = 'other';
    await expect(
      hidden.read.materialsPage(actor, groupId, {}),
    ).rejects.toMatchObject({
      response: { code: 'CASE_HANDLING_GROUP_NOT_FOUND' },
    });
    expect(hidden.materials.listCaseResourceMetadata).not.toHaveBeenCalled();
    const malformed = fixture();
    expect(() => malformed.read.materialsPage(actor, 'invalid', {})).toThrow(
      expect.objectContaining({ response: { code: 'VALIDATION_ERROR' } }),
    );
  });

  it('fails rather than inventing empty data when source policies or source projections fail', async () => {
    const f = fixture();
    f.materials.listCaseResourceMetadata.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(
      f.read.materialsPage(actor, groupId, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    f.cases.get.mockResolvedValue({ id: visibleId, businessNo: 'CASE-a' });
    await expect(f.read.feesPage(actor, groupId, {})).rejects.toMatchObject({
      response: { code: 'INVALID_CASE_SOURCE' },
    });
    const invalid = fixture();
    invalid.cases.get.mockResolvedValue({
      id: visibleId,
      businessNo: 'CASE-a',
      fees: [
        {
          category: 'SAMPLE',
          state: 'PENDING',
          amount: null,
          sourceType: 'NOTARY_CERTIFICATE_FEE',
          sourceId: 'certificate',
        },
      ],
    });
    await expect(
      invalid.read.feesPage(actor, groupId, {}),
    ).rejects.toMatchObject({ response: { code: 'INVALID_CASE_SOURCE' } });
  });
});
