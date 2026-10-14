import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { CaseDetail } from '../../api/cases';
import CaseWorkspaceFees from './CaseWorkspaceFees.vue';

const baseItem: CaseDetail = {
  id: 'case-1',
  businessNo: 'CA-1',
  stage: 'WAITING_JUDGMENT',
  createdAt: '2026-09-28T00:00:00.000Z',
  version: 7,
  owner: { id: 'user-1', displayName: '负责人' },
  canMatch: false,
  canSubmitComplaint: false,
  canConfirmComplaint: false,
  canMailComplaint: false,
  canMailExecution: false,
  canSubmitExecutionFiling: false,
  canFinishExecution: false,
  canRecordClosure: false,
  canCorrectClosure: false,
  canArchive: false,
  canCorrectArchive: false,
  canSubmitFiling: false,
  canRegisterAcceptance: false,
  canUploadAcceptanceMaterials: false,
  canScheduleHearing: false,
  canCorrectHearing: false,
  canRegisterJudgment: false,
  canCorrectJudgment: false,
  canChooseJudgmentNextStep: false,
  canRevokeJudgmentNextStep: false,
  canSaveSecondInstance: false,
  canRegisterSecondInstanceResult: false,
  canRevokeSecondInstanceResult: false,
  canSubmitExecution: false,
  executionSubmission: { current: null, submissions: [], availableFiles: [] },
  canConfirmExecution: false,
  executionConfirmation: null,
  executionMailing: null,
  executionFiling: null,
  executionFinish: null,
  closure: null,
  archive: null,
  sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
  sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
  courtCaseNo: '（2026）甲0101民初1号',
  department: { id: 'department-1', name: '知产部' },
  customer: { id: 'customer-1', name: '客户甲' },
  rightsHolder: { id: 'holder-1', name: '权利人甲' },
  certificate: {
    certificateNo: 'Z-100',
    certificateDate: '2026-09-28',
    issuedAt: '2026-09-28T00:00:00.000Z',
    needDisclose: false,
    files: [],
    disclosureFiles: [],
  },
  fees: [],
  defendants: [],
  lawyers: [],
  matchedAt: null,
  matchedOn: null,
  complaint: null,
  complaintConfirmation: null,
  complaintMailing: null,
  filingSubmission: null,
  acceptance: null,
  acceptanceMaterials: {
    ACCEPTANCE_NOTICE: { available: [], frozen: [], later: [] },
    PAYMENT_LIST: { available: [], frozen: [], later: [] },
    SERVICE_DOCUMENT: { available: [], frozen: [], later: [] },
  },
  hearing: {
    currentArrangement: null,
    currentAdvance: null,
    arrangements: [],
    advances: [],
    corrections: [],
  },
  judgment: { current: null, history: [], availableFiles: [] },
  judgmentNextStep: { current: null, history: [], revocations: [] },
  acceptances: [],
  secondInstance: {
    currentTrialRoundId: null,
    currentProgress: null,
    currentResult: null,
    rounds: [],
    progresses: [],
    results: [],
    revocations: [],
  },
};

const wrappers: Array<ReturnType<typeof mount>> = [];
function render(item = structuredClone(baseItem)) {
  const wrapper = mount(CaseWorkspaceFees, { props: { item } });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
});
function judgment(): NonNullable<CaseDetail['judgment']['current']> {
  return {
    id: 'judgment-current',
    trialRoundId: 'round',
    kind: 'REGISTER',
    priorFactId: null,
    judgmentReceivedAt: '2026-10-12',
    judgmentAmountState: 'KNOWN',
    judgmentAmount: '100.01',
    paidLitigationFeeState: 'KNOWN',
    paidLitigationFee: '0.00',
    fromVersion: 1,
    toVersion: 2,
    recordedAt: '2026-10-12T00:00:00Z',
    files: [],
  };
}
function closure(): NonNullable<CaseDetail['closure']> {
  const current: NonNullable<CaseDetail['closure']>['current'] = {
    id: 'closure-version',
    kind: 'REGISTER',
    priorVersionId: null,
    finishId: 'finish',
    fromVersion: 2,
    toVersion: 3,
    closeAt: null,
    closeAmountState: 'PENDING',
    closeAmt: null,
    note: '全部结清',
    correctionReason: null,
    recordedAt: '2026-10-13T00:00:00Z',
    recordedByUserId: 'u',
    files: [],
  };
  return { id: 'closure', finishId: 'finish', current, history: [current] };
}
function second(): NonNullable<CaseDetail['secondInstance']['currentResult']> {
  return {
    id: 'second-current',
    trialRoundId: 'round',
    choiceId: 'choice',
    judgmentId: 'judgment',
    progressId: null,
    result: 'CHANGE',
    resultReceivedAt: '2026-10-13',
    judgmentAmountState: 'KNOWN',
    judgmentAmount: '90071992547409.99',
    paidLitigationFeeState: 'PENDING',
    paidLitigationFee: null,
    fromVersion: 3,
    toVersion: 4,
    recordedAt: '2026-10-13T00:00:00Z',
    files: [],
    childTrialRoundId: null,
    revocationId: null,
  };
}

describe('CaseWorkspaceFees', () => {
  it('distinguishes known zero, pending, and missing source fee categories without summing', () => {
    const item = structuredClone(baseItem);
    item.fees = [
      {
        category: 'NOTARY',
        state: 'KNOWN',
        amount: '0.00',
        sourceType: 'NOTARY_CERTIFICATE_FEE',
        sourceId: 'certificate-fee',
      },
      {
        category: 'SAMPLE',
        state: 'PENDING',
        amount: null,
        sourceType: 'NOTARY_MATTER_EVIDENCE',
        sourceId: 'evidence',
      },
      {
        category: 'INVESTIGATION',
        state: 'KNOWN',
        amount: '90071992547409.99',
        sourceType: 'NOTARY_MATTER_EVIDENCE',
        sourceId: 'investigation',
      },
    ];
    const wrapper = render(item);
    const rows = wrapper.findAll('[data-test="source-fee"]');
    expect(rows).toHaveLength(4);
    expect(rows[0]!.text()).toContain('¥ 0.00');
    expect(rows[0]!.text()).toContain('KNOWN');
    expect(rows[0]!.text()).toContain('certificate-fee');
    expect(rows[1]!.text()).toContain('PENDING');
    expect(rows[1]!.text()).not.toContain('¥');
    expect(rows[2]!.text()).toContain('¥ 90071992547409.99');
    expect(rows[3]!.text()).toContain('UNRECORDED');
    expect(rows[3]!.text()).not.toContain('¥ 0');
    expect(wrapper.text()).not.toContain('合计');
  });

  it('keeps individual same-category source facts and never hides missing values as zero', () => {
    const item = structuredClone(baseItem);
    item.fees = ['evidence-a', 'evidence-b'].map((sourceId) => ({
      category: 'SAMPLE',
      state: 'KNOWN',
      amount: '12.00',
      sourceType: 'NOTARY_MATTER_EVIDENCE',
      sourceId,
    }));
    const wrapper = render(item);
    expect(wrapper.findAll('[data-test="source-fee"]')).toHaveLength(5);
    expect(wrapper.text()).toContain('evidence-a');
    expect(wrapper.text()).toContain('evidence-b');
    expect(wrapper.get('[data-test="amount-claim"]').text()).toContain(
      'UNRECORDED',
    );
    expect(wrapper.get('[data-test="amount-judgment"]').text()).toContain(
      'UNRECORDED',
    );
    expect(wrapper.get('[data-test="amount-closure"]').text()).toContain(
      'UNRECORDED',
    );
    expect(wrapper.text()).not.toContain('¥ 0.00');
  });

  it('uses confirmed claim over submitted claim and displays each current monetary fact with its own source', async () => {
    const item = structuredClone(baseItem);
    item.complaint = {
      amountState: 'KNOWN',
      amount: '500.00',
      pendingReason: null,
      submittedAt: '2026-10-10T00:00:00Z',
      submittedByUserId: 'u',
      complaintFiles: [],
      authorizationFiles: [],
    };
    item.complaintConfirmation = {
      confirmedComplaintContentVersionId: 'confirmed-version',
      amountState: 'PENDING',
      amount: null,
      pendingReason: '待确认',
      changeNote: null,
      confirmDisclose: false,
      confirmedAt: '2026-10-11T00:00:00Z',
      confirmedByUserId: 'u',
      complaintFile: null,
    };
    item.judgment.current = judgment();
    item.secondInstance.currentResult = second();
    item.closure = closure();
    const wrapper = render(item);
    expect(wrapper.get('[data-test="amount-claim"]').text()).toContain(
      'PENDING',
    );
    expect(wrapper.get('[data-test="amount-claim"]').text()).toContain(
      'confirmed-version',
    );
    expect(wrapper.get('[data-test="amount-claim"]').text()).not.toContain(
      '500.00',
    );
    expect(wrapper.get('[data-test="amount-judgment"]').text()).toContain(
      '¥ 100.01',
    );
    expect(wrapper.get('[data-test="amount-judgment"]').text()).toContain(
      'judgment-current',
    );
    expect(wrapper.get('[data-test="amount-judgment-fee"]').text()).toContain(
      '¥ 0.00',
    );
    expect(wrapper.get('[data-test="amount-second"]').text()).toContain(
      '¥ 90071992547409.99',
    );
    expect(wrapper.get('[data-test="amount-second-fee"]').text()).toContain(
      'PENDING',
    );
    expect(wrapper.get('[data-test="amount-closure"]').text()).toContain(
      'closure-version',
    );
    expect(wrapper.get('[data-test="amount-closure"]').text()).toContain(
      'PENDING',
    );
    item.complaintConfirmation = null;
    item.closure.current.closeAmountState = 'KNOWN';
    item.closure.current.closeAmt = '0.00';
    await wrapper.setProps({ item: structuredClone(item) });
    expect(wrapper.get('[data-test="amount-claim"]').text()).toContain(
      '¥ 500.00',
    );
    expect(wrapper.get('[data-test="amount-closure"]').text()).toContain(
      '¥ 0.00',
    );
  });

  it('does not promote historical or revoked amounts into current facts and handles remand without invented compensation', async () => {
    const item = structuredClone(baseItem);
    item.judgment.history = [judgment()];
    item.secondInstance.results = [{ ...second(), revocationId: 'revocation' }];
    const wrapper = render(item);
    expect(wrapper.get('[data-test="amount-judgment"]').text()).toContain(
      'UNRECORDED',
    );
    expect(wrapper.get('[data-test="amount-second"]').text()).toContain(
      'UNRECORDED',
    );
    expect(wrapper.text()).not.toContain('100.01');
    expect(wrapper.text()).not.toContain('90071992547409.99');
    item.secondInstance.currentResult = {
      ...second(),
      result: 'REMAND',
      judgmentAmountState: null,
      judgmentAmount: null,
    };
    await wrapper.setProps({ item: structuredClone(item) });
    expect(wrapper.get('[data-test="amount-second"]').text()).toContain(
      'UNRECORDED',
    );
    expect(wrapper.get('[data-test="amount-second"]').text()).toContain(
      '发回重审',
    );
    expect(wrapper.get('[data-test="amount-second"]').text()).not.toContain(
      '¥',
    );
  });

  it('never derives received money or settlement status from closure notes or archive type and has no writes', () => {
    const item = structuredClone(baseItem);
    item.stage = 'ARCHIVED';
    item.closure = closure();
    item.archive = {
      id: 'archive',
      closureId: 'closure',
      closureVersionId: 'closure-version',
      history: [],
      current: {
        id: 'archive-version',
        kind: 'ARCHIVE',
        priorVersionId: null,
        closureVersionId: 'closure-version',
        fromVersion: 3,
        toVersion: 4,
        archiveAt: '2026-10-14',
        archiveType: 'EXECUTION_COLLECTED',
        archiveReason: '全部结清',
        correctionReason: null,
        recordedAt: '2026-10-14T00:00:00Z',
        recordedByUserId: 'u',
      },
    };
    const wrapper = render(item);
    expect(wrapper.get('[data-test="case-payments"]').text()).toContain(
      '尚未登记案件收付明细',
    );
    expect(wrapper.text()).not.toContain('全部结清');
    expect(wrapper.text()).not.toContain('EXECUTION_COLLECTED');
    expect(wrapper.find('button, input, form').exists()).toBe(false);
    expect(wrapper.emitted()).toEqual({});
  });

  it('updates all facts on case replacement without retaining previous fees', async () => {
    const item = structuredClone(baseItem);
    item.fees = [
      {
        category: 'SAMPLE',
        state: 'KNOWN',
        amount: '123.45',
        sourceType: 'NOTARY_MATTER_EVIDENCE',
        sourceId: 'old-private-source',
      },
    ];
    const wrapper = render(item);
    await wrapper.setProps({ item: { ...baseItem, id: 'case-2' } });
    expect(wrapper.text()).not.toContain('123.45');
    expect(wrapper.text()).not.toContain('old-private-source');
    expect(wrapper.text()).toContain('UNRECORDED');
  });
});
