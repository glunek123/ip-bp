import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import type { CaseDetail } from '../../api/cases';
import CaseHearingPanel from './CaseHearingPanel.vue';

const api = vi.hoisted(() => ({
  scheduleCaseHearing: vi.fn(),
  correctCaseHearing: vi.fn(),
  todayShanghai: vi.fn(() => '2026-10-06'),
}));
vi.mock('../../api/cases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/cases')>()),
  scheduleCaseHearing: api.scheduleCaseHearing,
  correctCaseHearing: api.correctCaseHearing,
  todayShanghai: api.todayShanghai,
}));

const baseItem: CaseDetail = {
  id: 'case-1',
  businessNo: 'CA-1',
  stage: 'WAITING_HEARING',
  createdAt: '2026-09-28T00:00:00.000Z',
  version: 7,
  owner: { id: 'user-1', displayName: '负责人' },
  canMatch: false,
  canSubmitComplaint: false,
  canConfirmComplaint: false,
  canMailComplaint: false,
  canSubmitFiling: false,
  canRegisterAcceptance: false,
  canUploadAcceptanceMaterials: false,
  canScheduleHearing: true,
  canCorrectHearing: false,
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
  acceptance: {
    acceptedAt: '2026-10-05',
    courtCaseNo: '（2026）甲0101民初1号',
    recordedAt: '2026-10-05T01:00:00.000Z',
    recordedByUserId: '80000000-0000-4000-8000-000000000007',
  },
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
};

const commandResult = {
  id: 'case-1',
  stage: 'WAITING_HEARING' as const,
  version: 8,
  arrangementId: '80000000-0000-4000-8000-000000000001',
  hearingAt: '2026-10-05',
  recordedAt: '2026-10-06T01:00:00.000Z',
};

beforeEach(() => {
  vi.resetAllMocks();
  api.todayShanghai.mockReturnValue('2026-10-06');
  api.scheduleCaseHearing.mockResolvedValue(commandResult);
  api.correctCaseHearing.mockResolvedValue({
    ...commandResult,
    stage: 'WAITING_HEARING',
    version: 9,
    hearingAt: null,
  });
});
afterEach(() => vi.unstubAllGlobals());

function mountPanel(
  item: CaseDetail = baseItem,
  lawyer = false,
  contextKey = 'INTERNAL:user-1:1',
) {
  return mount(CaseHearingPanel, { props: { item, lawyer, contextKey } });
}

describe('case hearing panel', () => {
  it('allows a valid past date and explains automatic next-day advancement before save', async () => {
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain('次日 00:00（北京时间）');
    expect(wrapper.text()).toContain('服务器会补跑');
    expect(wrapper.text()).toContain('不代表法院已经判决');
    await wrapper.get('[data-test="hearing-date"]').setValue('2026-10-05');
    expect(
      (wrapper.get('[data-test="hearing-save"]').element as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    await wrapper.get('[data-test="hearing-save"]').trigger('click');
    await flushPromises();
    expect(api.scheduleCaseHearing).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({
        expectedVersion: 7,
        hearingAt: '2026-10-05',
      }),
      'internal',
    );
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it('blocks a date before formal acceptance and requires an explicit clear choice', async () => {
    const wrapper = mountPanel({
      ...baseItem,
      hearing: {
        ...baseItem.hearing,
        currentArrangement: {
          id: '80000000-0000-4000-8000-000000000011',
          hearingAt: '2026-10-20',
          source: 'SCHEDULE',
          recordedAt: '2026-10-01T00:00:00.000Z',
        },
      },
    });
    await wrapper.get('[data-test="hearing-date"]').setValue('2026-10-04');
    expect(
      (wrapper.get('[data-test="hearing-save"]').element as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(wrapper.text()).toContain('不得早于正式立案日期');

    await wrapper.get('[data-test="hearing-clear-date"]').trigger('click');
    expect(wrapper.text()).toContain('清除后案件保持待开庭');
    expect(
      (wrapper.get('[data-test="hearing-save"]').element as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    await wrapper.get('[data-test="hearing-save"]').trigger('click');
    await flushPromises();
    expect(api.scheduleCaseHearing).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({ hearingAt: null }),
      'internal',
    );
  });

  it('requires a correction reason and keeps an overdue correction in waiting judgment', async () => {
    const item: CaseDetail = {
      ...baseItem,
      stage: 'WAITING_JUDGMENT',
      canScheduleHearing: false,
      canCorrectHearing: true,
      hearing: {
        ...baseItem.hearing,
        currentArrangement: {
          id: '80000000-0000-4000-8000-000000000011',
          hearingAt: '2026-10-05',
          source: 'SCHEDULE',
          recordedAt: '2026-10-01T00:00:00.000Z',
        },
      },
    };
    api.correctCaseHearing.mockResolvedValueOnce({
      ...commandResult,
      stage: 'WAITING_JUDGMENT',
      version: 8,
    });
    const wrapper = mountPanel(item);
    expect(wrapper.find('[data-test="hearing-save"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('已到期的更正仍保持待判决');
    await wrapper
      .get('[data-test="hearing-correction-reason"]')
      .setValue('   ');
    expect(
      (
        wrapper.get('[data-test="hearing-correct"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await wrapper
      .get('[data-test="hearing-correction-reason"]')
      .setValue('法院通知日期尚未确认');
    await wrapper.get('[data-test="hearing-correct"]').trigger('click');
    await flushPromises();
    expect(api.correctCaseHearing).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({
        expectedVersion: 7,
        hearingAt: '2026-10-05',
        reason: '法院通知日期尚未确认',
      }),
    );
  });

  it('retries an unknown POST with the original idempotency key and exact body', async () => {
    api.scheduleCaseHearing
      .mockRejectedValueOnce(new ApiError('timeout', 0, 'TIMEOUT'))
      .mockResolvedValueOnce(commandResult);
    const wrapper = mountPanel();
    await wrapper.get('[data-test="hearing-date"]').setValue('2026-10-05');
    await wrapper.get('[data-test="hearing-save"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('结果暂时未知');
    expect(wrapper.emitted('refresh')).toBeUndefined();
    expect(wrapper.emitted('changed')).toBeUndefined();
    const original = api.scheduleCaseHearing.mock.calls[0];
    await wrapper.get('[data-test="hearing-date"]').setValue('2026-10-20');
    expect(api.scheduleCaseHearing).toHaveBeenCalledTimes(1);
    await wrapper.get('[data-test="hearing-retry"]').trigger('click');
    await flushPromises();
    expect(api.scheduleCaseHearing.mock.calls[1]).toEqual(original);
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it.each([
    {
      kind: 'schedule',
      status: 502,
      code: 'HTTP_ERROR',
      hearingAt: '2026-10-05',
    },
    {
      kind: 'schedule',
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      hearingAt: null,
    },
    {
      kind: 'correct',
      status: 502,
      code: 'HTTP_ERROR',
      hearingAt: '2026-10-05',
    },
    {
      kind: 'correct',
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      hearingAt: null,
    },
  ] as const)(
    'preserves an unknown $kind request after HTTP $status/$code and retries its original body',
    async ({ kind, status, code, hearingAt }) => {
      const correction = kind === 'correct';
      const item: CaseDetail = correction
        ? {
            ...baseItem,
            stage: 'WAITING_JUDGMENT',
            canScheduleHearing: false,
            canCorrectHearing: true,
            hearing: {
              ...baseItem.hearing,
              currentArrangement: {
                id: '80000000-0000-4000-8000-000000000011',
                hearingAt: '2026-10-05',
                source: 'SCHEDULE',
                recordedAt: '2026-10-01T00:00:00.000Z',
              },
            },
          }
        : baseItem;
      const failedCommand = correction
        ? api.correctCaseHearing
        : api.scheduleCaseHearing;
      failedCommand
        .mockRejectedValueOnce(new ApiError('proxy response', status, code))
        .mockResolvedValueOnce(commandResult);

      const wrapper = mountPanel(item);
      if (hearingAt === null)
        await wrapper.get('[data-test="hearing-clear-date"]').trigger('click');
      else await wrapper.get('[data-test="hearing-date"]').setValue(hearingAt);
      if (correction)
        await wrapper
          .get('[data-test="hearing-correction-reason"]')
          .setValue('法院通知日期尚未确认');
      await wrapper
        .get(
          correction
            ? '[data-test="hearing-correct"]'
            : '[data-test="hearing-save"]',
        )
        .trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('结果暂时未知');
      expect(wrapper.emitted('changed')).toBeUndefined();
      expect(wrapper.emitted('refresh')).toBeUndefined();
      expect(wrapper.find('[data-test="hearing-retry"]').exists()).toBe(true);
      expect(
        (
          wrapper.get(
            correction
              ? '[data-test="hearing-correct"]'
              : '[data-test="hearing-save"]',
          ).element as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      expect(
        (wrapper.get('[data-test="hearing-date"]').element as HTMLInputElement)
          .disabled,
      ).toBe(true);
      if (correction)
        expect(
          (
            wrapper.get('[data-test="hearing-correction-reason"]')
              .element as HTMLTextAreaElement
          ).disabled,
        ).toBe(true);
      const original = failedCommand.mock.calls[0];

      const refreshedItem: CaseDetail = {
        ...item,
        version: 8,
        hearing: {
          ...item.hearing,
          currentArrangement: {
            id: '80000000-0000-4000-8000-000000000021',
            hearingAt: '2026-10-30',
            source: 'SCHEDULE',
            recordedAt: '2026-10-07T00:00:00.000Z',
          },
        },
      };
      await wrapper.setProps({ item: refreshedItem });
      expect(wrapper.find('[data-test="hearing-retry"]').exists()).toBe(true);
      expect(wrapper.emitted('changed')).toBeUndefined();
      expect(wrapper.emitted('refresh')).toBeUndefined();

      await wrapper.get('[data-test="hearing-retry"]').trigger('click');
      await flushPromises();
      expect(failedCommand.mock.calls[1]).toEqual(original);
      expect(failedCommand.mock.calls[1][1]).toEqual(
        expect.objectContaining({
          expectedVersion: 7,
          idempotencyKey: expect.any(String),
          hearingAt,
          ...(correction ? { reason: '法院通知日期尚未确认' } : {}),
        }),
      );
      expect(
        correction ? api.scheduleCaseHearing : api.correctCaseHearing,
      ).not.toHaveBeenCalled();
      expect(wrapper.emitted('changed')).toHaveLength(1);
    },
  );

  it.each(['schedule', 'correct'] as const)(
    'keeps an explicit forbidden $kind rejection out of the unknown-outcome retry path',
    async (kind) => {
      const correction = kind === 'correct';
      const item: CaseDetail = correction
        ? {
            ...baseItem,
            stage: 'WAITING_JUDGMENT',
            canScheduleHearing: false,
            canCorrectHearing: true,
            hearing: {
              ...baseItem.hearing,
              currentArrangement: {
                id: '80000000-0000-4000-8000-000000000011',
                hearingAt: '2026-10-05',
                source: 'SCHEDULE',
                recordedAt: '2026-10-01T00:00:00.000Z',
              },
            },
          }
        : baseItem;
      const rejectedCommand = correction
        ? api.correctCaseHearing
        : api.scheduleCaseHearing;
      rejectedCommand.mockRejectedValueOnce(
        new ApiError('forbidden', 403, 'ACTION_FORBIDDEN'),
      );
      const wrapper = mountPanel(item);
      await wrapper.get('[data-test="hearing-date"]').setValue('2026-10-05');
      if (correction)
        await wrapper
          .get('[data-test="hearing-correction-reason"]')
          .setValue('法院通知日期尚未确认');
      await wrapper
        .get(
          correction
            ? '[data-test="hearing-correct"]'
            : '[data-test="hearing-save"]',
        )
        .trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('当前账号无权办理此案件');
      expect(wrapper.find('[data-test="hearing-retry"]').exists()).toBe(false);
      expect(wrapper.emitted('changed')).toBeUndefined();
    },
  );

  it('reads latest case after a version race and exposes correction only when authorized', async () => {
    api.scheduleCaseHearing.mockRejectedValueOnce(
      new ApiError('version changed', 409, 'VERSION_CONFLICT'),
    );
    const wrapper = mountPanel();
    await wrapper.get('[data-test="hearing-date"]').setValue('2026-10-05');
    await wrapper.get('[data-test="hearing-save"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('案件已自动推进');
    expect(wrapper.emitted('refresh')).toHaveLength(1);

    await wrapper.setProps({
      item: {
        ...baseItem,
        stage: 'WAITING_JUDGMENT',
        version: 8,
        canScheduleHearing: false,
        canCorrectHearing: true,
      },
    });
    expect(wrapper.find('[data-test="hearing-save"]').exists()).toBe(false);
    expect(
      wrapper.find('[data-test="hearing-correction-reason"]').exists(),
    ).toBe(true);
  });

  it('ignores a late command response after switching to another case', async () => {
    let resolveCommand: ((value: typeof commandResult) => void) | undefined;
    api.scheduleCaseHearing.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCommand = resolve;
        }),
    );
    const wrapper = mountPanel();
    await wrapper.get('[data-test="hearing-date"]').setValue('2026-10-05');
    await wrapper.get('[data-test="hearing-save"]').trigger('click');
    await wrapper.setProps({ item: { ...baseItem, id: 'case-2' } });
    resolveCommand?.({ ...commandResult, id: 'case-1' });
    await flushPromises();
    expect(wrapper.text()).not.toContain('登记完成');
    expect(wrapper.emitted('changed')).toBeUndefined();
    expect(wrapper.get('[data-test="hearing-date"]').element).toHaveProperty(
      'value',
      '',
    );
  });

  it('shows business dates separately from recorded and executed times without claiming a court judgment', () => {
    const item: CaseDetail = {
      ...baseItem,
      stage: 'WAITING_JUDGMENT',
      canScheduleHearing: false,
      hearing: {
        currentArrangement: {
          id: '80000000-0000-4000-8000-000000000011',
          hearingAt: '2026-10-05',
          source: 'SCHEDULE',
          recordedAt: '2026-10-01T08:00:00.000Z',
        },
        currentAdvance: {
          id: '80000000-0000-4000-8000-000000000012',
          arrangementId: '80000000-0000-4000-8000-000000000011',
          dueAt: '2026-10-06T00:00:00.000+08:00',
          executedAt: '2026-10-06T01:00:00.000Z',
        },
        arrangements: [
          {
            id: '80000000-0000-4000-8000-000000000011',
            hearingAt: '2026-10-05',
            source: 'SCHEDULE',
            recordedAt: '2026-10-01T08:00:00.000Z',
          },
        ],
        advances: [
          {
            id: '80000000-0000-4000-8000-000000000012',
            arrangementId: '80000000-0000-4000-8000-000000000011',
            dueAt: '2026-10-06T00:00:00.000+08:00',
            executedAt: '2026-10-06T01:00:00.000Z',
          },
        ],
        corrections: [],
      },
    };
    const wrapper = mountPanel(item);
    expect(wrapper.text()).toContain('待判决');
    expect(wrapper.text()).toContain('开庭业务日期：2026-10-05');
    expect(wrapper.text()).toContain('系统执行时间：');
    expect(wrapper.text()).not.toContain('法院已判决');
  });

  it('never renders the correction form for a lawyer', () => {
    const item: CaseDetail = {
      ...baseItem,
      stage: 'WAITING_JUDGMENT',
      canScheduleHearing: false,
      canCorrectHearing: false,
    };
    const wrapper = mountPanel(item, true, 'LAWYER:lawyer-1:1');
    expect(wrapper.find('[data-test="hearing-correct"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="hearing-schedule-form"]').exists()).toBe(
      false,
    );
  });
});
