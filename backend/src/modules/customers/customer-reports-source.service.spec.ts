import {
  AccessControlService,
  AccessControlSnapshot,
  PermissionScope,
} from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { Prisma } from '../../generated/prisma/client';
import { CustomerReportsSourceService } from './customer-reports-source.service';

const actor: ActorContext = {
  userId: 'operator',
  departmentId: 'department-a',
  authorizationRevision: 4,
};
type Grants = AccessControlSnapshot['grants'];
const reportGrants: Grants = [
  { action: 'case.read', scope: 'department' },
  { action: 'report.amount.read', scope: 'department' },
  { action: 'report.export', scope: 'department' },
];
function fixture(
  grants: Grants = [
    ...reportGrants,
    { action: 'customer.read', scope: 'department' },
  ],
) {
  const reader = { customer: { count: jest.fn().mockResolvedValue(7) } };
  const loadSnapshot = jest
    .fn()
    .mockResolvedValue({ active: true, authorizationRevision: 4, grants });
  const access = new AccessControlService({ loadSnapshot });
  const source = new CustomerReportsSourceService(access);
  return {
    reader,
    tx: reader as unknown as Prisma.TransactionClient,
    loadSnapshot,
    source,
  };
}
describe('CustomerReportsSourceService', () => {
  it('requires explicit department domain and report/export permission before counting, using the caller transaction', async () => {
    const { source, reader, tx, loadSnapshot } = fixture();
    await expect(source.count(actor, 'department', tx)).resolves.toBe(7);
    expect(reader.customer.count).toHaveBeenCalledWith({
      where: { departmentId: actor.departmentId, deletedAt: null },
    });
    expect(loadSnapshot).toHaveBeenCalledTimes(2);
    for (const call of loadSnapshot.mock.calls)
      expect(call).toEqual([actor.userId, actor.departmentId, tx]);
    expect(loadSnapshot.mock.invocationCallOrder[1]).toBeLessThan(
      reader.customer.count.mock.invocationCallOrder[0],
    );
  });
  it.each(['self', 'team', 'department'] as PermissionScope[])(
    'intersects mine owner with the existing %s domain scope',
    async (scope) => {
      const grant = {
        action: 'customer.read' as const,
        scope,
        ...(scope === 'team' ? { teamId: 'team-a' } : {}),
      };
      const { source, reader, tx } = fixture([...reportGrants, grant]);
      await source.count(actor, 'mine', tx);
      const expectedRead = {
        departmentId: actor.departmentId,
        ...(scope === 'self'
          ? { responsibleUserId: actor.userId }
          : scope === 'team'
            ? { teamId: { in: ['team-a'] } }
            : {}),
      };
      expect(reader.customer.count).toHaveBeenCalledWith({
        where: {
          departmentId: actor.departmentId,
          deletedAt: null,
          AND: [expectedRead, { responsibleUserId: actor.userId }],
        },
      });
    },
  );
  it.each(['self', 'team'] as const)(
    'does not label a %s domain grant as department-wide access',
    async (scope) => {
      const { source, reader, tx } = fixture([
        ...reportGrants,
        { action: 'customer.read', scope, teamId: 'team-a' },
      ]);
      await expect(source.count(actor, 'department', tx)).rejects.toMatchObject(
        { status: 403, response: { code: 'ACTION_FORBIDDEN' } },
      );
      expect(reader.customer.count).not.toHaveBeenCalled();
    },
  );
  it('does not substitute case/report rights for the separate domain read grant or return a fake zero', async () => {
    const { source, reader, tx } = fixture(reportGrants);
    await expect(source.count(actor, 'mine', tx)).rejects.toMatchObject({
      status: 403,
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(reader.customer.count).not.toHaveBeenCalled();
  });
  it.each(['case.read', 'report.amount.read', 'report.export'] as const)(
    'requires %s independently even when domain read is department-wide',
    async (missing) => {
      const { source, reader, tx } = fixture([
        ...reportGrants.filter((grant) => grant.action !== missing),
        { action: 'customer.read', scope: 'department' },
      ]);
      await expect(source.count(actor, 'mine', tx)).rejects.toMatchObject({
        status: 403,
        response: { code: 'ACTION_FORBIDDEN' },
      });
      expect(reader.customer.count).not.toHaveBeenCalled();
    },
  );
  it.each(['report.amount.read', 'report.export'] as const)(
    'does not expand SELF %s to a requested department export',
    async (action) => {
      const grants = reportGrants.map((grant) =>
        grant.action === action ? { ...grant, scope: 'self' as const } : grant,
      );
      const { source, reader, tx } = fixture([
        ...grants,
        { action: 'customer.read', scope: 'department' },
      ]);
      await expect(source.count(actor, 'department', tx)).rejects.toMatchObject(
        { status: 403, response: { code: 'ACTION_FORBIDDEN' } },
      );
      expect(reader.customer.count).not.toHaveBeenCalled();
    },
  );
  it('retains a real authorized zero without reading records or starting a nested transaction', async () => {
    const { source, reader, tx } = fixture();
    reader.customer.count.mockResolvedValue(0);
    await expect(source.count(actor, 'department', tx)).resolves.toBe(0);
    expect(Object.keys(reader)).toEqual(['customer']);
  });
  it.each([
    { clientCustomerId: 'customer' },
    { lawyerAccountId: 'lawyer' },
    { notaryOfficeId: 'office' },
  ])(
    'rejects external principals even with internal-looking grants',
    async (external) => {
      const { source, reader, tx, loadSnapshot } = fixture();
      await expect(
        source.count({ ...actor, ...external }, 'mine', tx),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'ACTION_FORBIDDEN' },
      });
      expect(reader.customer.count).not.toHaveBeenCalled();
      expect(loadSnapshot).not.toHaveBeenCalled();
    },
  );
  it('revalidates current grants for every call instead of caching a successful export', async () => {
    const { source, reader, tx, loadSnapshot } = fixture();
    await source.count(actor, 'mine', tx);
    loadSnapshot.mockResolvedValue({
      active: true,
      authorizationRevision: 4,
      grants: reportGrants,
    });
    await expect(source.count(actor, 'mine', tx)).rejects.toMatchObject({
      status: 403,
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(reader.customer.count).toHaveBeenCalledTimes(1);
  });
  it('preserves unexpected ACL and count failures', async () => {
    const { source, reader, tx, loadSnapshot } = fixture();
    const countFailure = new Error('count unavailable');
    reader.customer.count.mockRejectedValue(countFailure);
    await expect(source.count(actor, 'mine', tx)).rejects.toBe(countFailure);
    const aclFailure = new Error('store unavailable');
    loadSnapshot.mockRejectedValue(aclFailure);
    await expect(source.count(actor, 'mine', tx)).rejects.toBe(aclFailure);
    expect(reader.customer.count).toHaveBeenCalledTimes(1);
  });
  it.each([-1, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid aggregate count rather than publishing it',
    async (count) => {
      const { source, reader, tx } = fixture();
      reader.customer.count.mockResolvedValue(count);
      await expect(source.count(actor, 'mine', tx)).rejects.toMatchObject({
        status: 500,
        response: { code: 'REPORT_SOURCE_INVALID' },
      });
    },
  );
});
