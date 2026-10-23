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
    certificateId: 'certificate',
    externalEntry: null,
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
    acceptance: null,
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
  it('reads effective amounts with exact correction sources while preserving the frozen original', () => {
    const record = fixture();
    record.currentJudgment = {
      id: 'judgment',
      trialRoundId: 'round',
      judgmentAmountState: 'KNOWN',
      judgmentAmount: new Prisma.Decimal('123'),
      recordCorrections: [
        {
          id: 'judgment-edit',
          judgmentAmountState: 'KNOWN',
          judgmentAmount: new Prisma.Decimal('100'),
        },
      ],
    };
    record.closure = {
      currentVersion: {
        id: 'closure-version',
        closeAmountState: 'KNOWN',
        closeAmt: new Prisma.Decimal('80'),
      },
      recordCorrections: [
        {
          id: 'closure-edit',
          sourceClosureVersionId: 'closure-version',
          closeAmountState: 'PENDING',
          closeAmt: null,
        },
      ],
    };
    expect(caseListDisplay(record)).toMatchObject({
      judgmentAmount: {
        amount: '100.00',
        sourceType: 'FIRST_INSTANCE_JUDGMENT_RECORD_CORRECTION',
        sourceId: 'judgment-edit',
      },
      closureAmount: {
        state: 'PENDING',
        amount: null,
        sourceType: 'CASE_CLOSURE_RECORD_CORRECTION',
        sourceId: 'closure-edit',
      },
    });
    expect(record.currentJudgment.judgmentAmount?.toString()).toBe('123');
    expect(record.closure.currentVersion?.closeAmt?.toString()).toBe('80');
    record.currentSecondInstanceResult = {
      id: 'second',
      trialRoundId: 'round',
      choiceId: 'choice',
      result: 'AFFIRM',
      judgmentAmountState: 'KNOWN',
      judgmentAmount: new Prisma.Decimal('123'),
      revocation: null,
    };
    expect(caseListDisplay(record).judgmentAmount).toMatchObject({
      amount: '100.00',
      sourceType: 'FIRST_INSTANCE_JUDGMENT_RECORD_CORRECTION',
      sourceId: 'judgment-edit',
    });
    expect(record.currentSecondInstanceResult.judgmentAmount?.toString()).toBe(
      '123',
    );
  });
  it('rejects a correction attached to a different frozen closure version', () => {
    const record = fixture();
    record.closure = {
      currentVersion: {
        id: 'current',
        closeAmountState: 'PENDING',
        closeAmt: null,
      },
      recordCorrections: [
        {
          id: 'edit',
          sourceClosureVersionId: 'other-version',
          closeAmountState: 'KNOWN',
          closeAmt: new Prisma.Decimal('0'),
        },
      ],
    };
    expect(() => caseListDisplay(record)).toThrow('结案资料更正来源不一致');
  });
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
      recordCorrections: [],
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
      recordCorrections: [],
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
    record.sourceLead!.departmentId = 'other';
    expect(() => caseListDisplay(record)).toThrow();
    record.sourceLead!.departmentId = 'department';
    record.sourceNotaryMatter!.sourceLeadId = 'same-shop-other-lead';
    expect(() => caseListDisplay(record)).toThrow();
  });
  it('shows actual direct acceptance court and direct AFFIRM amount without inventing prior facts', () => {
    const record = fixture();
    record.sourceLeadId = null;
    record.sourceNotaryMatterId = null;
    record.certificateId = null;
    record.sourceLead = null;
    record.sourceNotaryMatter = null;
    record.externalEntry = {
      id: 'entry',
      caseId: record.id,
      departmentId: record.departmentId,
      initialStage: 'SECOND_INSTANCE',
      known: { courtId: 'known-court' },
    };
    record.currentJudgmentNextStepId = null;
    record.currentSecondInstanceResult = {
      id: 'real-second',
      trialRoundId: 'round',
      choiceId: null,
      result: 'AFFIRM',
      judgmentAmountState: 'KNOWN',
      judgmentAmount: new Prisma.Decimal('0'),
      revocation: null,
    };
    expect(caseListDisplay(record)).toMatchObject({
      court: null,
      judgmentAmount: {
        state: 'KNOWN',
        amount: '0.00',
        sourceType: 'SECOND_INSTANCE_RESULT',
        sourceId: 'real-second',
      },
    });
    record.acceptance = { court: { id: 'actual-court', name: '真实受理法院' } };
    record.filingSubmission = {
      courtId: 'submitted-court',
      courtName: '立案提交快照法院',
    };
    expect(caseListDisplay(record).court).toEqual({
      id: 'actual-court',
      name: '真实受理法院',
    });
    record.acceptance = { court: null };
    expect(
      caseListDisplay(record, { id: 'known-court', name: '原审已知法院' })
        .court,
    ).toEqual({ id: 'submitted-court', name: '立案提交快照法院' });
    record.filingSubmission = null;
    record.acceptance = null;
    expect(
      caseListDisplay(record, { id: 'known-court', name: '原审已知法院' })
        .court,
    ).toEqual({ id: 'known-court', name: '原审已知法院' });
    expect(
      caseListDisplay(record, { id: 'other-court', name: '不匹配法院' }).court,
    ).toBeNull();
    record.currentSecondInstanceResult.judgmentAmountState = 'PENDING';
    record.currentSecondInstanceResult.judgmentAmount = null;
    expect(caseListDisplay(record).judgmentAmount).toMatchObject({
      state: 'PENDING',
      amount: null,
    });
    record.externalEntry.initialStage = 'WAITING_EXECUTION_DOCUMENTS';
    expect(caseListDisplay(record).judgmentAmount.state).toBe('UNRECORDED');
  });
});
