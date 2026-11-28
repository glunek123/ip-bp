import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AccessControlService } from '../../access-control/access-control.service';
import type { DeletionAuditService } from '../deletion-audit';
import { LegacyAttachmentsService } from './legacy-attachments.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};

describe('LegacyAttachmentsService', () => {
  function fixture() {
    const sampleRow = {
      id: 'att-uuid-1',
      legacyAttachmentId: BigInt('9007199254740993'),
      ownerType: 'CASE',
      ownerId: 'case-1',
      legacyOwnerId: '100',
      categoryCode: 'CASE_JUDGEMENT_FILE',
      categoryLabel: '判决书',
      title: '判决书.pdf',
      filename: 'judgement.pdf',
      extname: '.pdf',
      sizeBytes: BigInt(204800),
      mimeType: 'application/pdf',
      ossPath: '2025/judgement.pdf',
      ossUrl: 'https://bstfw-ip.oss-cn-hangzhou.aliyuncs.com/ipjiaofu/pro/2025/judgement.pdf',
      createdAt: new Date('2026-11-27T10:00:00Z'),
    };
    const tx = {
      legacyAttachment: {
        findUnique: jest.fn().mockResolvedValue(sampleRow),
        delete: jest.fn().mockResolvedValue(sampleRow),
      },
      case: {
        findFirst: jest.fn().mockResolvedValue({
          departmentId: actor.departmentId,
          businessNo: '001202501',
        }),
      },
      lead: { findFirst: jest.fn() },
      notaryMatter: { findFirst: jest.fn() },
      customer: { findFirst: jest.fn() },
      rightsHolder: { findFirst: jest.fn() },
    };
    const db = {
      case: {
        findFirst: jest.fn().mockResolvedValue({
          departmentId: actor.departmentId,
          responsibleUserId: actor.userId,
        }),
      },
      lead: { findFirst: jest.fn() },
      notaryMatter: { findFirst: jest.fn() },
      customer: { findFirst: jest.fn() },
      legacyAttachment: {
        findMany: jest.fn().mockResolvedValue([sampleRow]),
      },
      $transaction: jest.fn(async (run: (client: unknown) => unknown) => run(tx)),
    };
    const access = {
      authorizeCase: jest.fn().mockResolvedValue(undefined),
      authorizeLead: jest.fn().mockResolvedValue(undefined),
      authorizeCustomer: jest.fn().mockResolvedValue(undefined),
      authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
    };
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    const service = new LegacyAttachmentsService(
      db as never,
      access as unknown as AccessControlService,
      audit as unknown as DeletionAuditService,
    );
    return { service, db, tx, access, audit, sampleRow };
  }

  it('lists serialized legacy attachments for same-department authorized owner', async () => {
    const f = fixture();
    const res = await f.service.list(actor, 'CASE', 'case-1');
    expect(f.access.authorizeCase).toHaveBeenCalledWith(actor, 'case.read', {
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
    });
    expect(res.items).toEqual([
      expect.objectContaining({
        id: 'att-uuid-1',
        legacyAttachmentId: '9007199254740993',
        sizeBytes: 204800,
        categoryLabel: '判决书',
        ossUrl:
          'https://bstfw-ip.oss-cn-hangzhou.aliyuncs.com/ipjiaofu/pro/2025/judgement.pdf',
      }),
    ]);
  });

  it('rejects external accounts from listing legacy attachments', async () => {
    const f = fixture();
    await expect(
      f.service.list({ ...actor, lawyerAccountId: 'lawyer-1' }, 'CASE', 'case-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws NotFoundException when owner does not exist in actor department', async () => {
    const f = fixture();
    f.db.case.findFirst.mockResolvedValueOnce(null);
    await expect(
      f.service.list(actor, 'CASE', 'other-case'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires delete reason and writes deletion audit in the same transaction', async () => {
    const f = fixture();
    await expect(
      f.service.remove(actor, 'att-uuid-1', '   '),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      f.service.remove(actor, 'att-uuid-1', '历史重复附件清理'),
    ).resolves.toEqual({ id: 'att-uuid-1' });
    expect(f.access.authorizeDepartmentAction).toHaveBeenCalledWith(
      actor,
      'case.delete',
      f.tx,
    );
    expect(f.audit.record).toHaveBeenCalledWith(
      f.tx,
      actor,
      expect.objectContaining({
        entityType: 'LEGACY_ATTACHMENT',
        entityId: 'att-uuid-1',
        businessNo: '001202501',
        deleteReason: '历史重复附件清理',
      }),
    );
    expect(f.tx.legacyAttachment.delete).toHaveBeenCalledWith({
      where: { id: 'att-uuid-1' },
    });
  });
});
