import { ForbiddenException } from '@nestjs/common';
import { EvidenceService } from './evidence.service';
import type { DatabaseService } from '../../database/database.service';
import type { AccessControlService } from '../../access-control/access-control.service';
import type { OrganizationService } from '../../access-control/organization.service';
import {
  readEvidenceSource,
  listEvidenceSources,
} from './evidence-source-read';
import { evidenceCommandFingerprint } from './evidence-command';
import {
  projectEvidenceGroup,
  type EvidenceGroupRecord,
} from './evidence-read-model';
import type { EvidenceSourceProjection } from './evidence-source-read';

jest.mock('./evidence-source-read');
const actor = {
  userId: 'internal-1',
  departmentId: 'dept-1',
  authorizationRevision: 3,
};
const item = {
  id: 'item-1',
  groupId: 'group-1',
  departmentId: 'dept-1',
  sourceKind: 'CASE' as const,
  sourceId: 'case-1',
  sourceNotaryMatterId: null,
  caseId: 'case-1',
  displayCode: 'EV-1',
  shelfLocation: null,
  name: null,
  kind: null,
  collectedOn: null,
  provenance: null,
  keeperUserId: null,
  status: 'UNDELIVERED' as const,
  remark: '原备注',
  version: 1,
  removedAt: null,
  createdByUserId: actor.userId,
  updatedByUserId: actor.userId,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};
const group: EvidenceGroupRecord = {
  id: 'group-1',
  departmentId: 'dept-1',
  sourceKind: 'CASE',
  sourceId: 'case-1',
  sourceNotaryMatterId: null,
  caseId: 'case-1',
  version: 2,
  sourceInitializedAt: null,
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  items: [item],
  paperCertificates: [],
  auditEvents: [],
};
const source: EvidenceSourceProjection = {
  sourceKind: 'CASE',
  sourceId: 'case-1',
  sourceVersion: 3,
  departmentId: 'dept-1',
  businessNo: 'IP-1',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  case: {
    id: 'case-1',
    platform: null,
    shopName: null,
    caseNo: null,
    stage: 'WAITING_HEARING',
    lawyerName: null,
  },
  hearingOn: null,
  secondHearingOn: null,
  closedOn: null,
  certificate: null,
};
const input = {
  expectedGroupVersion: 2,
  rows: [
    {
      id: item.id,
      displayCode: 'EV-1',
      shelfLocation: 'A1',
      status: 'UNDELIVERED' as const,
      manualStatus: false,
    },
  ],
};

function fixture() {
  jest.mocked(readEvidenceSource).mockReset().mockResolvedValue(source);
  jest.mocked(listEvidenceSources).mockReset().mockResolvedValue([source]);
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) =>
      strings.join('').includes('FOR UPDATE') ? [{ id: 'locked' }] : [],
    ),
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ active: true, accountType: 'INTERNAL' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    evidenceGroupVersion: {
      findFirst: jest.fn().mockResolvedValue(group),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([group]),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({ ...group, version: 3 }),
    },
    evidenceItem: {
      findMany: jest.fn().mockResolvedValue([item]),
      update: jest.fn().mockResolvedValue({
        ...item,
        shelfLocation: 'A1',
        status: 'IN_STOCK',
        version: 2,
      }),
      create: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    evidencePaperCertificate: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    evidenceAuditEvent: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    evidenceCommandReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'receipt-1' }),
    },
  };
  const access = {
    authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
  };
  const organization = {
    lockDepartment: jest.fn().mockResolvedValue(undefined),
  };
  const database = {
    $transaction: jest.fn(
      async (callback: (value: unknown) => Promise<unknown>) => callback(tx),
    ),
  };
  const service = new EvidenceService(
    database as unknown as DatabaseService,
    access as unknown as AccessControlService,
    organization as unknown as OrganizationService,
  );
  return { tx, access, database, service };
}

describe('EvidenceService real Prisma command orchestration', () => {
  it('rechecks current authorization on a serialization retry before re-reading a success receipt', async () => {
    const f = fixture();
    f.database.$transaction.mockImplementationOnce(
      async (callback: (value: unknown) => Promise<unknown>) => {
        await callback(f.tx);
        throw { code: 'P2034' };
      },
    );
    f.access.authorizeDepartmentAction
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ForbiddenException());
    await expect(
      f.service.saveGroup(actor, group.id, 'retry-revoked', input),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.database.$transaction).toHaveBeenCalledTimes(2);
    expect(f.access.authorizeDepartmentAction).toHaveBeenCalledTimes(2);
    expect(f.tx.evidenceCommandReceipt.findUnique).toHaveBeenCalledTimes(1);
  });

  it('links a real transferred case to the original group and every child including removed history in the same callback', async () => {
    const f = fixture();
    const active = {
      ...item,
      sourceKind: 'NOTARY_MATTER' as const,
      sourceId: 'matter-1',
      sourceNotaryMatterId: 'matter-1',
      caseId: null,
    };
    const historical = {
      ...active,
      id: 'removed-history',
      removedAt: new Date(),
    };
    const original = {
      ...group,
      sourceKind: 'NOTARY_MATTER' as const,
      sourceId: 'matter-1',
      sourceNotaryMatterId: 'matter-1',
      caseId: null,
      items: [active],
    };
    const linked = {
      ...original,
      caseId: 'case-1',
      version: 3,
      items: [{ ...active, caseId: 'case-1', version: 2 }],
    };
    jest.mocked(readEvidenceSource).mockResolvedValue({
      ...source,
      sourceKind: 'NOTARY_MATTER',
      sourceId: 'matter-1',
    });
    f.tx.evidenceGroupVersion.findFirst
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(original)
      .mockResolvedValue(linked);
    f.tx.evidenceItem.findMany.mockResolvedValue([active, historical]);
    const result = await f.service.saveGroup(actor, group.id, 'key-link', {
      expectedGroupVersion: 2,
      rows: [
        {
          id: active.id,
          displayCode: '',
          shelfLocation: '',
          status: 'UNDELIVERED',
          manualStatus: false,
        },
      ],
    });
    expect(result.group.groupVersion).toBe(3);
    expect(f.tx.evidenceItem.updateMany).toHaveBeenCalledWith({
      where: { groupId: group.id, departmentId: actor.departmentId },
      data: {
        caseId: 'case-1',
        version: { increment: 1 },
        updatedByUserId: actor.userId,
      },
    });
    expect(f.tx.evidencePaperCertificate.updateMany).toHaveBeenCalledWith({
      where: { groupId: group.id, departmentId: actor.departmentId },
      data: {
        caseId: 'case-1',
        version: { increment: 1 },
        updatedByUserId: actor.userId,
      },
    });
    expect(f.tx.evidenceAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operation: 'LINK_SOURCE_CASE',
        afterSnapshot: expect.objectContaining({
          itemIds: [active.id, historical.id],
        }),
      }),
    });
    expect(f.tx.evidenceItem.create).not.toHaveBeenCalled();
  });
  it('checks current authorization before looking up a previous success', async () => {
    const f = fixture();
    f.access.authorizeDepartmentAction.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(
      f.service.saveGroup(actor, group.id, 'key-1', input),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.tx.evidenceCommandReceipt.findUnique).not.toHaveBeenCalled();
    expect(f.tx.evidenceItem.update).not.toHaveBeenCalled();
  });

  it('checks department and real source scope before replaying a successful older-version request', async () => {
    const f = fixture();
    const replayInput = { ...input, expectedGroupVersion: 1 };
    const result = {
      changed: true,
      group: projectEvidenceGroup(group, source),
    };
    f.tx.evidenceCommandReceipt.findUnique.mockResolvedValue({
      command: 'EDIT_GROUP',
      requestFingerprint: evidenceCommandFingerprint(
        'EDIT_GROUP',
        group.id,
        replayInput,
      ),
      resultSnapshot: result,
    });
    await expect(
      f.service.saveGroup(actor, group.id, 'key-1', replayInput),
    ).resolves.toEqual(result);
    expect(f.tx.evidenceGroupVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: group.id, departmentId: actor.departmentId },
      }),
    );
    expect(
      f.access.authorizeDepartmentAction.mock.invocationCallOrder[0],
    ).toBeLessThan(
      f.tx.evidenceCommandReceipt.findUnique.mock.invocationCallOrder[0],
    );
    expect(
      jest.mocked(readEvidenceSource).mock.invocationCallOrder[0],
    ).toBeLessThan(
      f.tx.evidenceCommandReceipt.findUnique.mock.invocationCallOrder[0],
    );
    expect(f.tx.evidenceItem.update).not.toHaveBeenCalled();
  });

  it('rejects cross-department or missing groups before receipt lookup', async () => {
    const f = fixture();
    f.tx.evidenceGroupVersion.findFirst.mockResolvedValue(null);
    await expect(
      f.service.saveGroup(actor, 'foreign-group', 'key-1', input),
    ).rejects.toMatchObject({ response: { code: 'EVIDENCE_NOT_FOUND' } });
    expect(f.tx.evidenceCommandReceipt.findUnique).not.toHaveBeenCalled();
  });

  it('saves stock linkage, exact before/after audit and its receipt in the one Serializable callback', async () => {
    const f = fixture();
    const updated = {
      ...item,
      shelfLocation: 'A1',
      status: 'IN_STOCK' as const,
      version: 2,
    };
    f.tx.evidenceGroupVersion.findFirst
      .mockResolvedValueOnce(group)
      .mockResolvedValueOnce(group)
      .mockResolvedValue({ ...group, version: 3, items: [updated] });
    const result = await f.service.saveGroup(
      actor,
      group.id,
      'key-stock',
      input,
    );
    expect(result.group.items[0].status).toBe('IN_STOCK');
    expect(f.database.$transaction).toHaveBeenCalledTimes(1);
    expect(f.database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      timeout: 20000,
    });
    expect(f.tx.evidenceItem.update).toHaveBeenCalledWith({
      where: { id: item.id },
      data: expect.objectContaining({
        status: 'IN_STOCK',
        shelfLocation: 'A1',
        version: { increment: 1 },
        updatedByUserId: actor.userId,
      }),
    });
    expect(f.tx.evidenceAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operation: 'EDIT_ITEM',
        internalActorUserId: actor.userId,
        itemId: item.id,
        beforeSnapshot: expect.objectContaining({ shelfLocation: null }),
        afterSnapshot: expect.objectContaining({ shelfLocation: 'A1' }),
      }),
    });
    expect(f.tx.evidenceCommandReceipt.create).toHaveBeenCalledTimes(1);
  });

  it('retains historical rows when removing the last item and keeps an addressable empty group', async () => {
    const f = fixture();
    f.tx.evidenceItem.update.mockResolvedValue({
      ...item,
      removedAt: new Date(),
      version: 2,
    });
    f.tx.evidenceGroupVersion.findFirst
      .mockResolvedValueOnce(group)
      .mockResolvedValueOnce(group)
      .mockResolvedValue({ ...group, version: 3, items: [] });
    const result = await f.service.saveGroup(actor, group.id, 'key-empty', {
      expectedGroupVersion: 2,
      rows: [],
    });
    expect(result.group.groupId).toBe(group.id);
    expect(result.group.items).toEqual([]);
    expect(f.tx.evidenceItem.update).toHaveBeenCalledWith({
      where: { id: item.id },
      data: expect.objectContaining({ removedAt: expect.any(Date) }),
    });
    expect(f.tx.evidenceItem.delete).not.toHaveBeenCalled();
    expect(f.tx.evidencePaperCertificate.delete).not.toHaveBeenCalled();
  });

  it('rejects stale versions and same-key different commands without a business write', async () => {
    const f = fixture();
    await expect(
      f.service.saveGroup(actor, group.id, 'key-stale', {
        ...input,
        expectedGroupVersion: 1,
      }),
    ).rejects.toMatchObject({
      response: { code: 'EVIDENCE_VERSION_CONFLICT' },
    });
    f.tx.evidenceCommandReceipt.findUnique.mockResolvedValue({
      command: 'BULK_STATUS',
      requestFingerprint: evidenceCommandFingerprint(
        'EDIT_GROUP',
        group.id,
        input,
      ),
      resultSnapshot: {},
    });
    await expect(
      f.service.saveGroup(actor, group.id, 'key-stale', input),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(f.tx.evidenceItem.update).not.toHaveBeenCalled();
  });

  it('does not write a blank first-registration draft and performs no implicit initialization on GET', async () => {
    const f = fixture();
    const result = await f.service.createSourceGroup(
      actor,
      'CASE',
      source.sourceId,
      'key-blank',
      { expectedGroupVersion: 0, expectedSourceVersion: 3, rows: [] },
    );
    expect(result).toMatchObject({
      changed: false,
      group: { groupId: null, groupVersion: 0, items: [] },
    });
    await f.service.sourceGroup(actor, 'CASE', source.sourceId);
    expect(f.tx.evidenceGroupVersion.create).not.toHaveBeenCalled();
    expect(f.tx.evidenceItem.create).not.toHaveBeenCalled();
    expect(f.tx.evidenceCommandReceipt.create).not.toHaveBeenCalled();
  });

  it('creates a first external-case group only on explicit nonempty save and does not invent a paper certificate', async () => {
    const f = fixture();
    const added = {
      ...item,
      id: 'added-1',
      displayCode: 'NEW-EV',
      remark: null,
    };
    f.tx.evidenceGroupVersion.create.mockResolvedValue({
      ...group,
      version: 1,
    });
    f.tx.evidenceGroupVersion.findFirst
      .mockResolvedValueOnce({ ...group, version: 1, items: [] })
      .mockResolvedValue({ ...group, version: 1, items: [added] });
    f.tx.evidenceItem.create.mockResolvedValue(added);
    const result = await f.service.createSourceGroup(
      actor,
      'CASE',
      source.sourceId,
      'key-first',
      {
        expectedGroupVersion: 0,
        expectedSourceVersion: 3,
        rows: [
          {
            displayCode: 'NEW-EV',
            shelfLocation: '',
            status: 'UNDELIVERED',
            manualStatus: false,
          },
        ],
      },
    );
    expect(result).toMatchObject({
      changed: true,
      group: { groupId: group.id, groupVersion: 1 },
    });
    expect(f.tx.evidenceGroupVersion.create).toHaveBeenCalledWith({
      data: {
        departmentId: actor.departmentId,
        sourceKind: 'CASE',
        sourceId: source.sourceId,
        caseId: source.case.id,
      },
    });
    expect(f.tx.evidenceItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        displayCode: 'NEW-EV',
        shelfLocation: null,
        status: 'UNDELIVERED',
        keeperUserId: null,
      }),
    });
    expect(f.tx.evidencePaperCertificate.create).not.toHaveBeenCalled();
    expect(f.tx.evidenceCommandReceipt.create).toHaveBeenCalledTimes(1);
  });

  it('updates two selected items and only the selected second paper in one batch', async () => {
    const f = fixture();
    const other = { ...item, id: 'item-2', displayCode: 'EV-2' };
    const paper = {
      id: 'paper-1',
      departmentId: actor.departmentId,
      groupId: group.id,
      caseId: source.case.id,
      sourceNotaryMatterId: null,
      sourceKind: 'CASE' as const,
      sourceId: source.sourceId,
      sourceCertificateId: null,
      number: 'N1',
      issuedOn: null,
      officeName: null,
      pages: null,
      contentMaterialId: null,
      contentVersionId: null,
      contentVersion: null,
      status: 'NOT_ISSUED' as const,
      version: 1,
      removedAt: null,
      createdByUserId: actor.userId,
      updatedByUserId: actor.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const secondPaper = { ...paper, id: 'paper-2', number: 'N2' };
    f.tx.evidenceItem.findMany.mockResolvedValue([item, other]);
    f.tx.evidencePaperCertificate.findMany.mockResolvedValue([secondPaper]);
    f.tx.evidenceGroupVersion.findFirst.mockResolvedValue({
      ...group,
      items: [item, other],
      paperCertificates: [paper, secondPaper],
    });
    f.tx.evidenceItem.update
      .mockResolvedValueOnce({ ...item, status: 'DESTROYED', version: 2 })
      .mockResolvedValueOnce({ ...other, status: 'DESTROYED', version: 2 });
    f.tx.evidencePaperCertificate.update.mockResolvedValue({
      ...secondPaper,
      status: 'MAILED_TO_LAWYER',
      version: 2,
    });
    await expect(
      f.service.bulkStatus(actor, 'key-bulk', {
        evidenceIds: ['item-1', 'item-2'],
        paperCertificateIds: ['paper-2'],
        evidenceStatus: 'DESTROYED',
        paperStatus: 'MAILED_TO_LAWYER',
      }),
    ).resolves.toEqual({ changedEvidence: 2, changedPaperCertificates: 1 });
    expect(f.tx.evidenceGroupVersion.update).toHaveBeenCalledTimes(1);
    expect(f.tx.evidencePaperCertificate.update).toHaveBeenCalledWith({
      where: { id: 'paper-2' },
      data: expect.objectContaining({ status: 'MAILED_TO_LAWYER' }),
    });
    expect(f.tx.evidenceAuditEvent.create).toHaveBeenCalledTimes(3);
    expect(f.tx.evidenceCommandReceipt.create).toHaveBeenCalledTimes(1);
    expect(f.tx.evidenceItem.delete).not.toHaveBeenCalled();
  });

  it('rejects a paper from an unselected group and exports only explicitly selected IDs', async () => {
    const f = fixture();
    f.tx.evidencePaperCertificate.findMany.mockResolvedValue([
      { id: 'foreign-paper', groupId: 'foreign-group' },
    ]);
    await expect(
      f.service.bulkStatus(actor, 'key-wrong-paper', {
        evidenceIds: ['item-1'],
        paperCertificateIds: ['foreign-paper'],
        paperStatus: 'MAILED_TO_LAWYER',
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.tx.evidenceCommandReceipt.findUnique).not.toHaveBeenCalled();
    const other = { ...item, id: 'item-2', displayCode: 'UNSELECTED-CODE' };
    f.tx.evidenceGroupVersion.findFirst.mockResolvedValue({
      ...group,
      items: [item, other],
    });
    const exported = await f.service.export(actor, { evidenceIds: ['item-1'] });
    expect(exported.csv).toContain('EV-1');
    expect(exported.csv).toContain('待开庭');
    expect(exported.csv).not.toContain('UNSELECTED-CODE');
    expect(f.access.authorizeDepartmentAction).toHaveBeenCalledWith(
      actor,
      'evidence.export',
      f.tx,
    );
  });
});
