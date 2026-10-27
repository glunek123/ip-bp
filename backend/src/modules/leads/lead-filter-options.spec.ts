import { ForbiddenException } from '@nestjs/common';
import { LeadService } from './lead.service';
import { DatabaseService } from '../../database/database.service';
import { AccessControlService } from '../../access-control/access-control.service';
import { MaterialService } from '../materials';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};

function fixture() {
  const database = {
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
    },
    customer: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'customer-1', name: '客户甲' }]),
    },
    rightsHolder: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'holder-1', name: '主体甲' }]),
    },
  };
  const access = {
    buildLeadScope: jest.fn().mockResolvedValue({
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
    }),
  };
  const service = new LeadService(
    database as unknown as DatabaseService,
    access as unknown as AccessControlService,
    {} as MaterialService,
  );
  return { database, access, service };
}

describe('lead and notary filter candidates', () => {
  it('limits customer candidates to readable library leads in the current status', async () => {
    const { database, service } = fixture();
    await expect(
      service.filterOptions(
        actor,
        'customer',
        ' 甲% ',
        'LIBRARY',
        'WAITING_PUSH',
      ),
    ).resolves.toEqual({
      items: [{ id: 'customer-1', name: '客户甲' }],
    });
    expect(database.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 20,
        where: {
          departmentId: actor.departmentId,
          name: { contains: '甲\\%', mode: 'insensitive' },
          leads: {
            some: {
              AND: [
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: actor.userId,
                },
                { status: { not: 'TRANSFERRED_TO_NOTARY' } },
                { status: 'WAITING_PUSH' },
              ],
            },
          },
        },
      }),
    );
  });

  it('limits rights-holder candidates to readable notary leads in the current stage', async () => {
    const { database, service } = fixture();
    await service.filterOptions(
      actor,
      'rightsHolder',
      '主体',
      undefined,
      undefined,
      'NOTARY',
      'PENDING_EVIDENCE',
    );
    expect(database.rightsHolder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          departmentId: actor.departmentId,
          name: { contains: '主体', mode: 'insensitive' },
          leads: {
            some: {
              AND: [
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: actor.userId,
                },
                {
                  notaryMatters: {
                    some: {
                      departmentId: actor.departmentId,
                      stage: 'PENDING_EVIDENCE',
                    },
                  },
                },
              ],
            },
          },
        },
      }),
    );
  });

  it('rejects withdrawn read access before querying candidates', async () => {
    const { database, access, service } = fixture();
    access.buildLeadScope.mockRejectedValue(new ForbiddenException());
    await expect(
      service.filterOptions(actor, 'customer', ''),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.customer.findMany).not.toHaveBeenCalled();
  });
});
