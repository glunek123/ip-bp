import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CaseDeleteService } from './case-delete.service';
import type { AccessControlService } from '../../access-control/access-control.service';
import type { DeletionAuditService } from './deletion-audit.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};

const nativeCase = {
  id: 'case-1',
  businessNo: 'CA-1',
  stage: 'WAITING_COMPLAINT',
  createdAt: new Date('2026-11-01T00:00:00Z'),
  responsibleUserId: actor.userId,
  customerId: 'customer-1',
  customer: { name: '真实客户' },
  externalEntry: null,
};

const legacyCase = {
  ...nativeCase,
  businessNo: 'CA-LEGACY',
  externalEntry: { id: 'entry-1', entryKind: 'HISTORICAL_BACKFILL' },
};

describe('CaseDeleteService', () => {
  function fixture() {
    const tx = {
      case: {
        findFirst: jest.fn().mockResolvedValue(nativeCase),
        delete: jest.fn().mockResolvedValue({ id: 'case-1' }),
      },
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    };
    const db = {
      $transaction: jest.fn(async (run: (client: unknown) => unknown) =>
        run(tx),
      ),
    };
    const access = {
      authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
    };
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    const service = new CaseDeleteService(
      db as never,
      access as unknown as AccessControlService,
      audit as unknown as DeletionAuditService,
    );
    return { service, db, tx, access, audit };
  }

  it('deletes the case and writes the deletion log in the same transaction', async () => {
    const f = fixture();
    await expect(
      f.service.remove(actor, 'case-1', '误创建重复案件'),
    ).resolves.toEqual({ id: 'case-1' });
    expect(f.tx.case.delete).toHaveBeenCalledWith({
      where: { id: 'case-1', departmentId: actor.departmentId },
    });
    expect(f.audit.record).toHaveBeenCalledWith(
      f.tx,
      actor,
      expect.objectContaining({
        entityType: 'CASE',
        entityId: 'case-1',
        businessNo: 'CA-1',
        deleteReason: '误创建重复案件',
        snapshot: expect.objectContaining({
          businessNo: 'CA-1',
          stage: 'WAITING_COMPLAINT',
          customerName: '真实客户',
          source: { kind: 'NATIVE' },
        }),
      }),
    );
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rolls the deletion back when the deletion log cannot be written', async () => {
    const f = fixture();
    f.audit.record.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(f.service.remove(actor, 'case-1')).rejects.toThrow(
      'audit unavailable',
    );
  });

  it('refuses deletion without the case delete permission', async () => {
    const f = fixture();
    f.access.authorizeDepartmentAction.mockRejectedValueOnce(
      new ForbiddenException({ code: 'FORBIDDEN' }),
    );
    await expect(f.service.remove(actor, 'case-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.tx.case.delete).not.toHaveBeenCalled();
  });

  it('refuses deletion for lawyer and client actors', async () => {
    const f = fixture();
    await expect(
      f.service.remove({ ...actor, lawyerAccountId: 'lawyer-1' }, 'case-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      f.service.remove({ ...actor, clientCustomerId: 'client-1' }, 'case-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.tx.case.delete).not.toHaveBeenCalled();
  });

  it('blocks deletion when the case already produced related records', async () => {
    const f = fixture();
    f.tx.case.delete.mockRejectedValueOnce({ code: 'P2003' });
    await expect(f.service.remove(actor, 'case-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(f.audit.record).not.toHaveBeenCalled();
  });

  it('cleans a migrated case through the database function and still leaves a log', async () => {
    const f = fixture();
    f.tx.case.findFirst.mockResolvedValue(legacyCase);
    await expect(f.service.remove(actor, 'case-1')).resolves.toEqual({
      id: 'case-1',
    });
    expect(f.tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT delete_legacy_case($1::uuid)',
      'case-1',
    );
    expect(f.tx.case.delete).not.toHaveBeenCalled();
    expect(f.audit.record).toHaveBeenCalledWith(
      f.tx,
      actor,
      expect.objectContaining({
        entityType: 'CASE',
        businessNo: 'CA-LEGACY',
        snapshot: expect.objectContaining({
          source: {
            kind: 'EXTERNAL_ENTRY',
            entryKind: 'HISTORICAL_BACKFILL',
          },
        }),
      }),
    );
  });
});
