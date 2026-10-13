import { Prisma } from '../../generated/prisma/client';
import {
  caseListDisplay,
  CaseListDisplayRecord,
} from './case-list-display-read';
function fixture(): CaseListDisplayRecord {
  return {
    id: 'case',
    departmentId: 'department',
    customerId: 'customer',
    rightsHolderId: 'holder',
    sourceLeadId: 'lead',
    sourceNotaryMatterId: 'matter',
    customer: { id: 'customer', departmentId: 'department', name: '客户' },
    rightsHolder: {
      id: 'holder',
      departmentId: 'department',
      name: '权利主体',
    },
    sourceLead: {
      id: 'lead',
      departmentId: 'department',
      customerId: 'customer',
      rightsHolderId: 'holder',
      platform: 'TMALL',
      shopName: '真实店铺',
      shopExternalId: null,
    },
    sourceNotaryMatter: {
      id: 'matter',
      departmentId: 'department',
      customerId: 'customer',
      rightsHolderId: 'holder',
      sourceLeadId: 'lead',
    },
    defendants: [
      { id: 'defendant-1', name: '被告一' },
      { id: 'defendant-2', name: '被告二' },
    ],
    lawyers: [
      { lawyer: { id: 'lawyer-1', fullName: '律师一' } },
      { lawyer: { id: 'lawyer-2', fullName: '律师二' } },
    ],
    filingSubmission: null,
    courtCaseNo: null,
    complaintSubmittedAt: null,
    complaintAmountState: null,
    complaintAmount: null,
    complaintConfirmation: null,
    currentTrialRoundId: 'round',
    currentJudgmentNextStepId: 'choice',
    currentJudgment: null,
    currentSecondInstanceResult: null,
    closure: null,
  };
}
describe('authorized case list display', () => {
  it('preserves plural parties and unknown sources without inventing money or court numbers', () => {
    const result = caseListDisplay(fixture());
    expect(result.defendants).toHaveLength(2);
    expect(result.lawyers).toHaveLength(2);
    expect(result.courtCaseNo).toBeNull();
    expect(result.closureAmount).toEqual({
      state: 'UNRECORDED',
      amount: null,
      sourceType: null,
      sourceId: null,
    });
    expect(result).not.toHaveProperty('receivedAmount');
  });
  it('uses confirmation before submission, keeps true zero, pending source and exact current closure', () => {
    const record = fixture();
    record.complaintSubmittedAt = new Date();
    record.complaintAmountState = 'KNOWN';
    record.complaintAmount = new Prisma.Decimal('999');
    record.complaintConfirmation = {
      id: 'confirmation',
      amountState: 'PENDING',
      amount: null,
    };
    record.closure = {
      currentVersion: {
        id: 'current-closure',
        closeAmountState: 'KNOWN',
        closeAmt: new Prisma.Decimal('0'),
      },
    };
    expect(caseListDisplay(record)).toMatchObject({
      claimAmount: {
        state: 'PENDING',
        amount: null,
        sourceType: 'COMPLAINT_CONFIRMATION',
        sourceId: 'confirmation',
      },
      closureAmount: {
        state: 'KNOWN',
        amount: '0.00',
        sourceType: 'CASE_CLOSURE_VERSION',
        sourceId: 'current-closure',
      },
    });
    record.complaintConfirmation = null;
    expect(caseListDisplay(record).claimAmount).toEqual({
      state: 'KNOWN',
      amount: '999.00',
      sourceType: 'COMPLAINT_SUBMISSION',
      sourceId: 'case',
    });
    record.complaintSubmittedAt = null;
    expect(caseListDisplay(record).claimAmount.state).toBe('UNRECORDED');
  });
  it('selects effective CHANGE, preserves AFFIRM, rejects old-round and revoked results and clears REMAND', () => {
    const record = fixture();
    record.currentJudgment = {
      id: 'first',
      trialRoundId: 'round',
      judgmentAmountState: 'KNOWN',
      judgmentAmount: new Prisma.Decimal('123.45'),
    };
    record.currentSecondInstanceResult = {
      id: 'second',
      trialRoundId: 'round',
      choiceId: 'choice',
      result: 'CHANGE',
      judgmentAmountState: 'KNOWN',
      judgmentAmount: new Prisma.Decimal('87.01'),
      revocation: null,
    };
    expect(caseListDisplay(record).judgmentAmount).toMatchObject({
      amount: '87.01',
      sourceType: 'SECOND_INSTANCE_RESULT',
      sourceId: 'second',
    });
    record.currentSecondInstanceResult.result = 'AFFIRM';
    expect(caseListDisplay(record).judgmentAmount.amount).toBe('123.45');
    record.currentSecondInstanceResult.result = 'CHANGE';
    record.currentSecondInstanceResult.revocation = { id: 'revocation' };
    expect(caseListDisplay(record).judgmentAmount.amount).toBe('123.45');
    record.currentSecondInstanceResult.revocation = null;
    record.currentSecondInstanceResult.trialRoundId = 'old';
    expect(caseListDisplay(record).judgmentAmount.amount).toBe('123.45');
    record.currentSecondInstanceResult.trialRoundId = 'round';
    record.currentSecondInstanceResult.result = 'REMAND';
    expect(caseListDisplay(record).judgmentAmount.state).toBe('UNRECORDED');
    record.currentTrialRoundId = 'new';
    expect(caseListDisplay(record).judgmentAmount.state).toBe('UNRECORDED');
  });
  it('fails closed on a cross-department or guessed lead source', () => {
    const record = fixture();
    record.sourceLead.departmentId = 'other';
    expect(() => caseListDisplay(record)).toThrow();
    record.sourceLead.departmentId = 'department';
    record.sourceNotaryMatter.sourceLeadId = 'same-shop-other-lead';
    expect(() => caseListDisplay(record)).toThrow();
  });
});
