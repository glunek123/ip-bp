import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { CaseDetail } from '../../api/cases';
import CaseDetailsSections from './CaseDetailsSections.vue';
import type { SectionAction, SectionKey } from './case-workspace-contract';

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
    timeline: readonly,
  };
}
const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
function mountSections() {
  const wrapper = mount(CaseDetailsSections, {
    attachTo: document.body,
    props: {
      item: caseFixture(),
      lead: null,
      leadState: 'idle',
      actions: actions(),
      contextKey: 'case-1:user-1:revision-1',
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}

describe('CaseDetailsSections with the real A2 section shell', () => {
  it('renders eight sections in order, all closed, with readable labels, values and helpers', () => {
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
    ).toEqual(keys.map(() => 'false'));
    expect(
      wrapper
        .findAll('.case-workspace-section__body')
        .every((body) => !body.isVisible()),
    ).toBe(true);
    const caseBody = wrapper.get('[data-section="case-info"]');
    expect(caseBody.get('.case-workspace-field__label').text()).toBe('案件单号');
    expect(caseBody.get('.case-workspace-field__value').text()).toBe('CA-1');
    expect(caseBody.text()).toContain('未登记');
    expect(caseBody.text()).toContain('实际匹配日期');
    expect(caseBody.text()).toContain('未记录');
    expect(wrapper.find('input, select, textarea, form').exists()).toBe(false);
    expect(wrapper.find('button button').exists()).toBe(false);
    expect(
      wrapper
        .get('[data-section="closure-info"]')
        .find('.case-workspace-section__edit')
        .exists(),
    ).toBe(false);
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
    ).toBe('false');
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
      true,
    );
    expect(leadSection.get('.case-workspace-section__body').isVisible()).toBe(
      true,
    );
    expect(
      wrapper
        .get('[data-section="execution"] .case-workspace-section__body')
        .isVisible(),
    ).toBe(false);
    await caseSection.get('.case-workspace-section__toggle').trigger('click');
    expect(leadSection.get('.case-workspace-section__body').isVisible()).toBe(
      true,
    );
    await wrapper.setProps({
      contextKey: 'case-2:user-1:revision-1',
      item: { ...caseFixture(), id: 'case-2', businessNo: 'CA-2' },
    });
    expect(
      wrapper
        .findAll('.case-workspace-section__body')
        .every((body) => !body.isVisible()),
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
      false,
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
    expect(timeline.get('.case-workspace-section__edit').text()).toBe(
      '登记／更正',
    );
    expect(
      timeline.get('.case-workspace-section__edit').attributes('disabled'),
    ).toBeDefined();
    await timeline.get('.case-workspace-section__view').trigger('click');
    expect(wrapper.emitted('view-timeline')).toEqual([[]]);
    expect(
      timeline
        .get('.case-workspace-section__toggle')
        .attributes('aria-expanded'),
    ).toBe('false');
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
});
