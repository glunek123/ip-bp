import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { CaseDeleteService } from './case-delete.service';
import type { AccessControlService } from '../../access-control/access-control.service';
import type { DeletionAuditService } from '../deletion-audit';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};

const nativeCase = {
  id: 'case-1',
  businessNo: 'CA-1',
  stage: 'WAITING_COMPLAINT',
  version: 4,
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
    const counts: Record<string, number> = {};
    const countFor = (model: string) => ({
      count: jest.fn(async () => counts[model] ?? 0),
    });
    const tx = {
      case: {
        findFirst: jest.fn().mockResolvedValue(nativeCase),
        delete: jest.fn().mockResolvedValue({ id: 'case-1' }),
      },
      feeRecord: countFor('feeRecord'),
      caseLegacyPayment: countFor('caseLegacyPayment'),
      caseClosurePaymentVersion: countFor('caseClosurePaymentVersion'),
      caseSettlementLaunch: countFor('caseSettlementLaunch'),
      caseRefundApplication: countFor('caseRefundApplication'),
      caseComplaintConfirmation: countFor('caseComplaintConfirmation'),
      caseFilingSubmission: countFor('caseFilingSubmission'),
      caseAcceptance: countFor('caseAcceptance'),
      auditEvent: {
        findMany: jest.fn().mockResolvedValue([
          { action: 'case.complaint.submit', createdAt: new Date('2026-11-02T00:00:00Z') },
        ]),
      },
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 'case-1' }]),
    };
    const db = {
      $transaction: jest.fn<
        Promise<unknown>,
        [run: (client: unknown) => unknown, options?: unknown]
      >(async (run) => run(tx)),
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
    return { service, db, tx, access, audit, counts };
  }

  it('deletes the case and writes the deletion log in the same transaction', async () => {
    const f = fixture();
    await expect(
      f.service.remove(actor, 'case-1', { reason: '误创建重复案件' }),
    ).resolves.toEqual({ id: 'case-1' });
    expect(f.tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      'case-1',
      actor.departmentId,
    );
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
          auditTrail: [
            { action: 'case.complaint.submit', at: '2026-11-02T00:00:00.000Z' },
          ],
        }),
      }),
    );
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expect(f.db.$transaction.mock.calls[0]?.[1]).toMatchObject({
      timeout: 15000,
    });
  });

  it('checks the delete permission inside the transaction', async () => {
    const f = fixture();
    await f.service.remove(actor, 'case-1', { reason: '误建' });
    expect(f.access.authorizeDepartmentAction).toHaveBeenCalledWith(
      actor,
      'case.delete',
      f.tx,
    );
  });

  it('refuses deletion without a reason', async () => {
    const f = fixture();
    await expect(f.service.remove(actor, 'case-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      f.service.remove(actor, 'case-1', { reason: '   ' }),
    ).rejects.toMatchObject({
      response: { code: 'CASE_DELETE_REASON_REQUIRED' },
    });
    expect(f.tx.case.delete).not.toHaveBeenCalled();
  });

  it('blocks deletion when the case already produced fees, payments or litigation facts', async () => {
    const f = fixture();
    f.counts.feeRecord = 1;
    f.counts.caseAcceptance = 2;
    await expect(
      f.service.remove(actor, 'case-1', { reason: '误建' }),
    ).rejects.toMatchObject({
      response: { code: 'CASE_HAS_RECORDS' },
    });
    expect(f.audit.record).not.toHaveBeenCalled();
    expect(f.tx.case.delete).not.toHaveBeenCalled();
  });

  it('rolls the deletion back when the deletion log cannot be written', async () => {
    const f = fixture();
    f.audit.record.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(
      f.service.remove(actor, 'case-1', { reason: '误建' }),
    ).rejects.toThrow('audit unavailable');
    expect(f.tx.case.delete).not.toHaveBeenCalled();
  });

  it('refuses deletion without the case delete permission', async () => {
    const f = fixture();
    f.access.authorizeDepartmentAction.mockRejectedValueOnce(
      new ForbiddenException({ code: 'FORBIDDEN' }),
    );
    await expect(
      f.service.remove(actor, 'case-1', { reason: '误建' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.tx.case.delete).not.toHaveBeenCalled();
  });

  it('refuses deletion for lawyer and client actors', async () => {
    const f = fixture();
    await expect(
      f.service.remove(
        { ...actor, lawyerAccountId: 'lawyer-1' },
        'case-1',
        { reason: '误建' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      f.service.remove(
        { ...actor, clientCustomerId: 'client-1' },
        'case-1',
        { reason: '误建' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.tx.case.delete).not.toHaveBeenCalled();
  });

  it('rejects a stale expected version', async () => {
    const f = fixture();
    await expect(
      f.service.remove(actor, 'case-1', {
        reason: '误建',
        expectedVersion: 99,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.case.delete).not.toHaveBeenCalled();
  });

  it('reports a missing case without touching the log', async () => {
    const f = fixture();
    f.tx.$queryRawUnsafe.mockResolvedValue([]);
    await expect(
      f.service.remove(actor, 'case-1', { reason: '误建' }),
    ).rejects.toMatchObject({ response: { code: 'CASE_NOT_FOUND' } });
    expect(f.audit.record).not.toHaveBeenCalled();
  });

  it('cleans a migrated case through the database function and still leaves a log', async () => {
    const f = fixture();
    f.tx.case.findFirst.mockResolvedValue(legacyCase);
    await expect(
      f.service.remove(actor, 'case-1', { reason: '误建历史空壳' }),
    ).resolves.toEqual({ id: 'case-1' });
    expect(f.tx.$queryRawUnsafe).toHaveBeenCalledWith(
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
        deleteReason: '误建历史空壳',
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
