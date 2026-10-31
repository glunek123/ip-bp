import type { ActorContext } from '../../access-control/actor-context';
import {
  SettlementAssessmentDraftService,
  type LockedSettlementAssessmentSource,
  type SettlementAssessmentDraftTransaction,
} from './settlement-assessment-draft.service';

const actor: ActorContext = {
  userId: 'operator',
  departmentId: 'dept',
  authorizationRevision: 1,
};
function setup() {
  const source: LockedSettlementAssessmentSource = {
    caseId: 'case',
    departmentId: 'dept',
    closureVersionId: 'closure',
    currentClosureVersionId: 'closure',
    termsVersion: 3,
    priorAssessment: null,
    inputs: {
      closureAmount: '1000.00',
      closureAmountState: 'KNOWN',
      fallbackClaimAmount: null,
      customerFormula: '结案金额 × 70%',
      lawyerMode: 'FULL_RISK',
      lawyerBaseFee: '0.00',
      lawyerSplitPercent: '30',
      customerManualAmount: null,
      lawyerManualAmount: null,
    },
  };
  const tx = {
    authorizeInternalOperatorAndLockCase: jest
      .fn()
      .mockResolvedValue(undefined),
    currentLockedSource: jest.fn().mockResolvedValue(source),
    audit: jest.fn().mockResolvedValue(undefined),
    append: jest.fn().mockResolvedValue(undefined),
  } satisfies SettlementAssessmentDraftTransaction;
  const service = new SettlementAssessmentDraftService({
    serializable: async (work) => work(tx),
  });
  return { service, source, tx };
}

describe('unregistered settlement assessment coordinator', () => {
  it('recomputes from locked inputs and audits the complete immutable snapshot', async () => {
    const { service, tx } = setup();
    const result = await service.execute(actor, {
      caseId: 'case',
      declaration: 'APPLICABLE',
    });
    expect(result).toMatchObject({
      customerAmount: '700.00',
      lawyerAmount: '300.00',
      termsVersion: 3,
      closureVersionId: 'closure',
      calculationResult: {
        customerSource: 'AUTOMATIC',
        lawyerSource: 'AUTOMATIC',
      },
    });
    expect(tx.audit).toHaveBeenCalledWith(
      expect.objectContaining({ details: result }),
    );
    expect(tx.append).toHaveBeenCalledWith(result);
    expect(
      tx.authorizeInternalOperatorAndLockCase.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.currentLockedSource.mock.invocationCallOrder[0]);
  });

  it('writes V2 snapshots with manual cents', async () => {
    const { service, source } = setup();
    source.inputs.customerManualAmount = '123.50';
    const result = await service.execute(actor, {
      caseId: 'case',
      declaration: 'APPLICABLE',
    });
    expect(result.customerAmount).toBe('123.50');
    expect(result.calculationRuleVersion).toBe(
      'settlement-calculation-v2-manual-cents-auto-whole-yuan-half-up',
    );
    expect(result.calculationResult?.customerSource).toBe('MANUAL');
  });

  it.each(['UNKNOWN', 'NOT_APPLICABLE'] as const)(
    'does not invent amounts for %s',
    async (declaration) => {
      const { service } = setup();
      const result = await service.execute(actor, {
        caseId: 'case',
        declaration,
      });
      expect(result.declaration).toBe(declaration);
      expect(result.customerAmount).toBeNull();
      expect(result.lawyerAmount).toBeNull();
      expect(result.calculationResult).toBeNull();
    },
  );

  it.each(['UNKNOWN', 'NOT_APPLICABLE'] as const)(
    'preserves invalid legacy terms for %s without calculating',
    async (declaration) => {
      const { service, source, tx } = setup();
      source.inputs.customerFormula = 'historical free-text formula';
      source.inputs.lawyerBaseFee = '-1';
      const result = await service.execute(actor, {
        caseId: 'case',
        declaration,
      });
      expect(result.calculationInputs).toEqual(source.inputs);
      expect(result.calculationResult).toBeNull();
      expect(result.customerAmount).toBeNull();
      expect(result.lawyerAmount).toBeNull();
      expect(tx.audit).toHaveBeenCalledWith(
        expect.objectContaining({ details: result }),
      );
    },
  );

  it('still rejects invalid formulas for applicable declarations', async () => {
    const { service, source, tx } = setup();
    source.inputs.customerFormula = 'historical free-text formula';
    await expect(
      service.execute(actor, { caseId: 'case', declaration: 'APPLICABLE' }),
    ).rejects.toThrow();
    expect(tx.append).not.toHaveBeenCalled();
  });

  it.each([
    'other-case',
    'other-department',
    'stale-closure',
    'negative-money',
    'unknown-amount',
  ])('rejects invalid authoritative source: %s', async (scenario) => {
    const { service, source, tx } = setup();
    if (scenario === 'other-case') source.caseId = 'other';
    if (scenario === 'other-department') source.departmentId = 'other';
    if (scenario === 'stale-closure') source.currentClosureVersionId = 'newer';
    if (scenario === 'negative-money') source.inputs.closureAmount = '-1';
    if (scenario === 'unknown-amount') {
      source.inputs.closureAmount = null;
      source.inputs.closureAmountState = 'PENDING';
    }
    await expect(
      service.execute(actor, { caseId: 'case', declaration: 'APPLICABLE' }),
    ).rejects.toThrow();
    expect(tx.audit).not.toHaveBeenCalled();
    expect(tx.append).not.toHaveBeenCalled();
  });

  it('does not append when authorization or audit fails', async () => {
    const { service, tx } = setup();
    tx.authorizeInternalOperatorAndLockCase.mockRejectedValueOnce(
      new Error('FORBIDDEN'),
    );
    await expect(
      service.execute(actor, { caseId: 'case', declaration: 'APPLICABLE' }),
    ).rejects.toThrow('FORBIDDEN');
    expect(tx.currentLockedSource).not.toHaveBeenCalled();
    tx.audit.mockRejectedValueOnce(new Error('AUDIT_FAILED'));
    await expect(
      service.execute(actor, { caseId: 'case', declaration: 'APPLICABLE' }),
    ).rejects.toThrow('AUDIT_FAILED');
    expect(tx.append).not.toHaveBeenCalled();
  });
});
