import { ForbiddenException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { Prisma } from '../../generated/prisma/client';
import {
  feeReadInclude,
  projectFeeReadRow,
  readScopedCaseFeePage,
} from './fee-read';

const actor: ActorContext = {
  userId: 'user',
  departmentId: 'department',
  authorizationRevision: 1,
};
const scope = {
  departmentId: actor.departmentId,
  responsibleUserId: actor.userId,
};
function row() {
  return {
    id: 'fee',
    caseId: 'visible-case',
    departmentId: actor.departmentId,
    type: '样品费',
    direction: '支出',
    status: '未发起',
    amount: new Prisma.Decimal('900719925474099312345.67'),
    feeDate: new Date('2026-10-21T00:00:00Z'),
    source: 'notary',
    sourceKind: 'NOTARY_MATTER_EVIDENCE',
    sourceId: 'original-matter',
    actorUserId: null,
    idempotencyKey: null,
    note: null,
    launchedAt: null,
    deletedAt: null,
    version: 2,
    createdAt: new Date('2026-10-21T00:00:00Z'),
    proofMaterialId: 'proof',
    proofContentVersionId: 'old-cv',
    proofContentVersion: { originalFilename: 'original.pdf' },
    case: {
      businessNo: 'CASE-1',
      courtCaseNo: null,
      stage: 'WAITING_ARCHIVE' as const,
      sourceLead: null,
      defendants: [],
    },
  };
}
function fixture() {
  const tx = {
    feeRecord: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([row()]),
    },
  };
  const access = {
    authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
  };
  const read = (ids: string[] = ['visible-case']) =>
    readScopedCaseFeePage(
      tx as unknown as Prisma.TransactionClient,
      access as unknown as AccessControlService,
      actor,
      ids,
      scope,
      2,
      10,
    );
  return { tx, access, read };
}

describe('independent scoped fee read', () => {
  it('places both visible case IDs and current case scope into count and page queries before reading rows', async () => {
    const f = fixture();
    const result = await f.read();
    expect(f.access.authorizeDepartmentAction).toHaveBeenCalledWith(
      actor,
      'fee.read',
      f.tx,
    );
    const where = {
      departmentId: actor.departmentId,
      caseId: { in: ['visible-case'] },
      deletedAt: null,
      case: { is: scope },
    };
    expect(f.tx.feeRecord.count).toHaveBeenCalledWith({ where });
    expect(f.tx.feeRecord.findMany).toHaveBeenCalledWith({
      where,
      include: feeReadInclude,
      orderBy: [{ feeDate: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 10,
    });
    expect(result).toMatchObject({
      canReadLedger: true,
      ledger: {
        total: 1,
        page: 2,
        pageSize: 10,
        items: [
          {
            id: 'fee',
            amount: '900719925474099312345.67',
            sourceKind: 'NOTARY_MATTER_EVIDENCE',
            sourceId: 'original-matter',
            proofContentVersionId: 'old-cv',
            proofOriginalFilename: 'original.pdf',
          },
        ],
      },
    });
    expect(result.ledger).not.toHaveProperty('summary');
    expect(result.ledger).not.toHaveProperty('matchingIds');
  });

  it('returns explicit unreadable/null and never queries a ledger without fee.read', async () => {
    const f = fixture();
    f.access.authorizeDepartmentAction.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(f.read()).resolves.toEqual({
      canReadLedger: false,
      ledger: null,
    });
    expect(f.tx.feeRecord.count).not.toHaveBeenCalled();
    expect(f.tx.feeRecord.findMany).not.toHaveBeenCalled();
  });

  it('preserves an empty scope rather than falling back to department-wide reads', async () => {
    const f = fixture();
    f.tx.feeRecord.count.mockResolvedValue(0);
    f.tx.feeRecord.findMany.mockResolvedValue([]);
    await expect(f.read([])).resolves.toMatchObject({
      canReadLedger: true,
      ledger: { total: 0, items: [] },
    });
    expect(f.tx.feeRecord.count.mock.calls[0]![0].where.caseId).toEqual({
      in: [],
    });
  });

  it('propagates unexpected authorization and database failures', async () => {
    const auth = fixture();
    auth.access.authorizeDepartmentAction.mockRejectedValue(
      new Error('auth unavailable'),
    );
    await expect(auth.read()).rejects.toThrow('auth unavailable');
    const db = fixture();
    db.tx.feeRecord.count.mockRejectedValue(new Error('database unavailable'));
    await expect(db.read()).rejects.toThrow('database unavailable');
  });

  it('keeps the legacy row projection unchanged and hides partial proof names', () => {
    const input = row();
    const projected = projectFeeReadRow(input);
    expect(projected).not.toHaveProperty('sourceKind');
    expect(projected).not.toHaveProperty('sourceId');
    expect(
      projectFeeReadRow({ ...input, proofMaterialId: null })
        .proofOriginalFilename,
    ).toBeNull();
    expect(
      projectFeeReadRow({ ...input, proofContentVersionId: null })
        .proofOriginalFilename,
    ).toBeNull();
  });
});
