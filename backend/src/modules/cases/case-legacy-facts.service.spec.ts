import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CaseLegacyFactsService } from './case-legacy-facts.service';

describe('CaseLegacyFactsService', () => {
  const actor = {
    userId: 'user-1',
    departmentId: 'dept-1',
    authorizationRevision: 1,
  };

  function createService() {
    const db = {
      case: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      $executeRawUnsafe: jest.fn(),
    };
    const access = {
      authorizeCase: jest.fn().mockResolvedValue(undefined),
    };
    return {
      db,
      access,
      service: new CaseLegacyFactsService(db as never, access as never),
    };
  }

  it('rejects external actors', async () => {
    const { service } = createService();
    await expect(
      service.update({ ...actor, clientCustomerId: 'cust-1' }, 'case-1', {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects unauthorized internal actors via AccessControlService', async () => {
    const { db, access, service } = createService();
    db.case.findFirst.mockResolvedValueOnce({
      id: 'case-1',
      departmentId: 'dept-1',
      responsibleUserId: 'other-user',
      responsibleMembership: { teamId: null },
    });
    access.authorizeCase.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.update(actor, 'case-1', {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(access.authorizeCase).toHaveBeenCalledWith(actor, 'case.routine.edit', {
      departmentId: 'dept-1',
      responsibleUserId: 'other-user',
    });
    expect(db.case.update).not.toHaveBeenCalled();
  });

  it('throws when case is missing in actor department', async () => {
    const { db, service } = createService();
    db.case.findFirst.mockResolvedValueOnce(null);
    await expect(service.update(actor, 'case-1', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects invalid calendar dates', async () => {
    const { db, service } = createService();
    db.case.findFirst.mockResolvedValueOnce({
      id: 'case-1',
      departmentId: 'dept-1',
      responsibleUserId: 'user-1',
      responsibleMembership: { teamId: null },
    });
    await expect(
      service.update(actor, 'case-1', { hearingOn: '2026-02-30' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.case.update).not.toHaveBeenCalled();
  });

  it('updates expanded legacy fields via Prisma without raw SQL functions', async () => {
    const { db, service } = createService();
    db.case.findFirst.mockResolvedValueOnce({
      id: 'case-1',
      departmentId: 'dept-1',
      responsibleUserId: 'user-1',
      responsibleMembership: { teamId: 'team-1' },
    });
    db.case.update.mockResolvedValueOnce({ id: 'case-1' });

    const result = await service.update(actor, 'case-1', {
      mediationNo: '  (2025)诉前调12号  ',
      hearingOn: '2025-05-20',
      notarizationNumber: ' (2025)京长安内经证字第99号 ',
      executionNo: '',
      executionOn: '2025-08-01',
      customerSettleNote: ' 已开票 ',
      lawyerSettleNote: null,
    });

    expect(result).toEqual({ id: 'case-1' });
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(db.case.update).toHaveBeenCalledWith({
      where: { id: 'case-1' },
      data: {
        legacyMediationNo: '(2025)诉前调12号',
        legacyHearingOn: new Date('2025-05-20T00:00:00.000Z'),
        legacyNotarizationNumber: '(2025)京长安内经证字第99号',
        legacyExecutionNo: null,
        legacyExecutionOn: new Date('2025-08-01T00:00:00.000Z'),
        legacyCustomerSettleNote: '已开票',
        legacyLawyerSettleNote: null,
      },
    });
  });
});
