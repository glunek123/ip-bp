import { ForbiddenException } from '@nestjs/common';
import {
  CaseListPreferenceService,
  normalizeCaseListPreference,
} from './case-list-preference.service';
import { caseListColumns } from './case-list-preference.dto';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};

describe('CaseListPreferenceService', () => {
  function fixture() {
    const db = {
      userAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
      },
      caseListPreference: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest
          .fn()
          .mockImplementation(
            async ({
              create,
            }: {
              create: { columnOrder: string[]; hiddenColumns: string[] };
            }) => ({
              columnOrder: create.columnOrder,
              hiddenColumns: create.hiddenColumns,
            }),
          ),
      },
    };
    const access = {
      authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
    };
    const service = new CaseListPreferenceService(db as never, access as never);
    return { db, access, service };
  }

  it('returns defaults and keys reads to the current actor and bucket', async () => {
    const { db, service } = fixture();
    expect(await service.get(actor, 'all')).toEqual({
      order: [...caseListColumns],
      hidden: [],
    });
    expect(db.caseListPreference.findUnique).toHaveBeenCalledWith({
      where: {
        userId_departmentId_bucket: {
          userId: actor.userId,
          departmentId: actor.departmentId,
          bucket: 'all',
        },
      },
      select: { columnOrder: true, hiddenColumns: true },
    });
  });

  it('fully replaces the current bucket without a business write', async () => {
    const { db, service } = fixture();
    const order = [...caseListColumns];
    order.splice(2, 2, order[3], order[2]);
    const saved = await service.put(actor, 'WAITING_HEARING', {
      order,
      hidden: ['court'],
    });
    expect(saved).toEqual({ order, hidden: ['court'] });
    expect(db.caseListPreference.upsert).toHaveBeenCalledWith({
      where: {
        userId_departmentId_bucket: {
          userId: actor.userId,
          departmentId: actor.departmentId,
          bucket: 'WAITING_HEARING',
        },
      },
      create: {
        userId: actor.userId,
        departmentId: actor.departmentId,
        bucket: 'WAITING_HEARING',
        columnOrder: order,
        hiddenColumns: ['court'],
      },
      update: { columnOrder: order, hiddenColumns: ['court'] },
      select: { columnOrder: true, hiddenColumns: true },
    });
    expect(Object.keys(db)).toEqual(['userAccount', 'caseListPreference']);
  });

  it('normalizes stored future and damaged keys separately from request validation', () => {
    expect(
      normalizeCaseListPreference({
        columnOrder: ['court', 'future', 'court', 'stage', 'businessNo'],
        hiddenColumns: ['future', 'businessNo', 'court', 'court'],
      }),
    ).toEqual({
      order: [
        'businessNo',
        'stage',
        'court',
        ...caseListColumns.slice(2).filter((key) => key !== 'court'),
      ],
      hidden: ['court'],
    });
  });

  it('denies inactive, external and revoked actors before reading or writing preferences', async () => {
    const { db, access, service } = fixture();
    await expect(
      service.get({ ...actor, lawyerAccountId: actor.userId }, 'all'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    db.userAccount.findUnique.mockResolvedValue({
      accountType: 'INTERNAL',
      active: false,
    });
    await expect(service.get(actor, 'all')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    db.userAccount.findUnique.mockResolvedValue({
      accountType: 'INTERNAL',
      active: true,
    });
    access.authorizeDepartmentAction.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(
      service.put(actor, 'all', { order: [...caseListColumns], hidden: [] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.caseListPreference.findUnique).not.toHaveBeenCalled();
    expect(db.caseListPreference.upsert).not.toHaveBeenCalled();
  });
});
