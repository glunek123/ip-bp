import { LawyerAccountService } from './lawyer-account.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const userId = '33333333-3333-4333-8333-333333333333';
const targetId = '44444444-4444-4444-8444-444444444444';

describe('LawyerAccountService serializable conflicts', () => {
  const operations = {
    bindProfile: (service: LawyerAccountService) =>
      service.bindProfile(actor, userId, targetId, 1),
    setStatus: (service: LawyerAccountService) =>
      service.setStatus(actor, userId, false, 1),
    setBindingStatus: (service: LawyerAccountService) =>
      service.setBindingStatus(actor, userId, targetId, false, 1),
    resetPassword: (service: LawyerAccountService) =>
      service.resetPassword(actor, userId, 'Valid-password-2026!', 1),
  };

  for (const [name, operation] of Object.entries(operations)) {
    it.each([
      ['Prisma P2034', { code: 'P2034' }],
      [
        'nested PostgreSQL 40001',
        { meta: { driverAdapterError: { cause: { sqlState: '40001' } } } },
      ],
    ])(
      `${name} maps %s to VERSION_CONFLICT without side effects`,
      async (_kind, error) => {
        const db = { $transaction: jest.fn().mockRejectedValue(error) };
        const service = new LawyerAccountService(db as never, {} as never);
        await expect(operation(service)).rejects.toMatchObject({
          status: 409,
          response: { code: 'VERSION_CONFLICT' },
        });
        expect(db.$transaction).toHaveBeenCalledTimes(1);
      },
    );

    it(`${name} preserves unrelated transaction failures`, async () => {
      const error = new Error('ordinary failure');
      const db = { $transaction: jest.fn().mockRejectedValue(error) };
      const service = new LawyerAccountService(db as never, {} as never);
      await expect(operation(service)).rejects.toBe(error);
    });
  }
});

describe('LawyerAccountService profile account anchor', () => {
  it('rejects a profile anchored to another account before attempting a new binding', async () => {
    const tx = {
      userAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ active: true, accountType: 'INTERNAL' }),
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: userId, authorizationRevision: 1 }),
      },
      lawyerProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: targetId,
          boundUserId: '55555555-5555-4555-8555-555555555555',
        }),
      },
      lawyerAccountBinding: { findUnique: jest.fn(), create: jest.fn() },
    };
    const db = {
      $transaction: jest.fn(async (work: (reader: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const access = {
      authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
    };
    const service = new LawyerAccountService(db as never, access as never);
    await expect(
      service.bindProfile(actor, userId, targetId, 1),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'LAWYER_PROFILE_BOUND' },
    });
    expect(tx.lawyerAccountBinding.findUnique).not.toHaveBeenCalled();
    expect(tx.lawyerAccountBinding.create).not.toHaveBeenCalled();
  });

  it('does not list previously anchored profiles as first-time unbound candidates', async () => {
    const db = {
      userAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ active: true, accountType: 'INTERNAL' }),
      },
      lawyerProfile: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const access = {
      authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
    };
    const service = new LawyerAccountService(db as never, access as never);
    await expect(service.unboundProfiles(actor)).resolves.toEqual({
      items: [],
    });
    expect(db.lawyerProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accountBinding: { is: null },
          boundUserId: null,
        }),
      }),
    );
  });
});
