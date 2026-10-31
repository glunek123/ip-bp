import type { ActorContext } from '../../access-control/actor-context';
import { AccessControlService } from '../../access-control/access-control.service';
import { OrganizationService } from '../../access-control/organization.service';
import { DatabaseService } from '../../database/database.service';
import { MaterialService } from '../materials';
import { FeeService } from './fee.service';
import { CaseFeeEntryService } from './case-fee-entry.service';
import { SettlementService } from './settlement.service';
import { SettlementSideDtoValue } from './settlement.dto';
import { billSelection } from './settlement-ledger';
const actor: ActorContext = {
  userId: 'actor',
  departmentId: 'department',
  authorizationRevision: 1,
};
const feeInput = {
  caseId: 'case',
  type: '诉讼费' as const,
  direction: '支出' as const,
  status: '未发起',
  amount: '0',
  feeDate: '2026-10-31',
  idempotencyKey: 'strict-positive',
};
function setup() {
  const boundary = new Error('TRANSACTION_BOUNDARY_NOT_EXECUTED');
  const transaction = jest.fn(async () => {
    throw boundary;
  });
  const database = { $transaction: transaction } as unknown as DatabaseService;
  const access = {} as AccessControlService,
    organization = {} as OrganizationService;
  return {
    transaction,
    boundary,
    fees: new FeeService(database, access, organization, {} as MaterialService),
    batch: new CaseFeeEntryService(database, access, organization),
    settlement: new SettlementService(database, access, organization),
  };
}
describe('strict positive amount validation through public service methods', () => {
  const routes = [
    {
      name: 'fee create',
      code: 'INVALID_FEE_AMOUNT',
      invoke: (f: ReturnType<typeof setup>, amount: string) =>
        f.fees.create(actor, { ...feeInput, amount }),
    },
    {
      name: 'case fee entry',
      code: 'INVALID_CASE_FEE_ENTRIES',
      invoke: (f: ReturnType<typeof setup>, amount: string) =>
        f.batch.create(actor, {
          caseId: 'case',
          idempotencyKey: 'batch',
          rows: [{ ...feeInput, amount }],
        }),
    },
    {
      name: 'settlement launch',
      code: 'INVALID_AMOUNT',
      invoke: (f: ReturnType<typeof setup>, amount: string) =>
        f.settlement.launch(actor, 'case', {
          side: SettlementSideDtoValue.CUSTOMER,
          amount,
          launchDate: '2026-10-31',
          expectedTermsVersion: 1,
          idempotencyKey: 'launch',
        }),
    },
    {
      name: 'refund',
      code: 'INVALID_REFUND_AMOUNT',
      invoke: (f: ReturnType<typeof setup>, amount: string) =>
        f.fees.reconcileCancelledRefund(actor, 'fee', {
          amount,
          refundDate: '2026-10-31',
          proofMaterialId: null,
          proofContentVersionId: null,
          idempotencyKey: 'refund',
        }),
    },
  ];
  for (const route of routes) {
    it.each(['0', '0.00'])(
      `${route.name} rejects positive zero %s before transaction`,
      async (amount) => {
        const f = setup();
        await expect(route.invoke(f, amount)).rejects.toMatchObject({
          response: { code: route.code },
        });
        expect(f.transaction).not.toHaveBeenCalled();
      },
    );
    it(`${route.name} admits one cent to the transaction boundary`, async () => {
      const f = setup();
      await expect(route.invoke(f, '0.01')).rejects.toBe(f.boundary);
      expect(f.transaction).toHaveBeenCalledTimes(1);
    });
  }
  it.each(['0', '0.00'])('bill helper rejects zero selection %s', (amount) => {
    expect(() =>
      billSelection(
        'CUSTOMER',
        ['launch'],
        [
          {
            id: 'launch',
            side: 'CUSTOMER',
            amount,
            billId: null,
            payeeId: 'customer',
          },
        ],
      ),
    ).toThrow('INVALID_BILL_SELECTION');
  });
  it('bill helper preserves one cent exactly', () => {
    expect(
      billSelection(
        'CUSTOMER',
        ['launch'],
        [
          {
            id: 'launch',
            side: 'CUSTOMER',
            amount: '0.01',
            billId: null,
            payeeId: 'customer',
          },
        ],
      ),
    ).toEqual({ ids: ['launch'], amount: '0.01', payeeIds: ['customer'] });
  });
});
