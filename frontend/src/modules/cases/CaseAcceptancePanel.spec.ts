import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import type { CaseWorkflowItem } from '../../api/cases';
import { workflowChangedEvent } from '../../app/workflow-events';
import CaseAcceptancePanel from './CaseAcceptancePanel.vue';

const api = vi.hoisted(() => ({
  registerCaseAcceptance: vi.fn(),
  todayShanghai: vi.fn(() => '2026-10-06'),
  uploadMaterialFile: vi.fn(),
  downloadMaterialVersion: vi.fn(),
}));
vi.mock('../../api/cases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/cases')>()),
  registerCaseAcceptance: api.registerCaseAcceptance,
  todayShanghai: api.todayShanghai,
}));
vi.mock('../../api/materials', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/materials')>()),
  uploadMaterialFile: api.uploadMaterialFile,
  downloadMaterialVersion: api.downloadMaterialVersion,
}));

type TestItem = CaseWorkflowItem & {
  filingSubmission: { submittedAt: string } | null;
};
const baseItem: TestItem = {
  id: 'case-1',
  stage: 'WAITING_FORMAL_ACCEPTANCE',
  version: 6,
  canSubmitComplaint: false,
  canConfirmComplaint: false,
  canMailComplaint: false,
  canSubmitFiling: false,
  canRegisterAcceptance: true,
  canUploadAcceptanceMaterials: true,
  acceptance: null,
  acceptanceMaterials: {
    ACCEPTANCE_NOTICE: { available: [], frozen: [], later: [] },
    PAYMENT_LIST: { available: [], frozen: [], later: [] },
    SERVICE_DOCUMENT: { available: [], frozen: [], later: [] },
  },
  filingSubmission: {
    submittedAt: '2026-10-01',
  },
  complaint: null,
  complaintConfirmation: null,
  complaintMailing: null,
};

let workflowRefreshCount = 0;
function recordWorkflowRefresh(): void {
  workflowRefreshCount += 1;
}

beforeEach(() => {
  workflowRefreshCount = 0;
  window.addEventListener(workflowChangedEvent, recordWorkflowRefresh);
  vi.resetAllMocks();
  api.todayShanghai.mockReturnValue('2026-10-06');
  api.registerCaseAcceptance.mockResolvedValue({
    id: 'case-1',
    stage: 'WAITING_HEARING',
    version: 7,
    acceptedAt: '2026-10-05',
    courtCaseNo: '甲0101民初1号',
    recordedAt: '2026-10-06T01:00:00.000Z',
  });
  api.uploadMaterialFile.mockImplementation(async ({ category, file }) => ({
    materialId: `material-${file.name}`,
    contentVersionId: `version-${file.name}`,
    originalFilename: file.name,
    mimeType: file.type,
    purpose: category,
  }));
});
afterEach(() => {
  window.removeEventListener(workflowChangedEvent, recordWorkflowRefresh);
});

function mountPanel(item = baseItem, contextKey = 'INTERNAL:user-1:1') {
  return mount(CaseAcceptancePanel, {
    props: { item, contextKey },
  });
}

async function chooseFile(
  wrapper: ReturnType<typeof mount>,
  selector: string,
  file: File,
) {
  const input = wrapper.get(selector);
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [file],
  });
  await input.trigger('change');
  await flushPromises();
}

describe('case acceptance panel', () => {
  it('requires the actual date and court case number but allows registration without optional files', async () => {
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain('受理日期');
    expect(wrapper.text()).toContain('法院案号');
    expect(wrapper.text()).toContain('可后补');
    expect(wrapper.text()).toContain('不会发起缴费，也不会安排开庭');
    expect(
      (
        wrapper.get('[data-test="acceptance-register"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await wrapper
      .get('[data-test="acceptance-accepted-at"]')
      .setValue('2026-10-05');
    await wrapper
      .get('[data-test="acceptance-court-case-no"]')
      .setValue(' 甲0101民初1号 ');
    expect(
      (
        wrapper.get('[data-test="acceptance-register"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    await wrapper.get('[data-test="acceptance-register"]').trigger('click');
    await flushPromises();
    expect(api.registerCaseAcceptance).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({
        expectedVersion: 6,
        acceptedAt: '2026-10-05',
        courtCaseNo: '甲0101民初1号',
      }),
      'internal',
    );
    expect(wrapper.text()).toContain('正式立案登记已完成');
    expect(wrapper.emitted('changed')).toHaveLength(1);
    expect(wrapper.emitted('refresh')).toBeUndefined();
    expect(workflowRefreshCount).toBe(1);
  });

  it('keeps the same idempotent request after an unknown result and retries it unchanged', async () => {
    api.registerCaseAcceptance
      .mockRejectedValueOnce(new ApiError('timeout', 0, 'TIMEOUT'))
      .mockResolvedValueOnce({
        id: 'case-1',
        stage: 'WAITING_HEARING',
        version: 7,
        acceptedAt: '2026-10-05',
        courtCaseNo: '甲0101民初1号',
        recordedAt: '2026-10-06T01:00:00.000Z',
      });
    const wrapper = mountPanel();
    await wrapper
      .get('[data-test="acceptance-accepted-at"]')
      .setValue('2026-10-05');
    await wrapper
      .get('[data-test="acceptance-court-case-no"]')
      .setValue('甲0101民初1号');
    expect(
      (
        wrapper.get('[data-test="acceptance-register"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    await wrapper.get('[data-test="acceptance-register"]').trigger('click');
    await flushPromises();
    expect(api.registerCaseAcceptance).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('登记结果暂时未知');
    const original = api.registerCaseAcceptance.mock.calls[0];
    await wrapper.get('[data-test="acceptance-retry"]').trigger('click');
    await flushPromises();
    expect(api.registerCaseAcceptance).toHaveBeenCalledTimes(2);
    expect(api.registerCaseAcceptance.mock.calls[1]).toEqual(original);
  });

  it.each(['version-selected', 'version-other'])(
    'keeps an unknown request after a same-value registration with frozen %s is observed',
    async (frozenVersionId) => {
      api.registerCaseAcceptance
        .mockRejectedValueOnce(new ApiError('timeout', 0, 'TIMEOUT'))
        .mockRejectedValueOnce(
          new ApiError('changed', 409, 'VERSION_CONFLICT'),
        );
      const selectedFile = {
        materialId: 'material-selected',
        contentVersionId: 'version-selected',
        originalFilename: '本次选择.pdf',
        mimeType: 'application/pdf',
      };
      const item: TestItem = {
        ...baseItem,
        acceptanceMaterials: {
          ...baseItem.acceptanceMaterials,
          ACCEPTANCE_NOTICE: {
            available: [selectedFile],
            frozen: [],
            later: [],
          },
        },
      };
      const wrapper = mountPanel(item);
      await wrapper
        .get('[data-test="acceptance-accepted-at"]')
        .setValue('2026-10-05');
      await wrapper
        .get('[data-test="acceptance-court-case-no"]')
        .setValue('甲0101民初1号');
      await wrapper.get('input[type="checkbox"]').setValue(true);
      await wrapper.get('[data-test="acceptance-register"]').trigger('click');
      await flushPromises();
      const originalRequest = api.registerCaseAcceptance.mock.calls[0];
      expect(originalRequest?.[1].acceptanceNoticeContentVersionIds).toEqual([
        'version-selected',
      ]);

      const observed: TestItem = {
        ...item,
        stage: 'WAITING_HEARING',
        version: 7,
        canRegisterAcceptance: false,
        acceptance: {
          acceptedAt: '2026-10-05',
          courtCaseNo: '甲0101民初1号',
          recordedAt: '2026-10-06T01:00:00.000Z',
        },
        acceptanceMaterials: {
          ...item.acceptanceMaterials,
          ACCEPTANCE_NOTICE: {
            available: [],
            frozen: [{ ...selectedFile, contentVersionId: frozenVersionId }],
            later: [],
          },
        },
      };
      await wrapper.setProps({ item: observed });
      expect(wrapper.text()).toContain('本次提交结果尚未确认');
      expect(wrapper.text()).not.toContain('正式立案登记已完成');
      expect(wrapper.find('[data-test="acceptance-retry"]').exists()).toBe(
        true,
      );
      expect(wrapper.emitted('changed')).toBeUndefined();
      expect(workflowRefreshCount).toBe(1);
      await wrapper.setProps({ item: { ...observed } });
      expect(workflowRefreshCount).toBe(1);

      await wrapper.get('[data-test="acceptance-retry"]').trigger('click');
      await flushPromises();
      expect(api.registerCaseAcceptance.mock.calls[1]).toEqual(originalRequest);
      expect(wrapper.text()).toContain('案件阶段或版本已变化');
      expect(wrapper.text()).not.toContain('正式立案登记已完成');
      wrapper.unmount();
    },
  );

  it('refreshes workflow counts when a hearing record is observed before the POST becomes unknown', async () => {
    let rejectRegistration!: () => void;
    api.registerCaseAcceptance.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectRegistration = () =>
          reject(new ApiError('timeout', 0, 'TIMEOUT'));
      }),
    );
    const wrapper = mountPanel();
    await wrapper
      .get('[data-test="acceptance-accepted-at"]')
      .setValue('2026-10-05');
    await wrapper
      .get('[data-test="acceptance-court-case-no"]')
      .setValue('甲0101民初1号');
    await wrapper.get('[data-test="acceptance-register"]').trigger('click');
    await wrapper.setProps({
      item: {
        ...baseItem,
        stage: 'WAITING_HEARING',
        version: 7,
        canRegisterAcceptance: false,
        acceptance: {
          acceptedAt: '2026-10-05',
          courtCaseNo: '甲0101民初1号',
          recordedAt: '2026-10-06T01:00:00.000Z',
        },
      },
    });
    rejectRegistration();
    await flushPromises();
    expect(workflowRefreshCount).toBe(1);
    expect(wrapper.find('[data-test="acceptance-retry"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('本次提交结果尚未确认');
    expect(wrapper.emitted('changed')).toBeUndefined();
    wrapper.unmount();
  });

  it('ignores a material upload that completes after the active account changes', async () => {
    let resolveUpload!: (value: {
      materialId: string;
      contentVersionId: string;
      originalFilename: string;
      mimeType: string;
    }) => void;
    api.uploadMaterialFile.mockReturnValueOnce(
      new Promise((resolve) => (resolveUpload = resolve)),
    );
    const wrapper = mountPanel();
    await chooseFile(
      wrapper,
      '[data-test="acceptance-material-input-ACCEPTANCE_NOTICE"]',
      new File(['notice'], '受理通知.pdf', { type: 'application/pdf' }),
    );
    await wrapper.setProps({ contextKey: 'INTERNAL:user-2:1' });
    resolveUpload({
      materialId: 'material-late',
      contentVersionId: 'version-late',
      originalFilename: '迟到.pdf',
      mimeType: 'application/pdf',
    });
    await flushPromises();
    expect(wrapper.text()).not.toContain('迟到.pdf');
  });

  it('moves a just-uploaded local file out of available when the server marks it later', async () => {
    const wrapper = mountPanel();
    await chooseFile(
      wrapper,
      '[data-test="acceptance-material-input-ACCEPTANCE_NOTICE"]',
      new File(['notice'], '后补通知.pdf', { type: 'application/pdf' }),
    );
    const laterFile = {
      materialId: 'material-后补通知.pdf',
      contentVersionId: 'version-后补通知.pdf',
      originalFilename: '后补通知.pdf',
      mimeType: 'application/pdf',
    };
    await wrapper.setProps({
      item: {
        ...baseItem,
        stage: 'WAITING_HEARING',
        canRegisterAcceptance: false,
        acceptance: {
          acceptedAt: '2026-10-05',
          courtCaseNo: '甲0101民初1号',
          recordedAt: '2026-10-06T01:00:00.000Z',
        },
        acceptanceMaterials: {
          ...baseItem.acceptanceMaterials,
          ACCEPTANCE_NOTICE: {
            available: [],
            frozen: [],
            later: [laterFile],
          },
        },
      },
    });

    const later = wrapper
      .findAll('h4')
      .find((heading) => heading.text().includes('受理后补传材料'));
    expect(later).toBeDefined();
    expect(
      wrapper
        .findAll('li')
        .filter((item) => item.text().includes('后补通知.pdf')),
    ).toHaveLength(1);
    expect(later!.element.nextElementSibling?.textContent).toContain(
      '后补通知.pdf',
    );
  });

  it('preserves entered acceptance details and selection when the same case refreshes', async () => {
    const availableFile = {
      materialId: 'material-available',
      contentVersionId: 'version-available',
      originalFilename: '未选通知.pdf',
      mimeType: 'application/pdf',
    };
    const item = {
      ...baseItem,
      acceptanceMaterials: {
        ...baseItem.acceptanceMaterials,
        ACCEPTANCE_NOTICE: {
          available: [availableFile],
          frozen: [],
          later: [],
        },
      },
    } satisfies TestItem;
    const wrapper = mountPanel(item);
    await wrapper
      .get('[data-test="acceptance-accepted-at"]')
      .setValue('2026-10-05');
    await wrapper
      .get('[data-test="acceptance-court-case-no"]')
      .setValue('甲0101民初2号');
    await wrapper.get('input[type="checkbox"]').setValue(true);

    await wrapper.setProps({
      item: {
        ...item,
        acceptanceMaterials: {
          ...item.acceptanceMaterials,
          ACCEPTANCE_NOTICE: {
            available: [availableFile],
            frozen: [],
            later: [],
          },
        },
      },
    });

    expect(
      (
        wrapper.get('[data-test="acceptance-court-case-no"]')
          .element as HTMLInputElement
      ).value,
    ).toBe('甲0101民初2号');
    expect(
      (wrapper.get('input[type="checkbox"]').element as HTMLInputElement)
        .checked,
    ).toBe(true);
  });
});
