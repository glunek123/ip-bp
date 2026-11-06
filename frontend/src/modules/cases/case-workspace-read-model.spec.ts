import { describe, expect, it } from 'vitest';
import type { CaseDetail, CaseFile } from '../../api/cases';
import type { LeadDetail } from '../../api/leads';
import type { CaseSupplementWorkspace } from '../../api/case-supplements';
import type { CaseClosureWorkspace } from '../../api/case-closure-workspace';
import type { CaseSettlement } from '../../api/settlements';
import type { RefundRow, RefundWorkspace } from '../../api/litigation-refunds';
import type { OwnerMaterial } from '../../api/materials';
import {
  buildCaseWorkspaceEvents,
  buildCaseWorkspaceSections,
  workspaceDate,
} from './case-workspace-read-model';

function caseFixture(): CaseDetail {
  return {
    id: 'case-1',
    businessNo: 'CA-1',
    stage: 'PENDING_MATCH',
    version: 1,
    createdAt: '2026-10-01T00:00:00Z',
    owner: { id: 'owner-1', displayName: '负责人甲' },
    department: { id: 'department-1', name: '部门甲' },
    customer: { id: 'customer-1', name: '客户甲' },
    rightsHolder: { id: 'holder-1', name: '权利人甲' },
    sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
    sourceNotaryMatter: { id: 'notary-1', businessNo: 'NZ-1' },
    canMatch: false,
    canSubmitComplaint: false,
    canConfirmComplaint: false,
    canMailComplaint: false,
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
    canConfirmExecution: false,
    canMailExecution: false,
    canSubmitExecutionFiling: false,
    canFinishExecution: false,
    canRecordClosure: false,
    canCorrectClosure: false,
    canArchive: false,
    canCorrectArchive: false,
    courtCaseNo: null,
    matchedAt: null,
    matchedOn: null,
    defendants: [],
    lawyers: [],
    fees: [],
    certificate: {
      certificateNo: 'Z-1',
      certificateDate: '2026-10-01',
      issuedAt: '2026-10-01T00:00:00Z',
      needDisclose: false,
      files: [],
      disclosureFiles: [],
    },
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
    executionSubmission: { current: null, submissions: [], availableFiles: [] },
    executionConfirmation: null,
    executionMailing: null,
    executionFiling: null,
    executionFinish: null,
    closure: null,
    archive: null,
  };
}
function leadFixture(): LeadDetail {
  return {
    id: 'lead-1',
    businessNo: 'LD-1',
    departmentId: 'department-1',
    customerId: 'customer-1',
    rightsHolderId: 'holder-1',
    responsibleUserId: 'owner-1',
    teamId: null,
    status: 'TRANSFERRED_TO_NOTARY',
    caseType: 'CIVIL',
    infringementTypes: ['TRADEMARK'],
    source: 'ONLINE',
    platform: 'TAOBAO',
    foundAt: '2026-09-01',
    shopName: '真实店铺',
    shopExternalId: null,
    needDisclose: false,
    remark: null,
    creationChannel: 'INTERNAL',
    externalSourceRef: null,
    products: [],
    leadScreenshotContentVersionIds: [],
    version: 3,
    pushedAt: null,
    pushedByUserId: null,
    pushedByDisplayName: null,
    reviewDecision: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    displayNames: {
      customerName: '客户甲',
      rightsHolderName: '权利人甲',
      responsibleUserName: '负责人甲',
    },
    capabilities: {
      edit: false,
      push: false,
      withdrawApply: false,
      evidenceDecide: false,
      transferToNotary: false,
      createEvidenceBatch: false,
    },
    evidenceDecision: null,
    pendingWithdrawalApplication: null,
    history: [],
    notaryMatters: [],
  };
}
const file: CaseFile = {
  materialId: 'material-1',
  contentVersionId: 'exact-version-1',
  originalFilename: '真实文件.pdf',
  mimeType: 'application/pdf',
};
const recordedAt = '2026-10-02T00:00:00Z';

describe('case workspace read model', () => {
  it('shows only the lead referenced screenshot version with an exact download target', () => {
    const lead = leadFixture();
    lead.leadScreenshotContentVersionIds = ['v1'];
    const material: OwnerMaterial = {
      id: 'm1',
      ownerType: 'LEAD',
      ownerId: 'lead-1',
      category: 'LEAD_SCREENSHOT',
      purpose: 'LEAD_SCREENSHOT',
      currentVersionId: 'v2',
      status: 'ACTIVE',
      version: 2,
      deletedAt: null,
      createdAt: recordedAt,
      updatedAt: recordedAt,
      contentVersions: ['v1', 'v2'].map((id) => ({
        id,
        materialId: 'm1',
        originalFilename: `${id}.png`,
        mimeType: 'image/png',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
        status: 'AVAILABLE' as const,
        createdAt: recordedAt,
      })),
    };
    const summary = buildCaseWorkspaceSections(
      caseFixture(),
      lead,
      'ready',
      undefined,
      undefined,
      undefined,
      'idle',
      'idle',
      undefined,
      'idle',
      [material],
      undefined,
      'ready',
    ).find((entry) => entry.key === 'lead-info')!.summary;
    const screenshot = summary.find((field) => field.label === '侵权截图');
    expect(screenshot?.value).toBe('v1.png');
    expect(screenshot?.fileVersions).toEqual([
      { materialId: 'm1', contentVersionId: 'v1', filename: 'v1.png' },
    ]);
  });
  it('counts effective payment facts and keeps unknown company receipts distinct from zero', () => {
    const workspace: CaseClosureWorkspace = {
      readPurpose: 'DISPLAY_ONLY',
      caseId: 'case-1',
      caseVersion: 1,
      stage: 'WAITING_ARCHIVE',
      actualRegistrationLawyers: [],
      closure: {
        versionId: null,
        closeOn: null,
        amountState: 'UNKNOWN',
        amount: null,
        paymentType: 'INSTALLMENTS',
      },
      effectivePayments: [
        {
          versionId: 'v1',
          paymentId: 'p1',
          revision: 1,
          paidOn: '2026-10-01',
          amount: '120.00',
          payer: '甲',
          payee: '乙',
          documents: [],
        },
        {
          versionId: 'v2',
          paymentId: 'p2',
          revision: 1,
          paidOn: '2026-10-02',
          amount: '80.00',
          payer: '甲',
          payee: '乙',
          documents: [],
        },
      ],
      documents: [],
      refund: {
        versionId: null,
        revision: null,
        declaration: 'UNKNOWN',
        items: [],
      },
      assessment: {
        versionId: null,
        revision: null,
        closureVersionId: null,
        termsVersion: null,
        declaration: 'UNKNOWN',
        matchesCurrent: null,
        customerAmount: null,
        lawyerAmount: null,
      },
      actual: {
        connection: 'NOT_CONNECTED',
        scope: null,
        customerReceiptState: 'UNKNOWN',
        customerReceivedAmount: null,
        lawyerInvoiceState: 'UNKNOWN',
        lawyerInvoicedAmount: null,
      },
    };
    const summary = buildCaseWorkspaceSections(
      caseFixture(),
      null,
      'idle',
      undefined,
      workspace,
      undefined,
      'ready',
    ).find((entry) => entry.key === 'closure-info')!.summary;
    expect(
      summary.find((field) => field.label === '有效付款记录数')?.value,
    ).toBe('2');
    expect(summary.find((field) => field.label === '有效付款合计')?.value).toBe(
      '200.00 元',
    );
    expect(
      summary.find((field) => field.label === '已回款（公司登记）')?.value,
    ).toBe('待核实／未登记');
    workspace.effectivePayments[0]!.amount = '99999999999999.99';
    workspace.effectivePayments[1]!.amount = '0.01';
    const large = buildCaseWorkspaceSections(
      caseFixture(),
      null,
      'idle',
      undefined,
      workspace,
      undefined,
      'ready',
    ).find((entry) => entry.key === 'closure-info')!.summary;
    expect(large.find((field) => field.label === '有效付款合计')?.value).toBe(
      '100000000000000.00 元',
    );
  });
  it('separates refund inventory, company-received marks, converted costs and unattributed history', () => {
    const item = caseFixture();
    item.judgment.current = {
      id: 'judgment-1',
      trialRoundId: 'round-1',
      kind: 'REGISTER',
      priorFactId: null,
      judgmentReceivedAt: '2026-10-01',
      judgmentAmountState: 'KNOWN',
      judgmentAmount: '100.00',
      paidLitigationFeeState: 'PENDING',
      paidLitigationFee: null,
      fromVersion: 1,
      toVersion: 2,
      recordedAt,
      files: [],
    };
    const refundItems: CaseClosureWorkspace['refund']['items'] = [
      {
        itemId: 'received',
        party: 'COURT',
        status: 'RECEIVED',
        description: '法院退费',
        amount: '10.00',
      },
      {
        itemId: 'settled',
        party: 'COURT',
        status: 'SETTLED',
        description: '已结算未收',
        amount: '20.00',
      },
      {
        itemId: 'cost',
        party: 'DEFENDANT',
        status: 'CONVERTED_TO_COST',
        description: '抵成本',
        amount: '5.00',
      },
      {
        itemId: 'legacy',
        party: 'COURT',
        status: 'PENDING',
        description: '旧项未归属',
        amount: null,
      },
    ];
    const closure: CaseClosureWorkspace = {
      readPurpose: 'DISPLAY_ONLY',
      caseId: 'case-1',
      caseVersion: 1,
      stage: 'WAITING_ARCHIVE',
      actualRegistrationLawyers: [],
      closure: {
        versionId: null,
        closeOn: null,
        amountState: 'UNKNOWN',
        amount: null,
        paymentType: 'UNKNOWN',
      },
      effectivePayments: [],
      documents: [],
      refund: {
        versionId: 'refund-v1',
        revision: 1,
        declaration: 'COMPLETE',
        items: refundItems,
      },
      assessment: {
        versionId: null,
        revision: null,
        closureVersionId: null,
        termsVersion: null,
        declaration: 'UNKNOWN',
        matchesCurrent: null,
        customerAmount: null,
        lawyerAmount: null,
      },
      actual: {
        connection: 'CONNECTED',
        scope: 'CONSOLIDATION',
        customerReceiptState: 'RECORDED',
        customerReceivedAmount: '9.00',
        lawyerInvoiceState: 'UNKNOWN',
        lawyerInvoicedAmount: null,
      },
    };
    const link = (
      inventoryItemId: string,
    ): CaseSupplementWorkspace['entries'][number] => ({
      id: `link-${inventoryItemId}`,
      priorEntryId: null,
      kind: 'REFUND_SOURCE_LINK',
      trialRoundId: null,
      amount: null,
      text: null,
      eventDate: null,
      courtCaseNo: null,
      sourceType: 'JUDGMENT',
      sourceId: 'judgment-1',
      inventoryVersionId: 'refund-v1',
      inventoryItemId,
      materialId: null,
      contentVersionId: null,
      reason: '核对归属',
      recordedByUserId: 'u1',
      recordedAt,
    });
    const supplements: CaseSupplementWorkspace = {
      canEdit: true,
      entries: [link('received'), link('settled'), link('cost')],
      recorders: [],
      sources: {
        executionFiling: null,
        trialRounds: [],
        judgments: [],
        secondResults: [],
        refundItems: [],
        materials: [],
      },
    };
    const summary = buildCaseWorkspaceSections(
      item,
      null,
      'idle',
      undefined,
      closure,
      supplements,
      'ready',
      'ready',
    ).find((section) => section.key === 'judgment')!.summary;
    const value = (label: string) =>
      summary.find((field) => field.label === label)?.value;
    expect(value('一审／应退清单金额')).toBe('35.00 元');
    expect(value('一审／已标记公司收到（清单状态）金额')).toBe('10.00 元');
    expect(value('一审／已标记公司收到（清单状态）笔数')).toBe('1');
    expect(value('一审／转作成本')).toBe('5.00 元');
    expect(value('一审／退费清单明细')).toContain('客户已收公司未收／20.00 元');
    expect(value('历史审级未标明／清单金额')).toBe(
      '已知小计 0.00 元；1 笔金额待定',
    );
    expect(value('历史审级未标明／清单明细')).toContain('旧项未归属');
    const closureSummary = buildCaseWorkspaceSections(
      item,
      null,
      'idle',
      undefined,
      closure,
      supplements,
      'ready',
      'ready',
    ).find((section) => section.key === 'closure-info')!.summary;
    expect(
      closureSummary.find((field) => field.label === '已回款（公司登记）')
        ?.value,
    ).toBe('9.00 元（主案来源分配范围）');
    expect(
      closureSummary.find((field) => field.label === '结算状态')?.value,
    ).toBe('结算评估状态待核；发起及实际收付分别核对');
    const settlementStatus = () =>
      buildCaseWorkspaceSections(
        item,
        null,
        'idle',
        undefined,
        closure,
        supplements,
        'ready',
        'ready',
      )
        .find((section) => section.key === 'closure-info')!
        .summary.find((field) => field.label === '结算状态')?.value;
    closure.assessment.declaration = 'NOT_APPLICABLE';
    closure.assessment.matchesCurrent = false;
    expect(settlementStatus()).toBe(
      '结算评估与当前结案版本不一致（原声明：不适用）；发起及实际收付分别核对',
    );
    closure.assessment.declaration = 'UNKNOWN';
    expect(settlementStatus()).toBe(
      '结算评估与当前结案版本不一致（原声明：状态待核）；发起及实际收付分别核对',
    );
  });
  it('uses exact current server rows, preserves corrected judgment source chains, and marks invalid sources', () => {
    const item = caseFixture();
    const registered = {
      id: 'judgment-registered',
      trialRoundId: 'round-1',
      kind: 'REGISTER' as const,
      priorFactId: null,
      judgmentReceivedAt: '2026-10-01',
      judgmentAmountState: 'KNOWN' as const,
      judgmentAmount: '100.00',
      paidLitigationFeeState: 'PENDING' as const,
      paidLitigationFee: null,
      fromVersion: 1,
      toVersion: 2,
      recordedAt,
      files: [],
    };
    item.judgment.history = [registered];
    item.judgment.current = {
      ...registered,
      id: 'judgment-corrected',
      kind: 'CORRECT',
      priorFactId: registered.id,
      fromVersion: 2,
      toVersion: 3,
      reason: '更正判决数据',
    };
    const refundItems: CaseClosureWorkspace['refund']['items'] = [
      {
        itemId: 'refund-1',
        party: 'COURT',
        status: 'PENDING',
        description: '一审诉讼费退费',
        amount: '100.00',
      },
    ];
    const closure: CaseClosureWorkspace = {
      readPurpose: 'DISPLAY_ONLY',
      caseId: 'case-1',
      caseVersion: 1,
      stage: 'PENDING_MATCH',
      actualRegistrationLawyers: [],
      closure: {
        versionId: null,
        closeOn: null,
        amountState: 'UNKNOWN',
        amount: null,
        paymentType: 'UNKNOWN',
      },
      effectivePayments: [],
      documents: [],
      refund: {
        versionId: 'inventory-current',
        revision: 2,
        declaration: 'COMPLETE',
        items: refundItems,
      },
      assessment: {
        versionId: null,
        revision: null,
        closureVersionId: null,
        termsVersion: null,
        declaration: 'UNKNOWN',
        matchesCurrent: null,
        customerAmount: null,
        lawyerAmount: null,
      },
      actual: {
        connection: 'NOT_CONNECTED',
        scope: null,
        customerReceiptState: 'UNKNOWN',
        customerReceivedAmount: null,
        lawyerInvoiceState: 'UNKNOWN',
        lawyerInvoicedAmount: null,
      },
    };
    const staleLink: CaseSupplementWorkspace['entries'][number] = {
      id: 'stale-link',
      priorEntryId: null,
      kind: 'REFUND_SOURCE_LINK',
      trialRoundId: null,
      amount: null,
      text: null,
      eventDate: null,
      courtCaseNo: null,
      sourceType: 'JUDGMENT',
      sourceId: registered.id,
      inventoryVersionId: 'inventory-previous',
      inventoryItemId: 'refund-1',
      materialId: null,
      contentVersionId: null,
      reason: '原版本来源关联',
      recordedByUserId: 'operator-1',
      recordedAt,
    };
    const supplements: CaseSupplementWorkspace = {
      canEdit: false,
      entries: [staleLink],
      recorders: [],
      sources: {
        executionFiling: null,
        trialRounds: [],
        judgments: [],
        secondResults: [],
        refundItems: [],
        materials: [],
      },
    };
    const serverRow: RefundRow = {
      caseId: 'case-1',
      itemId: 'refund-1',
      inventoryVersionId: 'inventory-current',
      caseNo: '（2026）知民初1号',
      plaintiff: '原告',
      defendant: '被告',
      courtNo: null,
      lawyer: null,
      party: 'COURT',
      amount: '100.00',
      status: 'PENDING',
      description: '一审诉讼费退费',
      remark: null,
      archived: false,
      archiveStatus: null,
      canFollow: false,
      canRecord: true,
      source: {
        type: 'JUDGMENT',
        id: registered.id,
        trialRoundId: 'round-1',
        label: '一审原登记判决',
        valid: true,
      },
    };
    const serverWorkspace: RefundWorkspace = {
      caseId: 'case-1',
      inventoryVersionId: 'inventory-current',
      canRecord: true,
      canFollow: false,
      sources: [],
      items: [serverRow],
    };
    const sections = (projection: RefundWorkspace | null) =>
      buildCaseWorkspaceSections(
        item,
        null,
        'idle',
        undefined,
        closure,
        supplements,
        'failed',
        'ready',
        undefined,
        'idle',
        undefined,
        undefined,
        'idle',
        'idle',
        undefined,
        'idle',
        projection,
      ).find((section) => section.key === 'judgment')!.summary;
    const value = (fields: ReturnType<typeof sections>, label: string) =>
      fields.find((field) => field.label === label)?.value;

    const current = sections(serverWorkspace);
    expect(value(current, '一审／应退清单金额')).toBe('100.00 元');
    expect(value(current, '一审／应退清单笔数')).toBe('1');
    expect(value(current, '一审／退费清单明细')).toContain(
      '来源：一审原登记判决',
    );

    const invalid = sections({
      ...serverWorkspace,
      items: [{ ...serverRow, source: { ...serverRow.source!, valid: false } }],
    });
    expect(value(invalid, '一审／应退清单金额')).toBe('未关联');
    expect(value(invalid, '历史审级未标明／清单明细')).toContain(
      '来源已失效：一审原登记判决',
    );

    const wrongRound = sections({
      ...serverWorkspace,
      items: [
        {
          ...serverRow,
          source: { ...serverRow.source!, trialRoundId: 'round-2' },
        },
      ],
    });
    expect(value(wrongRound, '一审／应退清单笔数')).toBe('0');
    expect(value(wrongRound, '历史审级未标明／清单明细')).toContain(
      '来源：一审原登记判决',
    );

    const wrongCase = sections({
      ...serverWorkspace,
      caseId: 'case-2',
      items: [{ ...serverRow, caseId: 'case-2' }],
    });
    expect(value(wrongCase, '一审／应退清单笔数')).toBe('0');
    expect(value(wrongCase, '历史审级未标明／清单金额')).toBe('100.00 元');
  });
  it('shows authorized settlement mode and launch facts without asserting payment or closeout', () => {
    const settlement: CaseSettlement = {
      caseId: 'case-1',
      businessNo: 'CA-1',
      stage: 'WAITING_ARCHIVE',
      customer: { id: 'customer-1', name: '客户甲' },
      lawyers: [],
      termsVersion: 2,
      terms: {
        customerFormula: '结案金额 × 70%',
        lawyerMode: 'HALF_RISK',
        lawyerBaseFee: '100.00',
        lawyerSplitPercent: '30',
        customerManualAmount: null,
        lawyerManualAmount: null,
      },
      figures: {
        basis: null,
        customerPercent: null,
        customerAutomaticAmount: null,
        customerAmount: null,
        customerSource: 'AUTOMATIC',
        lawyerAutomaticAmount: null,
        lawyerAmount: null,
        lawyerSource: 'AUTOMATIC',
      },
      customerBalance: {
        launched: '100.00',
        remaining: null,
        overLaunched: false,
      },
      lawyerBalance: { launched: '0.00', remaining: null, overLaunched: false },
      launches: [
        {
          id: 'launch-1',
          caseId: 'case-1',
          side: 'CUSTOMER',
          nth: 1,
          amount: '100.00',
          launchDate: '2026-10-01',
          note: null,
          billId: null,
          customerId: 'customer-1',
          lawyerId: null,
        },
      ],
    };
    const sections = buildCaseWorkspaceSections(
      caseFixture(),
      null,
      'idle',
      undefined,
      undefined,
      undefined,
      'denied',
      'denied',
      undefined,
      'denied',
      undefined,
      undefined,
      'idle',
      'idle',
      settlement,
      'ready',
    );
    const summary = sections.find(
      (section) => section.key === 'closure-info',
    )!.summary;
    const value = (label: string) =>
      summary.find((field) => field.label === label)?.value;
    expect(value('律师结算模式')).toBe('半风险');
    expect(value('客户结算公式')).toBe('结案金额 × 70%');
    expect(value('客户结算发起')).toContain('1 笔发起，合计 100.00 元');
    expect(value('律师结算发起')).toBe('未发起');
    expect(value('结算状态')).toBe('无权读取结案结算来源');
    expect(value('结算状态')).not.toContain('已结清');
    expect(value('律师付款结清')).toBe('未记录（尚无实际付款登记来源）');
    expect(value('律师开票（公司登记）')).toBe('实际开票来源暂不可读取');
    expect(value('退费清单核查')).toBe('退费清单暂不可读取');
  });
  it('uses saved routine null without restoring an old lead shop ID', () => {
    const lead = leadFixture();
    lead.shopExternalId = '旧来源ID';
    const section = buildCaseWorkspaceSections(caseFixture(), lead, 'ready', {
      revision: 2,
      canEdit: true,
      shopName: '案件当前店铺',
      shopExternalId: null,
      remark: null,
      products: [],
    }).find((entry) => entry.key === 'lead-info')!;
    expect(
      section.summary.find((entry) => entry.label === '店铺ID')?.value,
    ).toBe('未登记');
    expect(
      section.summary.find((entry) => entry.label === '店铺名')?.value,
    ).toBe('案件当前店铺');
  });

  it('keeps submitted court, formal court and mediation number separate, and identifies unconfirmed claim', () => {
    const item = caseFixture();
    item.filingSubmission = {
      court: { id: 'court-submitted', name: '提交法院' },
      submittedAt: '2026-10-01',
      recordedAt,
      recordedByUserId: 'u1',
      mediationNo: 'MED-1',
      evidenceFiles: [],
      screenshotFiles: [],
    };
    item.acceptance = {
      id: 'accepted-1',
      trialRoundId: 'round-1',
      acceptedAt: '2026-10-05',
      courtCaseNo: 'CN-1',
      recordedAt,
      court: null,
      files: [],
    };
    item.complaint = {
      amountState: 'KNOWN',
      amount: '100.00',
      pendingReason: null,
      submittedAt: recordedAt,
      submittedByUserId: 'u1',
      complaintFiles: [],
      authorizationFiles: [],
    };
    const summary = buildCaseWorkspaceSections(item, null, 'idle').find(
      (entry) => entry.key === 'first-instance',
    )!.summary;
    expect(summary.find((entry) => entry.label === '立案法院')?.value).toBe(
      '未登记',
    );
    expect(
      summary.find((entry) => entry.label === '诉调号／立案编号')?.value,
    ).toBe('MED-1');
    expect(summary.find((entry) => entry.label === '案号')?.value).toBe('CN-1');
    expect(
      summary.find((entry) => entry.label === '标的额（原诉请，未确认）')
        ?.value,
    ).toBe('100.00 元');
  });

  it('uses the active supplement head and flags multiple current notice candidates', () => {
    const item = caseFixture();
    const entry = (
      id: string,
      priorEntryId: string | null,
      amount: string,
    ): CaseSupplementWorkspace['entries'][number] => ({
      id,
      priorEntryId,
      kind: 'COURT_PREPAYMENT_NOTICE',
      trialRoundId: 'round-1',
      amount,
      text: null,
      eventDate: null,
      courtCaseNo: null,
      sourceType: null,
      sourceId: null,
      inventoryVersionId: null,
      inventoryItemId: null,
      materialId: null,
      contentVersionId: null,
      reason: '补录',
      recordedByUserId: 'u1',
      recordedAt,
    });
    const workspace: CaseSupplementWorkspace = {
      canEdit: true,
      entries: [entry('old', null, '10.00'), entry('new', 'old', '20.00')],
      recorders: [{ id: 'u1', displayName: '操作人甲' }],
      sources: {
        executionFiling: null,
        trialRounds: [
          { id: 'round-1', sequence: 1 },
          { id: 'round-2', sequence: 2 },
        ],
        judgments: [],
        secondResults: [],
        refundItems: [],
        materials: [],
      },
    };
    const summary = () =>
      buildCaseWorkspaceSections(
        item,
        null,
        'idle',
        undefined,
        undefined,
        workspace,
        'idle',
        'ready',
      ).find((section) => section.key === 'first-instance')!.summary;
    expect(
      summary().find((field) => field.label === '预缴诉讼费')?.value,
    ).toContain('20.00');
    expect(
      buildCaseWorkspaceEvents(item, workspace).find(
        (event) => event.id === 'new',
      )?.fields,
    ).toContainEqual(
      expect.objectContaining({ label: '记录人', value: '操作人甲' }),
    );
    workspace.entries.push(entry('parallel', null, '30.00'));
    expect(summary().find((field) => field.label === '预缴诉讼费')?.value).toBe(
      '多份当前补录，需逐条核对',
    );
    workspace.entries = [
      { ...entry('old-round', null, '90.00'), trialRoundId: 'round-2' },
    ];
    expect(summary().find((field) => field.label === '预缴诉讼费')?.value).toBe(
      '未登记',
    );
    item.secondInstance.currentTrialRoundId = 'round-2';
    expect(
      summary().find((field) => field.label === '预缴诉讼费')?.value,
    ).toContain('90.00');
    workspace.entries.push(entry('first-round', null, '50.00'));
    expect(
      summary().find((field) => field.label === '预缴诉讼费')?.value,
    ).toContain('90.00');
  });
  it('keeps exact screenshot versions in technical details and shows an honest reference count', () => {
    const lead = leadFixture();
    lead.leadScreenshotContentVersionIds = [
      'screenshot-version-1',
      'screenshot-version-2',
    ];
    const section = buildCaseWorkspaceSections(
      caseFixture(),
      lead,
      'ready',
    ).find((entry) => entry.key === 'lead-info')!;
    const fields = section.groups.flatMap((group) => group.fields);
    expect(fields).toContainEqual(
      expect.objectContaining({ label: '来源截图', value: '2 个文件版本引用' }),
    );
    expect(fields).toContainEqual(
      expect.objectContaining({
        label: '来源截图版本标识',
        value: 'screenshot-version-1、screenshot-version-2',
        technical: true,
      }),
    );
    expect(
      JSON.stringify(fields.filter((field) => !field.technical)),
    ).not.toContain('screenshot-version-1');
  });
  it.each([
    ['ARCHIVED', '已归档'],
    ['WAITING_ARCHIVE', '待归档'],
    ['EXECUTING', '强制执行中'],
    ['WAITING_EXECUTION_FILING', '待申请执行'],
    ['WAITING_HEARING', '待开庭'],
    ['SECOND_INSTANCE', '二审'],
    ['PENDING_MATCH', '待匹配'],
  ] as const)(
    'uses the real %s stage without inventing current-step facts for missing information',
    (stage, label) => {
      const item = caseFixture();
      item.stage = stage;
      const sections = buildCaseWorkspaceSections(item, null, 'idle');
      expect(sections[0]?.groups[0]?.fields).toContainEqual({
        label: '当前阶段',
        value: label,
      });
      expect(
        sections
          .flatMap((section) => section.groups)
          .map((group) => group.title)
          .join(' '),
      ).not.toContain('（当前）');
      expect(sections[5]?.groups).toEqual([]);
      expect(sections[5]?.message).toBe('尚未登记相关资料');
    },
  );
  it.each(['CHANGE', 'AFFIRM'] as const)(
    'projects a current %s result amount while omitting unreturned audit fields',
    (result) => {
      const item = caseFixture();
      item.secondInstance.currentResult = {
        id: 'result-1',
        trialRoundId: 'round-1',
        choiceId: 'choice-1',
        judgmentId: 'judgment-1',
        progressId: null,
        result,
        resultReceivedAt: '2026-10-01',
        judgmentAmountState: 'KNOWN',
        judgmentAmount: '0.00',
        paidLitigationFeeState: 'PENDING',
        paidLitigationFee: null,
        fromVersion: 1,
        toVersion: 2,
        recordedAt,
        files: [file],
        childTrialRoundId: null,
        revocationId: null,
      };
      item.secondInstance.revocations = [
        {
          id: 'revoke-old',
          resultId: 'old-result',
          fromVersion: 1,
          toVersion: 2,
          recordedAt,
        },
      ];
      const events = buildCaseWorkspaceEvents(item);
      expect(
        events.find((event) => event.source === 'second-result')?.fields,
      ).toContainEqual({ label: '判决金额', value: '0.00 元' });
      expect(
        events
          .find((event) => event.source === 'second-revocation')
          ?.fields.map((field) => field.label),
      ).not.toContain('撤销原因');
      expect(
        events
          .find((event) => event.source === 'second-result')
          ?.fields.map((field) => field.label),
      ).not.toContain('记录人');
      const sections = buildCaseWorkspaceSections(item, null, 'idle');
      expect(JSON.stringify(sections[4])).toContain('二审结果登记');
      expect(JSON.stringify(sections[3])).not.toContain('二审结果登记');
    },
  );
  it('projects eight ordered sections and keeps archived cases readable without stage inference', () => {
    const item = caseFixture();
    item.stage = 'ARCHIVED';
    const sections = buildCaseWorkspaceSections(item, null, 'idle');
    expect(sections.map((value) => value.key)).toEqual([
      'case-info',
      'lead-info',
      'first-instance',
      'second-instance',
      'judgment',
      'execution',
      'closure-info',
      'timeline',
    ]);
    expect(sections[0]?.groups[0]?.fields).toContainEqual({
      label: '法院案号',
      value: '未登记',
    });
    expect(sections[0]?.groups[0]?.fields).toContainEqual({
      label: '实际匹配日期',
      value: '未记录',
    });
    expect(sections[2]?.message).toBe('尚未登记相关资料');
    expect(sections[4]?.groups[0]?.fields).toContainEqual({
      label: '登记状态',
      value: '未登记',
    });
    expect(sections[6]?.groups[0]?.title).toBe('收款与结清状态');
    expect(sections[6]?.message).toBe('结案及归档尚未登记');
    expect(sections[7]?.message).toBeNull();
    expect(buildCaseWorkspaceEvents(item)).toHaveLength(1);
  });

  it('keeps null business dates separate from known recordedAt and formats instants in Shanghai', () => {
    const item = caseFixture();
    item.matchedAt = recordedAt;
    const events = buildCaseWorkspaceEvents(item);
    expect(events.find((value) => value.source === 'match')).toMatchObject({
      businessAt: null,
      recordedAt,
    });
    expect(workspaceDate(null)).toBe('未记录');
    expect(workspaceDate('2026-10-02')).toBe('2026-10-02');
    expect(workspaceDate('2026-10-01T18:00:00Z')).toBe('2026/10/02 02:00:00');
  });

  it('distinguishes lead access states and rejects stale or mismatched source projection', () => {
    const lead = leadFixture();
    for (const state of ['idle', 'loading', 'denied', 'failed'] as const) {
      const section = buildCaseWorkspaceSections(
        caseFixture(),
        lead,
        state,
      )[1]!;
      expect(section.message).not.toBeNull();
      expect(section.groups).toHaveLength(2);
      expect(JSON.stringify(section)).not.toContain('真实店铺');
    }
    expect(
      buildCaseWorkspaceSections(caseFixture(), lead, 'denied')[1]?.message,
    ).toContain('无来源线索读取权限');
    expect(
      buildCaseWorkspaceSections(caseFixture(), lead, 'failed')[1]?.message,
    ).toContain('加载失败');
    lead.id = 'other-lead';
    expect(
      buildCaseWorkspaceSections(caseFixture(), lead, 'ready')[1]?.groups,
    ).toHaveLength(2);
  });

  it('projects actual source fields and zero values, with capability-specific help', () => {
    const lead = leadFixture();
    lead.caseType = 'HEARING_REPRESENTATION';
    lead.infringementTypes = ['TRADEMARK', 'ART_COPYRIGHT', 'INVENTION_PATENT'];
    lead.products = [
      {
        id: 'product-1',
        position: 1,
        title: '合成商品',
        url: null,
        quantity: 0,
        unitPrice: '0.00',
        commentCount: 0,
        estimatedAmount: '0.00',
      },
    ];
    const section = buildCaseWorkspaceSections(
      caseFixture(),
      lead,
      'ready',
    )[1]!;
    expect(section.message).toBeNull();
    expect(section.groups.find((group) => group.id === 'lead')?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '案件类型', value: '代开庭' }),
        expect.objectContaining({
          label: '侵权类型',
          value: '商标权、美术作品著作权、发明专利权',
        }),
        expect.objectContaining({ label: '来源', value: '线上' }),
        expect.objectContaining({ label: '平台', value: '淘宝' }),
      ]),
    );
    expect(
      section.groups.find((group) => group.id === 'product:product-1')?.title,
    ).toBe('商品 1');
    expect(JSON.stringify(section)).toContain('真实店铺');
    expect(JSON.stringify(section)).toContain('0.00 元');
    expect(section.help).toContain('来源线索只读');
    lead.capabilities.edit = true;
    expect(
      buildCaseWorkspaceSections(caseFixture(), lead, 'ready')[1]?.help,
    ).toContain('既有表单');
  });

  it('preserves all first-instance facts, exact files, current deduplication and corrections', () => {
    const item = caseFixture();
    item.complaint = {
      amountState: 'KNOWN',
      amount: '0.00',
      pendingReason: null,
      submittedAt: recordedAt,
      submittedByUserId: 'user-1',
      complaintFiles: [file],
      authorizationFiles: [],
    };
    item.complaintConfirmation = {
      confirmedComplaintContentVersionId: file.contentVersionId,
      amountState: 'PENDING',
      amount: null,
      pendingReason: '待核实',
      changeNote: null,
      confirmDisclose: false,
      confirmedAt: recordedAt,
      confirmedByUserId: 'user-1',
      complaintFile: file,
    };
    item.complaintMailing = {
      mailedAt: '2026-09-30',
      recordedAt,
      recordedByUserId: 'user-1',
      actorType: 'INTERNAL',
      receiptFiles: [file],
    };
    item.filingSubmission = {
      court: { id: 'court-1', name: '法院甲' },
      submittedAt: '2026-10-01',
      recordedAt,
      recordedByUserId: 'user-1',
      mediationNo: null,
      evidenceFiles: [file],
      screenshotFiles: [],
    };
    item.acceptance = {
      id: 'acceptance-1',
      trialRoundId: 'round-1',
      acceptedAt: '2026-10-01',
      courtCaseNo: '真实案号',
      court: null,
      recordedAt,
      files: [{ ...file, category: 'ACCEPTANCE_NOTICE' }],
    };
    item.acceptances = [item.acceptance];
    item.secondInstance.rounds = [
      { id: 'round-1', sequence: 1, sourceResultId: null, revokedAt: null },
    ];
    item.acceptanceMaterials.PAYMENT_LIST.later = [file];
    item.hearing.currentArrangement = {
      id: 'hearing-1',
      trialRoundId: 'round-1',
      hearingAt: null,
      source: 'SCHEDULE',
      recordedAt,
    };
    item.hearing.arrangements = [item.hearing.currentArrangement];
    item.hearing.currentAdvance = {
      id: 'advance-1',
      trialRoundId: 'round-1',
      arrangementId: 'hearing-1',
      dueAt: recordedAt,
      executedAt: recordedAt,
    };
    item.hearing.advances = [item.hearing.currentAdvance];
    item.hearing.corrections = [
      {
        id: 'correction-1',
        priorArrangementId: 'hearing-1',
        priorAdvanceId: 'advance-1',
        newArrangementId: 'hearing-2',
        resultStage: 'WAITING_HEARING',
        recordedAt,
        reason: '真实更正原因',
      },
    ];
    const before = structuredClone(item);
    const events = buildCaseWorkspaceEvents(item);
    expect(
      events.filter((value) => value.source === 'acceptance'),
    ).toHaveLength(1);
    expect(events.filter((value) => value.source === 'hearing')).toHaveLength(
      1,
    );
    expect(
      events.find((value) => value.source === 'complaint')?.fields,
    ).toContainEqual({ label: '诉请金额', value: '0.00 元' });
    expect(
      events.find((value) => value.source === 'complaint-confirmation')?.fields,
    ).toContainEqual({ label: '确认诉请金额', value: '待确认' });
    const section = buildCaseWorkspaceSections(item, null, 'idle')[2]!;
    expect(JSON.stringify(section)).toContain('初次一审');
    expect(JSON.stringify(section)).not.toContain('发回重审');
    item.secondInstance.rounds[0]!.sourceResultId = 'remand-result';
    expect(
      JSON.stringify(buildCaseWorkspaceSections(item, null, 'idle')[2]),
    ).toContain('发回重审第 1 轮');
    item.secondInstance.rounds[0]!.sourceResultId = null;
    expect(JSON.stringify(section)).toContain('exact-version-1');
    expect(JSON.stringify(section)).toContain('缴费清单（后补）');
    expect(JSON.stringify(section)).toContain('真实更正原因');
    expect(item).toEqual(before);
  });

  it('keeps judgment and second-instance current facts, original history and revocations', () => {
    const item = caseFixture();
    item.judgment.current = {
      id: 'judgment-2',
      trialRoundId: 'round-1',
      kind: 'CORRECT',
      priorFactId: 'judgment-1',
      judgmentReceivedAt: '2026-10-01',
      judgmentAmountState: 'KNOWN',
      judgmentAmount: '0.00',
      paidLitigationFeeState: 'PENDING',
      paidLitigationFee: null,
      fromVersion: 2,
      toVersion: 3,
      recordedAt,
      files: [file],
      reason: '金额更正',
    };
    item.judgment.history = [
      {
        ...item.judgment.current,
        id: 'judgment-1',
        kind: 'REGISTER',
        priorFactId: null,
      },
      item.judgment.current,
    ];
    item.judgmentNextStep.current = {
      id: 'choice-1',
      trialRoundId: 'round-1',
      judgmentId: 'judgment-2',
      next: 'APPEAL',
      plaintiffRightsHolderId: null,
      plaintiffName: null,
      defendants: [],
      executionReadinessConfirmed: false,
      fromVersion: 3,
      toVersion: 4,
      recordedAt,
    };
    item.judgmentNextStep.history = [item.judgmentNextStep.current];
    item.judgmentNextStep.revocations = [
      {
        id: 'choice-revocation',
        choiceId: 'choice-old',
        fromVersion: 4,
        toVersion: 5,
        recordedAt,
        reason: '选择撤销原因',
      },
    ];
    item.secondInstance.currentProgress = {
      id: 'progress-1',
      trialRoundId: 'round-1',
      choiceId: 'choice-1',
      priorProgressId: null,
      hearingAt: null,
      hearingPlace: null,
      judgeName: null,
      fromVersion: 5,
      toVersion: 6,
      recordedAt,
      documentFiles: [file],
      serviceFiles: [],
    };
    item.secondInstance.progresses = [item.secondInstance.currentProgress];
    item.secondInstance.results = [
      {
        id: 'result-1',
        trialRoundId: 'round-1',
        choiceId: 'choice-1',
        judgmentId: 'judgment-2',
        progressId: 'progress-1',
        result: 'REMAND',
        resultReceivedAt: '2026-10-01',
        judgmentAmountState: null,
        judgmentAmount: null,
        paidLitigationFeeState: 'KNOWN',
        paidLitigationFee: '0.00',
        fromVersion: 6,
        toVersion: 7,
        recordedAt,
        files: [file],
        childTrialRoundId: 'round-2',
        revocationId: 'revocation-1',
      },
    ];
    item.secondInstance.revocations = [
      {
        id: 'revocation-1',
        resultId: 'result-1',
        fromVersion: 7,
        toVersion: 8,
        recordedAt,
        reason: '结果撤销原因',
      },
    ];
    item.secondInstance.rounds = [
      {
        id: 'round-2',
        sequence: 2,
        sourceResultId: 'result-1',
        revokedAt: recordedAt,
      },
    ];
    const sections = buildCaseWorkspaceSections(item, null, 'idle');
    expect(JSON.stringify(sections[4])).toContain('判决更正');
    expect(JSON.stringify(sections[4])).toContain('判决登记（历史）');
    expect(JSON.stringify(sections[4])).toContain('选择撤销原因');
    expect(JSON.stringify(sections[4])).toContain('不适用（发回重审）');
    expect(JSON.stringify(sections[4])).toContain('已撤销');
    expect(JSON.stringify(sections[4])).toContain('结果撤销原因');
    expect(JSON.stringify(sections[2])).toContain('发回重审第 2 轮');
    expect(JSON.stringify(sections[2])).toContain(
      '尚未返回本轮正式立案或开庭资料',
    );
    expect(JSON.stringify(sections[3])).not.toContain('判决金额');
    expect(
      buildCaseWorkspaceEvents(item).filter(
        (value) => value.source === 'second-progress',
      ),
    ).toHaveLength(1);
  });

  it('assigns acceptance, hearing and judgments to their own first or remand round', () => {
    const item = caseFixture();
    item.secondInstance.rounds = [
      { id: 'round-1', sequence: 1, sourceResultId: null, revokedAt: null },
      {
        id: 'round-2',
        sequence: 2,
        sourceResultId: 'result-1',
        revokedAt: null,
      },
    ];
    const firstAcceptance = {
      id: 'acceptance-1',
      trialRoundId: 'round-1',
      acceptedAt: '2026-01-10',
      courtCaseNo: '初审案号',
      court: null,
      recordedAt,
      files: [{ ...file, category: 'ACCEPTANCE_NOTICE' as const }],
    };
    const remandAcceptance = {
      ...firstAcceptance,
      id: 'acceptance-2',
      trialRoundId: 'round-2',
      acceptedAt: '2026-05-10',
      courtCaseNo: '重审案号',
      court: null,
    };
    item.acceptances = [firstAcceptance, remandAcceptance];
    item.acceptance = remandAcceptance;
    item.hearing.arrangements = [
      {
        id: 'hearing-1',
        trialRoundId: 'round-1',
        hearingAt: '2026-02-10',
        source: 'SCHEDULE',
        recordedAt,
      },
      {
        id: 'hearing-2',
        trialRoundId: 'round-2',
        hearingAt: '2026-06-10',
        source: 'SCHEDULE',
        recordedAt,
      },
    ];
    item.hearing.currentArrangement = item.hearing.arrangements[1]!;
    item.judgment.current = {
      id: 'judgment-2',
      trialRoundId: 'round-2',
      kind: 'REGISTER',
      priorFactId: null,
      judgmentReceivedAt: '2026-07-10',
      judgmentAmountState: 'KNOWN',
      judgmentAmount: '0.00',
      paidLitigationFeeState: 'PENDING',
      paidLitigationFee: null,
      fromVersion: 2,
      toVersion: 3,
      recordedAt,
      files: [file],
    };
    item.judgment.history = [item.judgment.current];
    const sections = buildCaseWorkspaceSections(item, null, 'idle');
    const firstInstance = JSON.stringify(sections[2]);
    const judgment = JSON.stringify(sections[4]);
    expect(firstInstance).toContain('初次一审');
    expect(firstInstance).toContain('正式立案日期');
    expect(firstInstance).toContain('初审案号');
    expect(firstInstance).toContain('开庭日期');
    expect(firstInstance).toContain('发回重审第 2 轮');
    expect(firstInstance).toContain('重审案号');
    expect(firstInstance).toContain('2026-06-10');
    expect(judgment).toContain('发回重审第 2 轮');
    expect(judgment).toContain('2026-07-10');
  });

  it('projects execution, null closure business day, immutable version history and archive without settlement inference', () => {
    const item = caseFixture();
    item.stage = 'ARCHIVED';
    item.executionSubmission.current = {
      id: 'submission-2',
      trialRoundId: 'round-1',
      judgmentNextStepId: 'choice-1',
      secondInstanceResultId: null,
      priorSubmissionId: 'submission-1',
      changeReason: '材料更正',
      fromVersion: 1,
      toVersion: 2,
      submittedAt: recordedAt,
      files: [{ ...file, uploadedAt: recordedAt }],
    };
    item.executionSubmission.submissions = [
      {
        ...item.executionSubmission.current,
        id: 'submission-1',
        priorSubmissionId: null,
        changeReason: null,
      },
      item.executionSubmission.current,
    ];
    item.executionConfirmation = {
      id: 'confirmation-1',
      submissionId: 'submission-2',
      confirmedAt: recordedAt,
      confirmedByUserId: 'user-1',
      files: item.executionSubmission.current.files,
    };
    item.executionMailing = {
      id: 'mailing-1',
      confirmationId: 'confirmation-1',
      mailedAt: '2026-10-01',
      recordedAt,
      files: [file],
    };
    item.executionFiling = {
      id: 'filing-1',
      mailingId: 'mailing-1',
      submittedAt: '2026-10-01',
      recordedAt,
      files: [file],
    };
    item.executionFinish = {
      id: 'finish-1',
      filingId: 'filing-1',
      finishedAt: '2026-10-01',
      reason: '终结执行',
      basisNote: null,
      recordedAt,
      files: [file],
    };
    const closure = {
      id: 'closure-version-2',
      kind: 'CORRECT',
      priorVersionId: 'closure-version-1',
      finishId: 'finish-1',
      fromVersion: 4,
      toVersion: 5,
      closeAt: null,
      closeAmountState: 'PENDING',
      closeAmt: null,
      note: null,
      correctionReason: '结案更正原因',
      recordedAt,
      recordedByUserId: 'user-1',
      files: [file],
    } satisfies NonNullable<CaseDetail['closure']>['current'];
    item.closure = {
      id: 'closure-1',
      finishId: 'finish-1',
      current: closure,
      history: [
        {
          ...closure,
          id: 'closure-version-1',
          kind: 'REGISTER',
          priorVersionId: null,
          correctionReason: null,
        },
        closure,
      ],
    };
    const archive = {
      id: 'archive-version-1',
      kind: 'ARCHIVE',
      priorVersionId: null,
      closureVersionId: closure.id,
      fromVersion: 5,
      toVersion: 6,
      archiveAt: '2026-10-01',
      archiveType: 'EXECUTION_CLOSED',
      archiveReason: '归档原因',
      archiveNote: null,
      correctionReason: null,
      recordedAt,
      recordedByUserId: 'user-1',
    } satisfies NonNullable<CaseDetail['archive']>['current'];
    item.archive = {
      id: 'archive-1',
      closureId: 'closure-1',
      closureVersionId: closure.id,
      current: archive,
      history: [archive],
    };
    const events = buildCaseWorkspaceEvents(item);
    expect(
      events.filter((value) => value.source === 'execution-submission'),
    ).toHaveLength(2);
    expect(events.filter((value) => value.source === 'closure')).toHaveLength(
      2,
    );
    expect(events.find((value) => value.id === closure.id)).toMatchObject({
      businessAt: null,
      recordedAt,
    });
    const sections = buildCaseWorkspaceSections(item, null, 'idle');
    expect(JSON.stringify(sections[5])).not.toContain('结案更正原因');
    expect(
      sections[5]?.groups
        .filter((group) => !group.historical)
        .map((group) => group.title)
        .sort(),
    ).toEqual(
      [
        '执行材料重新提交',
        '执行材料确认',
        '执行材料邮寄',
        '执行立案',
        '执行结束',
      ].sort(),
    );
    expect(
      sections[5]?.groups.some(
        (group) => group.title === '执行材料提交（历史）',
      ),
    ).toBe(true);
    expect(
      sections[5]?.groups.map((group) => group.title).join(' '),
    ).not.toContain('（当前）');
    expect(JSON.stringify(sections[6])).toContain('结案更正原因');
    expect(JSON.stringify(sections[6])).toContain('案件实收');
    expect(JSON.stringify(sections[6])).toContain('尚未接入案件级实收来源');
    expect(JSON.stringify(sections[6])).toContain('归档日期');
    expect(JSON.stringify(sections[6])).toContain('执行终本');
    expect(JSON.stringify(sections[0])).toContain('归档原因');
    expect(JSON.stringify(sections)).not.toContain('已结清');
    expect(
      events
        .filter((value) => value.source.startsWith('execution-'))
        .map((value) => value.source),
    ).toEqual(
      expect.arrayContaining([
        'execution-confirmation',
        'execution-mailing',
        'execution-filing',
        'execution-finish',
      ]),
    );
  });

  it('sorts by actual record time with deterministic source/id tie breaks, irrespective of business dates', () => {
    const item = caseFixture();
    item.matchedOn = '2020-01-01';
    item.hearing.arrangements = ['b', 'a'].map((id) => ({
      id,
      trialRoundId: 'round-1',
      hearingAt: '2030-01-01T00:00:00Z',
      source: 'SCHEDULE',
      recordedAt: item.createdAt,
    }));
    const events = buildCaseWorkspaceEvents(item);
    expect(events.map((value) => `${value.source}:${value.id}`)).toEqual([
      'case:case-1',
      'hearing:a',
      'hearing:b',
      'match:case-1',
    ]);
    expect(events.at(-1)?.recordedAt).toBeNull();
  });

  it('projects contact changes and acceptance corrections with before and after values', () => {
    const item = caseFixture();
    item.defendants = [
      {
        id: 'defendant-1',
        kind: 'PERSON',
        name: '被告甲',
        idNo: null,
        phone: '222',
        address: '新地址',
      },
    ];
    const acceptance = {
      id: 'acceptance-1',
      trialRoundId: 'round-1',
      acceptedAt: '2026-10-06',
      courtCaseNo: 'CN-2',
      court: null,
      recordedAt: '2026-10-05T01:00:00Z',
      recordedByUserId: 'operator-1',
      files: [],
    };
    item.acceptance = acceptance;
    item.acceptances = [acceptance];
    item.courtCaseNo = acceptance.courtCaseNo;
    item.judgmentNextStep.current = {
      id: 'choice-2',
      trialRoundId: 'round-2',
      judgmentId: 'judgment-2',
      next: 'APPEAL',
      plaintiffRightsHolderId: null,
      plaintiffName: null,
      defendants: [],
      executionReadinessConfirmed: false,
      fromVersion: 1,
      toVersion: 2,
      recordedAt: '2026-10-05T00:30:00Z',
    };
    item.judgmentNextStep.history = [item.judgmentNextStep.current];
    item.secondInstance.acceptances = [
      {
        choiceId: 'choice-2',
        trialRoundId: 'round-2',
        acceptedAt: '2026-10-08',
        courtCaseNo: 'CN-SECOND-2',
        recordedAt: '2026-10-08T01:00:00Z',
      },
    ];
    item.recordEdits = {
      canUpdateDefendantContact: true,
      canCorrectAcceptance: true,
      defendantContacts: [
        {
          defendantId: 'defendant-1',
          contactRevision: 1,
          history: [
            {
              id: 'contact-change-1',
              fromRevision: 0,
              toRevision: 1,
              beforePhone: '111',
              beforeAddress: '旧地址',
              phone: '222',
              address: '新地址',
              recordedAt: '2026-10-05T02:00:00Z',
              recordedByUserId: 'operator-1',
            },
          ],
        },
      ],
      acceptanceCorrections: [
        {
          acceptanceId: 'acceptance-1',
          trialRoundId: 'round-1',
          acceptanceRevision: 1,
          originalAcceptedAt: '2026-10-05',
          originalCourtCaseNo: 'CN-1',
          history: [
            {
              id: 'acceptance-correction-1',
              priorCorrectionId: null,
              fromRevision: 0,
              toRevision: 1,
              acceptedAt: '2026-10-06',
              courtCaseNo: 'CN-2',
              reason: '登记信息订正',
              recordedAt: '2026-10-05T03:00:00Z',
              recordedByUserId: 'operator-1',
            },
          ],
        },
      ],
      canSaveSecondInstanceAcceptance: true,
      secondInstanceAcceptances: [
        {
          choiceId: 'choice-2',
          trialRoundId: 'round-2',
          acceptanceRevision: 2,
          acceptedAt: '2026-10-08',
          courtCaseNo: 'CN-SECOND-2',
          canEdit: true,
          history: [
            {
              id: 'second-acceptance-change-1',
              priorChangeId: null,
              fromRevision: 0,
              toRevision: 1,
              acceptedAt: '2026-10-07',
              courtCaseNo: 'CN-SECOND-1',
              reason: null,
              recordedAt: '2026-10-07T01:00:00Z',
              recordedByUserId: 'operator-1',
            },
            {
              id: 'second-acceptance-change-2',
              priorChangeId: 'second-acceptance-change-1',
              fromRevision: 1,
              toRevision: 2,
              acceptedAt: '2026-10-08',
              courtCaseNo: 'CN-SECOND-2',
              reason: '更正案号',
              recordedAt: '2026-10-08T01:00:00Z',
              recordedByUserId: 'operator-1',
            },
          ],
        },
      ],
    };

    const events = buildCaseWorkspaceEvents(item);
    const originalAcceptance = events.find(
      (event) => event.source === 'acceptance' && event.id === 'acceptance-1',
    );
    expect(originalAcceptance?.businessAt).toBe('2026-10-05');
    expect(originalAcceptance?.fields.map((field) => field.value)).toContain(
      'CN-1',
    );
    expect(
      originalAcceptance?.fields.map((field) => field.value),
    ).not.toContain('CN-2');
    expect(
      events.find((event) => event.id === 'acceptance-correction-1')
        ?.businessAt,
    ).toBe('2026-10-06');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'defendant-contact',
          id: 'contact-change-1',
          fields: expect.arrayContaining([
            expect.objectContaining({ label: '更正前电话', value: '111' }),
            expect.objectContaining({ label: '更正后电话', value: '222' }),
            expect.objectContaining({ label: '更正前地址', value: '旧地址' }),
            expect.objectContaining({ label: '更正后地址', value: '新地址' }),
          ]),
        }),
        expect.objectContaining({
          source: 'acceptance-correction',
          id: 'acceptance-correction-1',
          fields: expect.arrayContaining([
            expect.objectContaining({
              label: '更正前受理日期',
              value: '2026-10-05',
            }),
            expect.objectContaining({ label: '更正前法院案号', value: 'CN-1' }),
            expect.objectContaining({
              label: '更正后受理日期',
              value: '2026-10-06',
            }),
            expect.objectContaining({
              label: '更正原因',
              value: '登记信息订正',
            }),
          ]),
        }),
        expect.objectContaining({
          source: 'second-instance-acceptance',
          id: 'second-acceptance-change-2',
          fields: expect.arrayContaining([
            expect.objectContaining({
              label: '二审受理日期',
              value: '2026-10-08',
            }),
            expect.objectContaining({
              label: '二审案号',
              value: 'CN-SECOND-2',
            }),
            expect.objectContaining({ label: '更正原因', value: '更正案号' }),
          ]),
        }),
      ]),
    );
    const sections = buildCaseWorkspaceSections(item, null, 'idle');
    expect(
      JSON.stringify(
        sections.find((section) => section.key === 'second-instance'),
      ),
    ).toContain('CN-SECOND-2');
    item.secondInstance.acceptances = [
      {
        choiceId: 'second-choice-1',
        trialRoundId: 'round-1',
        acceptedAt: null,
        courtCaseNo: null,
        recordedAt: '2026-10-09T03:00:00Z',
      },
    ];
    const clearedSection = buildCaseWorkspaceSections(item, null, 'idle').find(
      (section) => section.key === 'second-instance',
    );
    expect(clearedSection?.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: '二审受理信息',
          fields: expect.arrayContaining([
            expect.objectContaining({ label: '二审受理日期', value: '未确定' }),
            expect.objectContaining({ label: '二审案号', value: '未提供' }),
          ]),
        }),
      ]),
    );
    expect(
      JSON.stringify(
        sections.find((section) => section.key === 'first-instance'),
      ),
    ).toContain('CN-2');
    expect(
      sections.find((section) => section.key === 'first-instance')?.groups,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'first-instance-round:round-1:acceptance-correction-1',
        }),
      ]),
    );
  });
});
