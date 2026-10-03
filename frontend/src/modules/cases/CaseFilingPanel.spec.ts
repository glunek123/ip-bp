import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import type { CaseDetail } from '../../api/cases';
import CaseFilingPanel from './CaseFilingPanel.vue';

const api = vi.hoisted(() => ({
  listFilingCourts: vi.fn(),
  createFilingCourt: vi.fn(),
  submitCaseFiling: vi.fn(),
  uploadMaterialFile: vi.fn(),
  downloadMaterialVersion: vi.fn(),
  todayShanghai: vi.fn(() => '2026-10-03'),
}));
vi.mock('../../api/cases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/cases')>()),
  listFilingCourts: api.listFilingCourts,
  createFilingCourt: api.createFilingCourt,
  submitCaseFiling: api.submitCaseFiling,
  todayShanghai: api.todayShanghai,
}));
vi.mock('../../api/materials', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/materials')>()),
  uploadMaterialFile: api.uploadMaterialFile,
  downloadMaterialVersion: api.downloadMaterialVersion,
}));

const court = {
  id: '70000000-0000-4000-8000-000000000031',
  name: '甲市中级人民法院',
};
const baseItem = {
  id: 'case-1',
  stage: 'WAITING_FILING',
  version: 5,
  canSubmitFiling: true,
} as unknown as CaseDetail;

beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  api.todayShanghai.mockReturnValue('2026-10-03');
  api.listFilingCourts.mockResolvedValue([court]);
  api.createFilingCourt.mockImplementation(async (_id, input) => ({
    id: '70000000-0000-4000-8000-000000000032',
    name: input.name.trim(),
  }));
  api.submitCaseFiling.mockResolvedValue({
    stage: 'WAITING_FORMAL_ACCEPTANCE',
    version: 6,
  });
  api.uploadMaterialFile.mockImplementation(async ({ category, file }) => ({
    materialId: `material-${file.name}`,
    contentVersionId: `version-${file.name}`,
    originalFilename: file.name,
    mimeType: file.type,
    purpose: category,
  }));
});

function mountPanel(item = baseItem, contextKey = 'INTERNAL:user-1:1') {
  return mount(CaseFilingPanel, {
    props: { item, contextKey },
    global: { plugins: [createPinia()] },
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

describe('case filing panel', () => {
  it('automatically selects a single court and requires date and evidence before review', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    expect(api.listFilingCourts).toHaveBeenCalledWith('case-1');
    expect(
      wrapper.get('[data-test="filing-court-fixed"]').element,
    ).toMatchObject({
      value: court.id,
    });
    const review = wrapper.get('[data-test="filing-review"]');
    expect((review.element as HTMLButtonElement).disabled).toBe(true);
    await chooseFile(
      wrapper,
      '[data-test="filing-evidence-input"]',
      new File(['evidence'], '起诉状.pdf', { type: 'application/pdf' }),
    );
    expect((review.element as HTMLButtonElement).disabled).toBe(false);
    await review.trigger('click');
    await wrapper.get('[data-test="filing-submit"]').trigger('click');
    await flushPromises();
    expect(api.submitCaseFiling.mock.calls[0]?.[1]).toMatchObject({
      courtId: court.id,
    });
  });

  it('requires an explicit choice when multiple courts are returned', async () => {
    api.listFilingCourts.mockResolvedValueOnce([
      court,
      {
        id: '70000000-0000-4000-8000-000000000033',
        name: '乙市中级人民法院',
      },
    ]);
    const wrapper = mountPanel();
    await flushPromises();
    const select = wrapper.get('[data-test="filing-court-select"]');
    expect((select.element as HTMLSelectElement).value).toBe('');
    await select.setValue(court.id);
    expect((select.element as HTMLSelectElement).value).toBe(court.id);
  });

  it('registers a real court through the API and selects the returned stable id', async () => {
    api.listFilingCourts.mockResolvedValueOnce([]);
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper
      .get('[data-test="filing-court-name"]')
      .setValue('  丙市中级人民法院  ');
    await wrapper.get('[data-test="filing-court-create"]').trigger('click');
    await flushPromises();
    expect(api.createFilingCourt).toHaveBeenCalledWith('case-1', {
      name: '  丙市中级人民法院  ',
    });
    expect(
      wrapper.get('[data-test="filing-court-fixed"]').element,
    ).toMatchObject({
      value: '70000000-0000-4000-8000-000000000032',
    });
    await chooseFile(
      wrapper,
      '[data-test="filing-evidence-input"]',
      new File(['evidence'], '起诉状.pdf', { type: 'application/pdf' }),
    );
    await wrapper.get('[data-test="filing-review"]').trigger('click');
    await wrapper.get('[data-test="filing-submit"]').trigger('click');
    await flushPromises();
    expect(api.submitCaseFiling.mock.calls[0]?.[1]).toMatchObject({
      courtId: '70000000-0000-4000-8000-000000000032',
    });
  });

  it('retains the exact unknown request and idempotency key for retry', async () => {
    api.submitCaseFiling
      .mockRejectedValueOnce(new ApiError('timeout', 0, 'TIMEOUT'))
      .mockResolvedValueOnce({
        stage: 'WAITING_FORMAL_ACCEPTANCE',
        version: 6,
      });
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper
      .get('[data-test="filing-submitted-at"]')
      .setValue('2026-10-03');
    await wrapper.get('[data-test="filing-mediation-no"]').setValue('诉调-001');
    await chooseFile(
      wrapper,
      '[data-test="filing-evidence-input"]',
      new File(['evidence'], '起诉状.pdf', { type: 'application/pdf' }),
    );
    await wrapper.get('[data-test="filing-review"]').trigger('click');
    await wrapper.get('[data-test="filing-submit"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('提交结果暂时未知');
    const original = api.submitCaseFiling.mock.calls[0];
    await wrapper.get('[data-test="filing-retry"]').trigger('click');
    await flushPromises();
    expect(api.submitCaseFiling).toHaveBeenCalledTimes(2);
    expect(api.submitCaseFiling.mock.calls[1]).toEqual(original);
  });

  it.each([
    ['server error', new ApiError('server failed', 503, 'INTERNAL_ERROR')],
    ['invalid response', new ApiError('bad response', 201, 'INVALID_RESPONSE')],
    ['unexpected failure', new Error('connection closed')],
  ])(
    'locks and retries the same request after an unknown %s result',
    async (_label, failure) => {
      api.submitCaseFiling
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce({
          stage: 'WAITING_FORMAL_ACCEPTANCE',
          version: 6,
        });
      const wrapper = mountPanel();
      await flushPromises();
      await chooseFile(
        wrapper,
        '[data-test="filing-evidence-input"]',
        new File(['evidence'], '起诉状.pdf', { type: 'application/pdf' }),
      );
      await wrapper.get('[data-test="filing-review"]').trigger('click');
      await wrapper.get('[data-test="filing-submit"]').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('提交结果暂时未知');
      expect(
        (
          wrapper.get('[data-test="filing-evidence-input"]')
            .element as HTMLInputElement
        ).disabled,
      ).toBe(true);
      expect(wrapper.find('[data-test="filing-review"]').exists()).toBe(false);
      const original = api.submitCaseFiling.mock.calls[0];
      await wrapper.get('[data-test="filing-retry"]').trigger('click');
      await flushPromises();
      expect(api.submitCaseFiling).toHaveBeenCalledTimes(2);
      expect(api.submitCaseFiling.mock.calls[1]).toEqual(original);
    },
  );

  it('ignores an upload that completes after the case context changes', async () => {
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
    await flushPromises();
    await chooseFile(
      wrapper,
      '[data-test="filing-evidence-input"]',
      new File(['late'], 'late.pdf', { type: 'application/pdf' }),
    );
    await wrapper.setProps({
      item: { ...baseItem, id: 'case-2' },
      contextKey: 'INTERNAL:user-1:2',
    });
    resolveUpload({
      materialId: 'late-material',
      contentVersionId: 'late-version',
      originalFilename: 'late.pdf',
      mimeType: 'application/pdf',
    });
    await flushPromises();
    expect(wrapper.text()).not.toContain('late.pdf');
  });
});
