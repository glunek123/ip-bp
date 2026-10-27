import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
const casesApi = vi.hoisted(() => ({ getExternalEntryOptions: vi.fn() }));
const csvApi = vi.hoisted(() => ({
  getCaseCsvImportTemplate: vi.fn(),
  previewCaseCsvImport: vi.fn(),
  commitCaseCsvImport: vi.fn(),
}));
vi.mock('../../api/cases', async (original) => ({
  ...(await original<typeof import('../../api/cases')>()),
  getExternalEntryOptions: casesApi.getExternalEntryOptions,
}));
vi.mock('../../api/case-csv-import', () => ({
  getCaseCsvImportTemplate: csvApi.getCaseCsvImportTemplate,
  previewCaseCsvImport: csvApi.previewCaseCsvImport,
  commitCaseCsvImport: csvApi.commitCaseCsvImport,
}));
vi.mock('../../app/OperationDrawer.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      props: { open: Boolean, title: String, locked: Boolean },
      setup(props, { slots }) {
        return () =>
          props.open
            ? h('section', { role: 'dialog', 'aria-label': props.title }, [
                slots.default?.(),
                h('footer', slots.footer?.()),
              ])
            : null;
      },
    }),
  };
});
import CaseCsvImportPanel from './CaseCsvImportPanel.vue';
import { ApiError } from '../../api/http';
const customerId = '11111111-1111-4111-8111-111111111111';
const holderId = '22222222-2222-4222-8222-222222222222';
const options = {
  canCreate: true,
  canCreateArchived: true,
  currentUser: { id: 'user-1', displayName: '运营甲' },
  customers: [
    {
      id: customerId,
      name: '客户甲',
      rightsHolders: [{ id: holderId, name: '权利主体乙' }],
    },
  ],
  lawyers: [],
  dictionaries: {
    stages: [],
    courts: [],
    platforms: [],
    caseTypes: [],
    infringementTypes: [],
  },
};
const preview = {
  rows: [
    {
      rowNumber: 2,
      valid: true,
      errors: [],
      input: { customerId, rightsHolderId: holderId, initialStage: 'ARCHIVED' },
    },
  ],
  validCount: 1,
  errorCount: 0,
};
const wrappers: ReturnType<typeof mount>[] = [];
async function chooseFile(wrapper: ReturnType<typeof mount>): Promise<void> {
  const file = new File(['csv'], 'cases.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode('csv').buffer,
  });
  const input = wrapper.get('input[type="file"]');
  Object.defineProperty(input.element, 'files', { value: [file] });
  await input.trigger('change');
}
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.resetAllMocks();
});
function panel() {
  const wrapper = mount(CaseCsvImportPanel, {
    props: {
      open: true,
      contextKey: 'session-1:user-1:department-1',
      identityKey: 'user-1:department-1',
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}
describe('case CSV import panel', () => {
  it('shows customer names rather than internal IDs and commits selected rows', async () => {
    casesApi.getExternalEntryOptions.mockResolvedValue(options);
    csvApi.previewCaseCsvImport.mockResolvedValue(preview);
    csvApi.commitCaseCsvImport.mockResolvedValue({
      items: [
        {
          rowNumber: 2,
          id: customerId,
          businessNo: '00120261026001',
          stage: 'ARCHIVED',
          version: 1,
          entryId: holderId,
          recordedAt: '2026-10-26T00:00:00Z',
        },
      ],
    });
    const wrapper = panel();
    await flushPromises();
    expect(wrapper.text()).toContain('被告类型');
    expect(wrapper.text()).toContain('中文分号');
    const chooseButton = wrapper.get('[data-test="choose-case-csv-file"]');
    expect(chooseButton.text()).toBe('选择文件');
    const nativePicker = vi
      .spyOn(
        wrapper.get('input[type="file"]').element as HTMLInputElement,
        'click',
      )
      .mockImplementation(() => {});
    await chooseButton.trigger('click');
    expect(nativePicker).toHaveBeenCalledOnce();
    await chooseFile(wrapper);
    await flushPromises();
    expect(chooseButton.text()).toBe('更换文件');
    expect(wrapper.text()).toContain('cases.csv');
    expect(wrapper.text()).toContain('客户甲');
    expect(wrapper.text()).toContain('权利主体乙');
    expect(wrapper.text()).not.toContain(customerId);
    await wrapper.get('[data-test="commit-case-csv"]').trigger('click');
    await flushPromises();
    expect(csvApi.commitCaseCsvImport).toHaveBeenCalledWith(
      expect.objectContaining({
        rowNumbers: [2],
        idempotencyKey: expect.any(String),
        duplicateConfirmations: [],
      }),
    );
    expect(wrapper.text()).toContain('00120261026001');
  });
  it('ignores empty duplicate candidates and commits only nonempty candidate confirmations', async () => {
    const caseCandidate = {
      id: '33333333-3333-4333-8333-333333333333',
      businessNo: 'CA-20261026-0003',
    };
    casesApi.getExternalEntryOptions.mockResolvedValue(options);
    csvApi.previewCaseCsvImport.mockResolvedValue({
      rows: [
        {
          ...preview.rows[0],
          duplicateCandidates: { cases: [], rowNumbers: [] },
        },
        {
          ...preview.rows[0],
          rowNumber: 3,
          duplicateCandidates: { cases: [caseCandidate], rowNumbers: [] },
        },
        {
          ...preview.rows[0],
          rowNumber: 4,
          duplicateCandidates: { cases: [], rowNumbers: [7] },
        },
      ],
      validCount: 3,
      errorCount: 0,
    });
    csvApi.commitCaseCsvImport.mockResolvedValue({ items: [] });

    const wrapper = panel();
    await flushPromises();
    await chooseFile(wrapper);
    await flushPromises();
    expect(wrapper.find('[aria-label="确认CSV第2行重复候选"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).toContain('未发现疑似重复');
    expect(wrapper.find('[aria-label="确认CSV第3行重复候选"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[aria-label="确认CSV第4行重复候选"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.get('[data-test="commit-case-csv"]').attributes('disabled'),
    ).toBeDefined();

    await wrapper.get('[aria-label="确认CSV第3行重复候选"]').setValue(true);
    await wrapper.get('[aria-label="确认CSV第4行重复候选"]').setValue(true);
    await wrapper.get('[data-test="commit-case-csv"]').trigger('click');
    await flushPromises();

    expect(csvApi.commitCaseCsvImport).toHaveBeenCalledWith(
      expect.objectContaining({
        rowNumbers: [2, 3, 4],
        duplicateConfirmations: [
          {
            rowNumber: 3,
            caseIds: [caseCandidate.id],
            rowNumbers: [],
          },
          { rowNumber: 4, caseIds: [], rowNumbers: [7] },
        ],
      }),
    );
  });
  it('keeps the original CSV, row selection and idempotency key for explicit retry', async () => {
    casesApi.getExternalEntryOptions.mockResolvedValue(options);
    csvApi.previewCaseCsvImport.mockResolvedValue(preview);
    csvApi.commitCaseCsvImport
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ items: [] });
    const wrapper = panel();
    await flushPromises();
    await chooseFile(wrapper);
    await flushPromises();
    await wrapper.get('[data-test="commit-case-csv"]').trigger('click');
    await flushPromises();
    const original = csvApi.commitCaseCsvImport.mock.calls[0]?.[0];
    expect(
      wrapper.get('[data-test="choose-case-csv-file"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.setProps({ contextKey: 'session-2:user-1:department-1' });
    await wrapper.get('[data-test="commit-case-csv"]').trigger('click');
    await flushPromises();
    expect(csvApi.commitCaseCsvImport.mock.calls[1]?.[0]).toEqual(original);
  });

  it('hides an unknown import from another identity and ignores its late response', async () => {
    casesApi.getExternalEntryOptions.mockResolvedValue(options);
    csvApi.previewCaseCsvImport.mockResolvedValue(preview);
    let resolveFirst!: (value: { items: [] }) => void;
    csvApi.commitCaseCsvImport
      .mockImplementationOnce(
        () =>
          new Promise<{ items: [] }>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ items: [] });
    const wrapper = panel();
    await flushPromises();
    await chooseFile(wrapper);
    await flushPromises();
    await wrapper.get('[data-test="commit-case-csv"]').trigger('click');
    const original = csvApi.commitCaseCsvImport.mock.calls[0]?.[0];

    await wrapper.setProps({
      contextKey: 'session-2:user-2:department-2',
      identityKey: 'user-2:department-2',
    });
    expect(wrapper.find('.csv-import-panel').exists()).toBe(false);
    expect(wrapper.get('.pending-owner-notice').text()).toContain(
      '请返回原账号核实',
    );
    expect(wrapper.text()).not.toContain('客户甲');
    expect(wrapper.find('[data-test="commit-case-csv"]').exists()).toBe(false);
    resolveFirst({ items: [] });
    await flushPromises();
    expect(wrapper.emitted('completed')).toBeUndefined();
    expect(csvApi.commitCaseCsvImport).toHaveBeenCalledTimes(1);

    await wrapper.setProps({
      contextKey: 'session-3:user-1:department-1',
      identityKey: 'user-1:department-1',
    });
    expect(wrapper.get('[data-test="commit-case-csv"]').text()).toContain(
      '核实原请求',
    );
    await wrapper.get('[data-test="commit-case-csv"]').trigger('click');
    await flushPromises();
    expect(csvApi.commitCaseCsvImport.mock.calls[1]?.[0]).toEqual(original);
  });
  it('does not offer another identity the original unknown CSV request', async () => {
    casesApi.getExternalEntryOptions.mockResolvedValue(options);
    csvApi.previewCaseCsvImport.mockResolvedValue(preview);
    csvApi.commitCaseCsvImport
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ items: [] });
    const wrapper = panel();
    await flushPromises();
    await chooseFile(wrapper);
    await flushPromises();
    await wrapper.get('[data-test="commit-case-csv"]').trigger('click');
    await flushPromises();
    const original = csvApi.commitCaseCsvImport.mock.calls[0]?.[0];

    await wrapper.setProps({
      contextKey: 'session-2:user-2:department-2',
      identityKey: 'user-2:department-2',
    });
    expect(wrapper.find('.csv-import-panel').exists()).toBe(false);
    await wrapper.get('[data-test="close-case-csv"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(csvApi.commitCaseCsvImport).toHaveBeenCalledTimes(1);
    await wrapper.setProps({
      contextKey: 'session-3:user-1:department-1',
      identityKey: 'user-1:department-1',
    });
    await wrapper.get('[data-test="commit-case-csv"]').trigger('click');
    await flushPromises();
    expect(csvApi.commitCaseCsvImport.mock.calls[1]?.[0]).toEqual(original);
  });

  it('requires per-row confirmation of current duplicate candidates and re-previews after a 409', async () => {
    const firstCandidate = {
      id: '33333333-3333-4333-8333-333333333333',
      businessNo: 'CA-20261026-0003',
    };
    const changedCandidate = {
      id: '44444444-4444-4444-8444-444444444444',
      businessNo: 'CA-20261026-0004',
    };
    casesApi.getExternalEntryOptions.mockResolvedValue(options);
    csvApi.previewCaseCsvImport
      .mockResolvedValueOnce({
        ...preview,
        rows: [
          {
            ...preview.rows[0],
            duplicateCandidates: {
              cases: [firstCandidate],
              rowNumbers: [6],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        ...preview,
        rows: [
          {
            ...preview.rows[0],
            duplicateCandidates: {
              cases: [firstCandidate, changedCandidate],
              rowNumbers: [6, 7],
            },
          },
        ],
      });
    csvApi.commitCaseCsvImport
      .mockRejectedValueOnce(
        new ApiError(
          '候选变化',
          409,
          'CASE_CSV_DUPLICATES_CHANGED',
          undefined,
          {
            rowNumber: 2,
            duplicateCandidates: {
              cases: [changedCandidate],
              rowNumbers: [7],
            },
          },
        ),
      )
      .mockResolvedValueOnce({ items: [] });

    const wrapper = panel();
    await flushPromises();
    await chooseFile(wrapper);
    await flushPromises();
    const confirm = () => wrapper.get('[aria-label="确认CSV第2行重复候选"]');
    expect(wrapper.text()).toContain(firstCandidate.businessNo);
    expect(wrapper.text()).toContain('6');
    expect(wrapper.text()).not.toContain(firstCandidate.id);
    expect((confirm().element as HTMLInputElement).checked).toBe(false);
    expect(
      wrapper.get('[data-test="commit-case-csv"]').attributes('disabled'),
    ).toBeDefined();

    await confirm().setValue(true);
    await wrapper.get('[data-test="commit-case-csv"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('重新预览并核对候选');
    expect(wrapper.find('[data-test="refresh-csv-preview"]').exists()).toBe(
      true,
    );

    await wrapper.get('[data-test="refresh-csv-preview"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain(changedCandidate.businessNo);
    expect(wrapper.text()).toContain('6、7');
    expect((confirm().element as HTMLInputElement).checked).toBe(false);
    expect(
      wrapper.get('[data-test="commit-case-csv"]').attributes('disabled'),
    ).toBeDefined();

    await confirm().setValue(true);
    await wrapper.get('[data-test="commit-case-csv"]').trigger('click');
    await flushPromises();
    const originalRequest = csvApi.commitCaseCsvImport.mock.calls[0]?.[0];
    const reissuedRequest = csvApi.commitCaseCsvImport.mock.calls[1]?.[0];
    expect(reissuedRequest).toMatchObject({
      rowNumbers: [2],
      duplicateConfirmations: [
        {
          rowNumber: 2,
          caseIds: [firstCandidate.id, changedCandidate.id],
          rowNumbers: [6, 7],
        },
      ],
    });
    expect(reissuedRequest?.idempotencyKey).not.toBe(
      originalRequest?.idempotencyKey,
    );
  });
});
