import { Prisma } from '../../generated/prisma/client';
import { readCaseSettlementSource } from './case-settlement-source';

const original = {
  id: 'closure-version',
  closureId: 'closure',
  caseId: 'case',
  departmentId: 'department',
  closeAmountState: 'KNOWN',
  closeAmt: new Prisma.Decimal('100'),
};
const correction = (
  amount: string | null,
  priorCorrectionId: string | null = null,
) => ({
  id: 'edit-1',
  closureId: 'closure',
  caseId: 'case',
  departmentId: 'department',
  sourceClosureVersionId: 'closure-version',
  priorCorrectionId,
  fromRevision: 0,
  toRevision: 1,
  correctionReason: '实际资料更正',
  recordedAt: new Date('2026-10-17T00:00:00.000Z'),
  recordedByUserId: 'actor',
  closeAmountState: amount === null ? 'PENDING' : 'KNOWN',
  closeAmt: amount === null ? null : new Prisma.Decimal(amount),
});
function record(corrections: ReturnType<typeof correction>[] = []) {
  return {
    id: 'case',
    departmentId: 'department',
    businessNo: 'CASE-1',
    customerId: 'customer',
    stage: 'WAITING_ARCHIVE',
    version: 11,
    complaintAmountState: 'KNOWN',
    complaintAmount: new Prisma.Decimal('900'),
    complaintConfirmation: null,
    customer: { id: 'customer', departmentId: 'department', name: '客户甲' },
    lawyers: [],
    closure: {
      id: 'closure',
      caseId: 'case',
      departmentId: 'department',
      currentVersion: original,
      recordCorrections: corrections,
    },
  };
}
function reader(value: unknown) {
  return {
    case: { findFirst: jest.fn().mockResolvedValue(value) },
  } as unknown as Pick<Prisma.TransactionClient, 'case'>;
}

describe('public case settlement effective source', () => {
  it.each([
    ['80', 'KNOWN', '80.00'],
    ['0', 'KNOWN', '0.00'],
    [null, 'PENDING', null],
  ])(
    'reads the full correction chain for %s without changing the original amount',
    async (value, state, expected) => {
      const source = await readCaseSettlementSource(
        reader(record([correction(value)])),
        { caseId: 'case', departmentId: 'department' },
      );
      expect(source?.closure).toEqual({
        rootId: 'closure',
        sourceVersionId: 'closure-version',
        revision: 1,
        state,
        amount: expected,
      });
      expect(source?.claimAmount).toBe('900.00');
      expect(original.closeAmt.toString()).toBe('100');
      expect(source?.caseVersion).toBe(11);
    },
  );

  it('keeps an absent closure distinct from an explicitly pending closure', async () => {
    const absent = { ...record(), closure: null };
    const source = await readCaseSettlementSource(reader(absent), {
      caseId: 'case',
      departmentId: 'department',
    });
    expect(source?.closure).toMatchObject({
      state: 'UNRECORDED',
      amount: null,
    });
  });

  it.each([
    { ...correction('80'), sourceClosureVersionId: 'old-version' },
    { ...correction('80'), priorCorrectionId: 'missing-edit' },
    { ...correction('80'), fromRevision: 1, toRevision: 2 },
    { ...correction('80'), departmentId: 'other-department' },
  ])(
    'rejects a foreign anchor or broken chain rather than trusting its last row',
    async (edit) => {
      await expect(
        readCaseSettlementSource(reader(record([edit])), {
          caseId: 'case',
          departmentId: 'department',
        }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_RECORD_SOURCE' } });
    },
  );
});
