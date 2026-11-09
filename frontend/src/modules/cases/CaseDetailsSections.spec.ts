import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { CaseDetail } from '../../api/cases';
import type { CaseClosureWorkspace } from '../../api/case-closure-workspace';
import type { CaseSupplementWorkspace } from '../../api/case-supplements';
import type { RefundWorkspace } from '../../api/litigation-refunds';
import { ApiError } from '../../api/http';
import CaseDetailsSections from './CaseDetailsSections.vue';
import CaseSupplementalWorkspacePanel from './CaseSupplementalWorkspacePanel.vue';
import type { SectionAction, SectionKey } from './case-workspace-contract';
import { setPendingCaseSupplement } from './case-supplement-pending';

const downloadVersion = vi.hoisted(() => vi.fn());
const supplementApi = vi.hoisted(() => ({ create: vi.fn(), request: vi.fn() }));
vi.mock('../../api/materials', () => ({
  downloadMaterialVersion: downloadVersion,
}));
vi.mock('../../api/case-supplements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/case-supplements')>()),
  createCaseSupplement: supplementApi.create,
  getCaseSupplementRequest: supplementApi.request,
}));

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

function executionFixture(): CaseDetail {
  const item = caseFixture();
  const roundId = '11111111-1111-4111-8111-111111111111';
  const recordedAt = '2026-10-02T00:00:00Z';
  const file = {
    materialId: 'material-1',
    contentVersionId: '22222222-2222-4222-8222-222222222222',
    originalFilename: '执行材料.pdf',
    mimeType: 'application/pdf',
  };
  item.stage = 'WAITING_EXECUTION_FILING';
  item.secondInstance.rounds = [
    { id: roundId, sequence: 1, sourceResultId: null, revokedAt: null },
  ];
  item.executionSubmission.current = {
    id: 'submission-1',
    trialRoundId: roundId,
    judgmentNextStepId: 'choice-1',
    secondInstanceResultId: null,
    priorSubmissionId: null,
    changeReason: null,
    fromVersion: 1,
    toVersion: 2,
    submittedAt: recordedAt,
    files: [{ ...file, uploadedAt: recordedAt }],
  };
  item.executionSubmission.submissions = [item.executionSubmission.current];
  item.executionConfirmation = {
    id: 'confirmation-1',
    submissionId: 'submission-1',
    confirmedAt: '2026-10-02T01:00:00Z',
    confirmedByUserId: 'user-1',
    files: item.executionSubmission.current.files,
  };
  item.executionMailing = {
    id: 'mailing-1',
    confirmationId: 'confirmation-1',
    mailedAt: '2026-10-01',
    recordedAt: '2026-10-02T02:00:00Z',
    files: [file],
  };
  return item;
}

const keys: SectionKey[] = [
  'case-info',
  'lead-info',
  'first-instance',
  'second-instance',
  'judgment',
  'execution',
  'closure-info',
  'timeline',
];
function actions(): Record<SectionKey, SectionAction> {
  const readonly: SectionAction = {
    enabled: false,
    label: '编辑',
    hint: '当前阶段或权限无可办理命令',
  };
  return {
    'case-info': { enabled: true, label: '匹配', hint: null },
    'lead-info': readonly,
    'first-instance': readonly,
    'second-instance': readonly,
    judgment: readonly,
    execution: readonly,
    'closure-info': readonly,
    timeline: { ...readonly, label: '只读' },
  };
}
const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  downloadVersion.mockReset();
  supplementApi.create.mockReset();
  supplementApi.request.mockReset();
  localStorage.clear();
});
function mountSections() {
  const wrapper = mount(CaseDetailsSections, {
    attachTo: document.body,
    props: {
      item: caseFixture(),
      lead: null,
      leadState: 'idle',
      actions: actions(),
      contextKey: 'case-1:user-1:revision-1',
      supplementActorKey: 'INTERNAL:user-1:department-1',
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}

describe('CaseDetailsSections with the real A2 section shell', () => {
  it('uses a readable current refund workspace when the legacy closure workspace is unavailable', async () => {
    const wrapper = mountSections();
    const refundWorkspace: RefundWorkspace = {
      caseId: 'case-1',
      inventoryVersionId: 'inventory-1',
      canRecord: false,
      canFollow: false,
      sources: [],
      items: [
        {
          caseId: 'case-1',
          itemId: 'refund-1',
          inventoryVersionId: 'inventory-1',
          caseNo: 'CA-1',
          plaintiff: '原告',
          defendant: '被告',
          courtNo: null,
          lawyer: null,
          party: 'COURT',
          amount: '41.00',
          status: 'PENDING',
          description: '判决后登记事项',
          remark: null,
          archived: false,
          archiveStatus: null,
          canFollow: false,
          canRecord: false,
          source: null,
        },
      ],
    };
    await wrapper.setProps({ closureReadState: 'failed', refundWorkspace });
    const judgment = wrapper.get('[data-section="judgment"]').text();
    expect(judgment).toContain('41.00 元');
    expect(judgment).toContain('判决后登记事项');
    expect(judgment).toContain('来源未关联');
    expect(judgment).toContain('当前没有来源关联');
  });

  it('reopens an unknown supplement under the same actor after an authorization revision and resends its original body', async () => {
    const actorKey = 'INTERNAL:user-1:department-1';
    const original = {
      kind: 'MANUAL_ANNOTATION' as const,
      reason: '原附记原因',
      text: '原附记内容',
      idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    };
    setPendingCaseSupplement({ actorKey, caseId: 'case-1', input: original });
    supplementApi.request.mockRejectedValue(
      new ApiError('请求结果未知', 404, 'NOT_FOUND'),
    );
    supplementApi.create.mockResolvedValue({ id: 'recorded' });
    const workspace: CaseSupplementWorkspace = {
      canEdit: true,
      entries: [],
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
    const wrapper = mountSections();
    await wrapper.setProps({ supplementWorkspace: workspace });
    const reopen = async () => {
      await wrapper
        .get(
          '[data-section="timeline"] .case-workspace-supplement-actions button',
        )
        .trigger('click');
      await flushPromises();
    };
    await reopen();
    expect(supplementApi.request).toHaveBeenLastCalledWith(
      'case-1',
      original.idempotencyKey,
    );
    expect(supplementApi.create).not.toHaveBeenCalled();
    await wrapper.setProps({ contextKey: 'case-1:user-1:revision-2' });
    expect(wrapper.findComponent(CaseSupplementalWorkspacePanel).exists()).toBe(
      false,
    );
    await reopen();
    expect(supplementApi.request).toHaveBeenCalledTimes(2);
    expect(supplementApi.request).toHaveBeenLastCalledWith(
      'case-1',
      original.idempotencyKey,
    );
    expect(supplementApi.create).not.toHaveBeenCalled();
    await wrapper
      .getComponent(CaseSupplementalWorkspacePanel)
      .findAll('button')
      .find((button) => button.text() === '追加记录')!
      .trigger('click');
    await flushPromises();
    expect(supplementApi.create).toHaveBeenCalledTimes(1);
    expect(supplementApi.create).toHaveBeenCalledWith('case-1', original);
  });
  it('keeps selected groups distinct from real stage and puts technical IDs behind explicit details', async () => {
    const wrapper = mountSections();
    const item = executionFixture();
    await wrapper.setProps({ item });
    const section = wrapper.get('[data-section="execution"]');
    section
      .get('.case-workspace-extra-groups')
      .element.setAttribute('open', '');
    const buttons = section.findAll('.case-workspace-group-nav button');
    expect(buttons.map((button) => button.text())).toEqual([
      '执行材料提交',
      '执行材料确认',
      '执行材料邮寄',
    ]);
    expect(buttons.map((button) => button.attributes('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    const group = section
      .findAll('.case-workspace-group')
      .find((value) => value.isVisible())!;
    expect(group.get('h3').text()).toBe('执行材料提交');
    expect(group.text()).toContain('初次一审');
    const technical = group.get('[data-test="workspace-technical-details"]');
    expect(technical.attributes('open')).toBeUndefined();
    expect(technical.get('dd').text()).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(technical.get('dd').isVisible()).toBe(false);
    const version = group.get('[data-test="workspace-file-version"]');
    expect(version.attributes('open')).toBeUndefined();
    expect(version.get('p').isVisible()).toBe(false);
    expect(version.get('p').text()).toContain(
      '22222222-2222-4222-8222-222222222222',
    );
    technical.element.setAttribute('open', '');
    version.element.setAttribute('open', '');
    expect(technical.get('dd').isVisible()).toBe(true);
    expect(version.get('p').isVisible()).toBe(true);
    expect(
      section.get('[data-test="workspace-section-note"] p').isVisible(),
    ).toBe(false);
    await buttons[2]!.trigger('click');
    expect(buttons.map((button) => button.attributes('aria-pressed'))).toEqual([
      'false',
      'false',
      'true',
    ]);
    await wrapper.setProps({
      item: { ...item, stage: 'ARCHIVED', version: 3 },
    });
    expect(buttons[2]!.attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('[data-section="case-info"]').text()).toContain(
      '已归档',
    );
    expect(buttons.map((button) => button.text()).join(' ')).not.toContain(
      '（当前）',
    );
    expect(wrapper.emitted('edit')).toBeUndefined();
  });
  it('shows one selected information group, retains it on refresh and resets it on identity changes', async () => {
    const wrapper = mountSections();
    const section = wrapper.get('[data-section="case-info"]');
    section
      .get('.case-workspace-extra-groups')
      .element.setAttribute('open', '');
    const buttons = section.findAll('.case-workspace-group-nav button');
    expect(buttons).toHaveLength(2);
    await buttons[1]!.trigger('click');
    expect(buttons[1]!.attributes('aria-pressed')).toBe('true');
    expect(
      section
        .findAll('.case-workspace-group')
        .filter((group) => group.isVisible()),
    ).toHaveLength(1);
    await wrapper.setProps({ item: { ...caseFixture(), version: 2 } });
    expect(buttons[1]!.attributes('aria-pressed')).toBe('true');
    await wrapper.setProps({ contextKey: 'case-1:user-1:revision-2' });
    expect(buttons[0]!.attributes('aria-pressed')).toBe('true');
    expect(
      section
        .get('.case-workspace-section__toggle')
        .attributes('aria-expanded'),
    ).toBe('true');
  });
  it('renders eight sections in order, expanded, with readable labels, values and helpers', () => {
    const wrapper = mountSections();
    expect(
      wrapper
        .findAll('.case-workspace-section')
        .map((section) => section.attributes('data-section')),
    ).toEqual(keys);
    expect(
      wrapper
        .findAll('.case-workspace-section__toggle')
        .map((button) => button.attributes('aria-expanded')),
    ).toEqual(keys.map(() => 'true'));
    expect(
      wrapper
        .findAll('.case-workspace-section__body')
        .every((body) => body.isVisible()),
    ).toBe(true);
    const caseBody = wrapper.get('[data-section="case-info"]');
    expect(
      caseBody
        .get('.case-workspace-main-summary .case-workspace-field__label')
        .text(),
    ).toBe('客户');
    expect(caseBody.get('.case-workspace-main-summary').text()).toContain(
      'CA-1',
    );
    expect(caseBody.text()).toContain('未登记');
    expect(caseBody.text()).toContain('委案日期');
    expect(caseBody.text()).toContain('未记录');
    expect(
      wrapper
        .get('[data-section="judgment"]')
        .findAll('.case-workspace-summary-group h3')
        .map((heading) => heading.text()),
    ).toEqual(['一审判决信息', '二审判决信息', '历史审级与退费归属']);
    expect(wrapper.find('input, select, textarea, form').exists()).toBe(false);
    expect(wrapper.find('button button').exists()).toBe(false);
    expect(
      wrapper
        .get('[data-section="closure-info"]')
        .find('.case-workspace-section__edit')
        .exists(),
    ).toBe(true);
  });

  it('emits controlled edit without expanding the section and suppresses disabled commands', async () => {
    const wrapper = mountSections();
    const caseSection = wrapper.get('[data-section="case-info"]');
    await caseSection.get('.case-workspace-section__edit').trigger('click');
    expect(wrapper.emitted('edit')).toEqual([['case-info']]);
    expect(
      caseSection
        .get('.case-workspace-section__toggle')
        .attributes('aria-expanded'),
    ).toBe('true');
    const leadSection = wrapper.get('[data-section="lead-info"]');
    expect(
      leadSection.get('.case-workspace-section__edit').attributes('disabled'),
    ).toBeDefined();
    expect(leadSection.text()).toContain('当前阶段或权限无可办理命令');
    await leadSection.get('.case-workspace-section__edit').trigger('click');
    expect(wrapper.emitted('edit')).toHaveLength(1);
  });

  it('retains independent expanded choices on same-case refresh, resets after context changes and clears replaced data', async () => {
    const wrapper = mountSections();
    const caseSection = wrapper.get('[data-section="case-info"]');
    const leadSection = wrapper.get('[data-section="lead-info"]');
    await caseSection.get('.case-workspace-section__toggle').trigger('click');
    await leadSection.get('.case-workspace-section__toggle').trigger('click');
    await wrapper.setProps({
      item: { ...caseFixture(), businessNo: 'CA-1-refreshed' },
    });
    expect(caseSection.get('.case-workspace-section__body').isVisible()).toBe(
      false,
    );
    expect(leadSection.get('.case-workspace-section__body').isVisible()).toBe(
      false,
    );
    expect(
      wrapper
        .get('[data-section="execution"] .case-workspace-section__body')
        .isVisible(),
    ).toBe(true);
    await caseSection.get('.case-workspace-section__toggle').trigger('click');
    expect(leadSection.get('.case-workspace-section__body').isVisible()).toBe(
      false,
    );
    await wrapper.setProps({
      contextKey: 'case-2:user-1:revision-1',
      item: { ...caseFixture(), id: 'case-2', businessNo: 'CA-2' },
    });
    expect(
      wrapper
        .findAll('.case-workspace-section__body')
        .every((body) => body.isVisible()),
    ).toBe(true);
    expect(wrapper.text()).not.toContain('CA-1');
    await leadSection.get('.case-workspace-section__toggle').trigger('click');
    await wrapper.setProps({
      contextKey: 'case-2:user-1:revision-2',
      actions: {
        ...actions(),
        'case-info': {
          enabled: false,
          label: '编辑',
          hint: '授权已变化，资料只读',
        },
      },
    });
    expect(leadSection.get('.case-workspace-section__body').isVisible()).toBe(
      true,
    );
    expect(
      caseSection.get('.case-workspace-section__edit').attributes('disabled'),
    ).toBeDefined();
  });

  it('keeps denied and failed source states distinct while case facts remain visible', async () => {
    const wrapper = mountSections();
    await wrapper
      .get('[data-section="case-info"] .case-workspace-section__toggle')
      .trigger('click');
    await wrapper
      .get('[data-section="lead-info"] .case-workspace-section__toggle')
      .trigger('click');
    await wrapper.setProps({ leadState: 'loading' });
    expect(wrapper.get('[data-section="lead-info"]').text()).toContain(
      '正在加载',
    );
    await wrapper.setProps({ leadState: 'denied' });
    expect(wrapper.get('[data-section="lead-info"]').text()).toContain(
      '无来源线索读取权限',
    );
    expect(wrapper.get('[data-section="case-info"]').text()).toContain(
      '客户甲',
    );
    await wrapper.setProps({ leadState: 'failed' });
    expect(wrapper.get('[data-section="lead-info"]').text()).toContain(
      '加载失败',
    );
    expect(wrapper.get('[data-section="lead-info"]').text()).not.toContain(
      '无来源线索读取权限',
    );
  });

  it('names timeline actions accurately and emits viewing without opening or generating a write', async () => {
    const wrapper = mountSections();
    const timeline = wrapper.get('[data-section="timeline"]');
    expect(timeline.get('.case-workspace-section__edit').text()).toBe('只读');
    expect(
      timeline.get('.case-workspace-section__edit').attributes('disabled'),
    ).toBeDefined();
    await timeline.get('.case-workspace-section__view').trigger('click');
    expect(wrapper.emitted('view-timeline')).toEqual([[]]);
    expect(
      timeline
        .get('.case-workspace-section__toggle')
        .attributes('aria-expanded'),
    ).toBe('true');
    await timeline.get('.case-workspace-section__toggle').trigger('click');
    expect(timeline.get('.case-workspace-timeline').text()).toContain(
      '案件创建',
    );
    expect(timeline.get('.case-workspace-timeline').text()).toContain(
      '业务日期／时间未记录',
    );
    expect(timeline.text()).not.toContain('添加记录');
    expect(wrapper.emitted('edit')).toBeUndefined();
    await wrapper.setProps({
      actions: {
        ...actions(),
        timeline: { enabled: true, label: '登记', hint: '打开本案已有命令' },
      },
    });
    await timeline.get('.case-workspace-section__edit').trigger('click');
    expect(wrapper.emitted('edit')).toEqual([['timeline']]);
  });

  it('shows an early-archive fact with its original stage and reason without implying closure or payment', async () => {
    const item = {
      ...caseFixture(),
      stage: 'ARCHIVED' as const,
      version: 2,
      earlyArchive: {
        id: '33333333-3333-4333-8333-333333333333',
        fromStage: 'WAITING_HEARING' as const,
        fromVersion: 1,
        toVersion: 2,
        archiveAt: '2026-10-20',
        reason: '客户决定停止诉讼',
        recordedAt: '2026-10-20T08:00:00.000Z',
        recordedByUserId: '44444444-4444-4444-8444-444444444444',
      },
    };
    const wrapper = mountSections();
    await wrapper.setProps({ item });
    const fact = wrapper.get(
      '[data-section="case-info"] .case-workspace-extra-groups',
    );
    expect(fact.text()).toContain('原案件阶段');
    expect(fact.text()).toContain('待开庭');
    expect(fact.text()).toContain('客户决定停止诉讼');
    expect(fact.text()).toContain('不表示案件已结案或款项已登记');
    expect(fact.text()).not.toContain('已结清');
  });

  it('renders six effective payment columns and downloads the exact receipt version with identity cancellation', async () => {
    const closureWorkspace = {
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
      effectivePayments: [
        {
          versionId: 'payment-version-1',
          paymentId: 'payment-1',
          revision: 1,
          paidOn: '2026-10-03',
          amount: '125.50',
          payer: '付款方甲',
          payee: '收款方乙',
          documents: [
            { materialId: 'receipt-material', contentVersionId: 'receipt-v2' },
          ],
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
        lawyerInvoiceState: 'UNKNOWN',
        customerReceivedAmount: null,
        lawyerInvoicedAmount: null,
      },
    } as CaseClosureWorkspace;
    downloadVersion.mockReturnValue(new Promise<void>(() => {}));
    const wrapper = mountSections();
    await wrapper.setProps({ closureWorkspace, closureReadState: 'ready' });
    const table = wrapper.get('[data-test="workspace-effective-payments"]');
    expect(table.findAll('th').map((cell) => cell.text())).toEqual([
      '序号',
      '付款日期',
      '付款金额',
      '付款人',
      '收款人',
      '收款截图',
    ]);
    expect(table.text()).toContain('付款方甲');
    expect(table.text()).toContain('收款方乙');
    await table.get('tbody button').trigger('click');
    expect(downloadVersion).toHaveBeenCalledWith(
      'receipt-material',
      'receipt-v2',
      expect.any(AbortSignal),
    );
    const signal = downloadVersion.mock.calls[0]![2] as AbortSignal;
    expect(signal.aborted).toBe(false);
    await wrapper.setProps({ contextKey: 'case-1:user-2:revision-1' });
    expect(signal.aborted).toBe(true);
  });
});
