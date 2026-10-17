import {
  Prisma,
  PermissionAction,
  PermissionScope,
} from '../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { AccessControlService } from '../../access-control/access-control.service';
import { PrismaAccessControlStore } from '../../access-control/prisma-access-control.store';
import { OrganizationService } from '../../access-control/organization.service';
import type { ActorContext } from '../../access-control/actor-context';
import { MaterialService } from '../materials';
import { FeeService } from './fee.service';
import { FeePageDto } from './fee.dto';
const actor: ActorContext = {
  userId: 'user',
  departmentId: 'department',
  authorizationRevision: 1,
};
function setup(accountType = 'INTERNAL') {
  const row = {
    id: 'fee',
    caseId: 'case',
    type: '诉讼费',
    direction: '支出',
    status: '未发起',
    amount: new Prisma.Decimal('20'),
    feeDate: new Date('2026-10-17T00:00:00.000Z'),
    source: 'manual',
    note: null,
    version: 2,
    proofMaterialId: 'material',
    proofContentVersionId: 'old-cv',
    proofContentVersion: { originalFilename: '原精确版本.pdf' },
    proofMaterial: {
      currentVersionId: 'new-cv',
      currentVersion: { originalFilename: '其他当前版本.pdf' },
    },
    case: {
      businessNo: 'CASE-1',
      courtCaseNo: null,
      stage: 'WAITING_ARCHIVE',
      sourceLead: null,
      defendants: [],
    },
  };
  const feeFind = jest.fn().mockResolvedValue([row]);
  const database = {
    feeRecord: { findMany: feeFind },
    userAccount: {
      findUnique: jest.fn(
        async ({
          select,
        }: {
          select: { memberships: { where: { departmentId: string } } };
        }) => ({
          active: true,
          accountType,
          authorizationRevision: 1,
          memberships:
            select.memberships.where.departmentId === actor.departmentId
              ? [{ id: 'member', teamId: null, team: null }]
              : [],
          roleAssignments: [
            {
              teamId: null,
              roleTemplate: {
                active: true,
                grants: [
                  {
                    action: PermissionAction.FEE_READ,
                    scope: PermissionScope.DEPARTMENT,
                  },
                ],
              },
            },
          ],
        }),
      ),
    },
  } as unknown as DatabaseService;
  const service = new FeeService(
    database,
    new AccessControlService(new PrismaAccessControlStore(database)),
    {} as OrganizationService,
    {} as MaterialService,
  );
  return { row, feeFind, service };
}
describe('fee proof exact filename projection', () => {
  it('keeps a read-only net projection with every exact source, and exposes the original IDs for selection', async () => {
    const f = setup();
    Object.assign(f.row, { type: '样品费', amount: new Prisma.Decimal(100) });
    const refund = {
      ...f.row,
      id: 'refund',
      type: '样品费退款',
      amount: new Prisma.Decimal(20),
      status: '发起',
      proofMaterialId: 'refund-material',
      proofContentVersionId: 'refund-cv',
      proofContentVersion: { originalFilename: '退款凭证.pdf' },
    };
    f.feeFind.mockResolvedValue([f.row, refund]);
    const result = await f.service.list(actor, new FeePageDto());
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'fee',
      amount: '80.00',
      sourceRows: [
        {
          id: 'fee',
          amount: '100.00',
          status: '未发起',
          proofContentVersionId: 'old-cv',
        },
        {
          id: 'refund',
          amount: '20.00',
          status: '发起',
          proofContentVersionId: 'refund-cv',
          proofOriginalFilename: '退款凭证.pdf',
        },
      ],
    });
    expect(result.matchingIds).toEqual(['fee', 'refund']);
    expect(result).toMatchObject({
      matchingSources: [
        { id: 'fee', amount: '100.00' },
        { id: 'refund', amount: '20.00' },
      ],
      summary: { expense: '80.00' },
    });
    expect(f.row.amount.toFixed(2)).toBe('100.00');
    expect(refund.amount.toFixed(2)).toBe('20.00');
  });
  it.each([20, 100])(
    'keeps both original rows in the case, and at zero net in the center (refund %s)',
    async (refundAmount) => {
      const f = setup();
      Object.assign(f.row, { type: '样品费', amount: new Prisma.Decimal(100) });
      f.feeFind.mockResolvedValue([
        f.row,
        {
          ...f.row,
          id: 'refund',
          type: '样品费退款',
          amount: new Prisma.Decimal(refundAmount),
        },
      ]);
      const inCase = await f.service.list(
        actor,
        Object.assign(new FeePageDto(), { caseId: 'case' }),
      );
      expect(inCase.items.map((row) => [row.id, row.amount])).toEqual([
        ['fee', '100.00'],
        ['refund', `${refundAmount}.00`],
      ]);
      expect(inCase.items.every((row) => !('sourceRows' in row))).toBe(true);
      if (refundAmount === 100) {
        const center = await f.service.list(actor, new FeePageDto());
        expect(center.items.map((row) => row.id)).toEqual(['fee', 'refund']);
        expect(center.summary.expense).toBe('0.00');
        expect(center.matchingIds).toEqual(['fee', 'refund']);
      }
    },
  );
  it('reads the exact referenced CV name even if the same material has a different current version', async () => {
    const f = setup();
    const result = await f.service.list(actor, new FeePageDto());
    expect(result.items[0]).toMatchObject({
      proofMaterialId: 'material',
      proofContentVersionId: 'old-cv',
      proofOriginalFilename: '原精确版本.pdf',
    });
    expect(f.feeFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: actor.departmentId,
          deletedAt: null,
        }),
        include: expect.objectContaining({
          proofContentVersion: { select: { originalFilename: true } },
        }),
      }),
    );
    expect(f.feeFind.mock.calls[0]![0].include).not.toHaveProperty(
      'proofMaterial',
    );
  });
  it('keeps an empty proof empty instead of inventing or falling back to a current filename', async () => {
    const f = setup();
    Object.assign(f.row, {
      proofMaterialId: null,
      proofContentVersionId: null,
      proofContentVersion: null,
    });
    const result = await f.service.list(actor, new FeePageDto());
    expect(result.items[0]?.proofOriginalFilename).toBeNull();
  });
  it.each(['CLIENT', 'LAWYER', 'NOTARY'])(
    'rejects %s before reading fee metadata even with an internal-looking grant fixture',
    async (type) => {
      const f = setup(type);
      await expect(
        f.service.list(actor, new FeePageDto()),
      ).rejects.toMatchObject({ status: 403 });
      expect(f.feeFind).not.toHaveBeenCalled();
    },
  );
  it('rejects a different department before querying any fee or file names', async () => {
    const f = setup();
    await expect(
      f.service.list(
        { ...actor, departmentId: 'foreign-department' },
        new FeePageDto(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.feeFind).not.toHaveBeenCalled();
  });
});
