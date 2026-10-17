import { DatabaseService } from '../database/database.service';
import { permissionCatalog } from './permission-catalog';
import { PrismaAccessControlStore } from './prisma-access-control.store';

const actions = [
  ['EVIDENCE_READ', 'evidence.read'],
  ['EVIDENCE_EDIT', 'evidence.edit'],
  ['EVIDENCE_BULK_STATUS', 'evidence.bulk-status'],
  ['EVIDENCE_EXPORT', 'evidence.export'],
  ['SETTLEMENT_READ', 'settlement.read'],
  ['SETTLEMENT_TERMS_UPDATE', 'settlement.terms.update'],
  ['SETTLEMENT_LAUNCH', 'settlement.launch'],
  ['SETTLEMENT_BILL_CREATE', 'settlement.bill.create'],
  ['SETTLEMENT_BILL_CANCEL', 'settlement.bill.cancel'],
  ['FEE_READ', 'fee.read'],
  ['FEE_CREATE', 'fee.create'],
  ['FEE_UPDATE', 'fee.update'],
  ['FEE_LAUNCH', 'fee.launch'],
  ['FEE_DELETE', 'fee.delete'],
] as const;

describe('Demo module permission contract', () => {
  it('registers each explicit internal action once, with department scope only', () => {
    for (const [action] of actions) {
      const found = permissionCatalog.filter((item) => item.action === action);
      expect(found).toHaveLength(1);
      expect(found[0]?.scopes).toEqual(['DEPARTMENT']);
    }
  });

  it('maps only stored grants and does not infer a new grant from membership', async () => {
    const user = {
      active: true,
      accountType: 'INTERNAL',
      authorizationRevision: 1,
      memberships: [{ id: 'membership', teamId: null, team: null }],
      roleAssignments: [] as unknown[],
    };
    const findUnique = jest.fn().mockResolvedValue(user);
    const store = new PrismaAccessControlStore({
      userAccount: { findUnique },
    } as unknown as DatabaseService);
    expect((await store.loadSnapshot('actor', 'department'))?.grants).toEqual(
      [],
    );
    findUnique.mockResolvedValue({
      ...user,
      roleAssignments: [
        {
          teamId: null,
          roleTemplate: {
            active: true,
            grants: actions.map(([action]) => ({
              action,
              scope: 'DEPARTMENT',
            })),
          },
        },
      ],
    });
    expect((await store.loadSnapshot('actor', 'department'))?.grants).toEqual(
      actions.map(([, action]) => ({ action, scope: 'department' })),
    );
  });
});
