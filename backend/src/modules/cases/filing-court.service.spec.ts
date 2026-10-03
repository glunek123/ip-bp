import { FilingCourtService } from './filing-court.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = '33333333-3333-4333-8333-333333333333';

describe('FilingCourtService', () => {
  function fixture() {
    const db = {
      userAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ active: true, accountType: 'INTERNAL' }),
      },
      case: {
        findFirst: jest.fn().mockResolvedValue({
          stage: 'WAITING_FILING',
          departmentId: actor.departmentId,
          responsibleUserId: actor.userId,
          responsibleMembership: { teamId: null },
        }),
      },
      filingCourt: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'court', name: '人民法院' }),
      },
    };
    const access = {
      authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
      authorizeCase: jest.fn().mockResolvedValue(undefined),
    };
    return {
      db,
      access,
      service: new FilingCourtService(db as never, access as never),
    };
  }
  it('lists only courts in the case department for an internal reader', async () => {
    const f = fixture();
    expect(await f.service.list(actor, caseId)).toEqual({ items: [] });
    expect(f.db.filingCourt.findMany).toHaveBeenCalledWith({
      where: { departmentId: actor.departmentId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    });
  });
  it('creates a court only for an actor with the filing action', async () => {
    const f = fixture();
    expect(await f.service.create(actor, caseId, { name: '人民法院' })).toEqual(
      { id: 'court', name: '人民法院' },
    );
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.filing.submit',
      expect.objectContaining({
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
      }),
    );
  });
  it('rejects a duplicate within the department and does not advance a case', async () => {
    const f = fixture();
    f.db.filingCourt.create.mockRejectedValue({ code: 'P2002' });
    await expect(
      f.service.create(actor, caseId, { name: '人民法院' }),
    ).rejects.toMatchObject({ response: { code: 'COURT_ALREADY_EXISTS' } });
  });
  it('denies external accounts', async () => {
    const f = fixture();
    await expect(
      f.service.list(
        { ...actor, clientCustomerId: '44444444-4444-4444-8444-444444444444' },
        caseId,
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.db.filingCourt.findMany).not.toHaveBeenCalled();
  });
});
