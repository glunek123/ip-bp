import { ForbiddenException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { NotaryListService } from './notary-list.service';

const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};

function fixture() {
  const scope = {
    departmentId: actor.departmentId,
    responsibleUserId: actor.userId,
  };
  const matter = {
    id: '33333333-3333-4333-8333-333333333333',
    businessNo: 'NT-001',
    stage: 'PENDING_EVIDENCE',
    departmentId: actor.departmentId,
    customerId: 'customer-1',
    rightsHolderId: 'rights-holder-1',
    evidenceMode: 'ONLINE_PURCHASE',
    evidence: null,
    opening: null,
    openingReviewDecision: null,
    issuanceDecision: null,
    certificate: null,
    createdAt: new Date('2026-09-24T01:00:00.000Z'),
    sourceLead: {
      id: 'lead-1',
      businessNo: 'LD-001',
      platform: 'TAOBAO',
      shopName: '精确店铺',
      shopExternalId: null,
      responsibleUserId: actor.userId,
      teamId: null,
    },
    notaryOffice: { id: 'office-1', name: '测试公证处' },
  };
  const repo = {
    findMany: jest.fn().mockResolvedValue([matter]),
    count: jest.fn().mockResolvedValue(1),
    groupBy: jest.fn().mockResolvedValue([
      { stage: 'PENDING_EVIDENCE', _count: { _all: 2 } },
      { stage: 'WAITING_UNBOX', _count: { _all: 1 } },
      { stage: 'ISSUANCE_DECISION', _count: { _all: 3 } },
      { stage: 'WAITING_CERTIFICATE', _count: { _all: 5 } },
      { stage: 'WAITING_RETURN', _count: { _all: 6 } },
      { stage: 'ARCHIVED', _count: { _all: 4 } },
    ]),
  };
  const access = {
    buildLeadScope: jest.fn().mockResolvedValue(scope),
    authorizeLead: jest.fn().mockResolvedValue(undefined),
    authorizeDepartmentAction: jest
      .fn()
      .mockRejectedValue(new ForbiddenException()),
  };
  const service = new NotaryListService(
    {
      notaryMatter: repo,
      customer: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'customer-1', name: '客户' }),
      },
      rightsHolder: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'rights-holder-1', name: '主体' }),
      },
      userAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
      },
    } as unknown as DatabaseService,
    access as unknown as AccessControlService,
  );
  return { service, repo, access, scope, matter };
}

describe('NotaryListService', () => {
  it('uses the source-lead scope for items, total and all stage counters', async () => {
    const { service, repo, access, scope, matter } = fixture();
    const result = await service.list(actor, 2, 20, 'PENDING_EVIDENCE');
    const baseWhere = { departmentId: actor.departmentId, sourceLead: scope };
    expect(access.buildLeadScope).toHaveBeenCalledWith(actor, 'lead.read');
    expect(repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ...baseWhere, stage: 'PENDING_EVIDENCE' },
        skip: 20,
        take: 20,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
    );
    expect(repo.count).toHaveBeenCalledWith({
      where: { ...baseWhere, stage: 'PENDING_EVIDENCE' },
    });
    expect(repo.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: baseWhere }),
    );
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: matter.id,
          businessNo: matter.businessNo,
          stage: matter.stage,
          sourceLead: { id: 'lead-1', businessNo: 'LD-001' },
          createdAt: matter.createdAt.toISOString(),
          transferredAt: '2026-09-24',
          fees: {
            notary: { state: 'UNRECORDED', amount: null },
            investigation: { state: 'UNRECORDED', amount: null },
            sample: { state: 'UNRECORDED', amount: null },
          },
          linkedCase: null,
          capabilities: expect.objectContaining({ recordEvidence: true }),
        }),
      ],
      total: 1,
      page: 2,
      pageSize: 20,
      counts: {
        PENDING_EVIDENCE: 2,
        WAITING_UNBOX: 1,
        UNBOX_REVIEW: 0,
        ISSUANCE_DECISION: 3,
        WAITING_CERTIFICATE: 5,
        WAITING_RETURN: 6,
        ARCHIVED: 4,
      },
    });
  });

  it.each([
    { clientCustomerId: 'client-1' },
    { notaryOfficeId: 'office-1' },
    { lawyerAccountId: actor.userId },
  ])(
    'rejects external actor contexts before list queries: %j',
    async (identity) => {
      const { service, repo } = fixture();
      await expect(
        service.list({ ...actor, ...identity }, 1, 20),
      ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
      expect(repo.findMany).not.toHaveBeenCalled();
    },
  );

  it('maps a missing lead.read grant to a stable forbidden response', async () => {
    const { service, access, repo } = fixture();
    access.buildLeadScope.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.list(actor, 1, 20)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(repo.findMany).not.toHaveBeenCalled();
  });
});
