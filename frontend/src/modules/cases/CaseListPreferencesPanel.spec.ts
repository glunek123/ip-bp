import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CaseListPreferencesPanel from './CaseListPreferencesPanel.vue';

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('../../api/case-list-preference', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/case-list-preference')>()),
  getCaseListPreference: api.get,
  saveCaseListPreference: api.save,
}));

const defaults = {
  order: [
    'businessNo',
    'stage',
    'customerName',
    'rightsHolderName',
    'platform',
    'shopName',
    'shopExternalId',
    'defendants',
    'lawyers',
    'court',
    'courtCaseNo',
    'claimAmount',
    'judgmentAmount',
    'closureAmount',
  ],
  hidden: [] as string[],
};

function mountPanel() {
  return mount(CaseListPreferencesPanel, {
    props: { bucket: 'all', requestGeneration: 'session-1' },
  });
}

async function clickButton(wrapper: ReturnType<typeof mount>, label: string) {
  await wrapper
    .findAll('button')
    .find((button) => button.text().includes(label))!
    .trigger('click');
}

beforeEach(() => {
  vi.resetAllMocks();
  api.get.mockResolvedValue(defaults);
  api.save.mockResolvedValue(defaults);
});

describe('CaseListPreferencesPanel', () => {
  it('keeps restore-default and cancel as draft-only actions', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-column-settings"]').trigger('click');
    await clickButton(wrapper, '恢复默认');
    await clickButton(wrapper, '取消');
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.save).not.toHaveBeenCalled();
    expect(wrapper.get('[role="status"]').text()).toBe('');
  });

  it('sends the edited complete order through the real preference API module', async () => {
    const saved = {
      order: [...defaults.order].reverse(),
      hidden: ['courtCaseNo'],
    };
    api.save.mockResolvedValue(saved);
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-column-settings"]').trigger('click');
    await wrapper.get('button[aria-label="客户下移"]').trigger('click');
    await clickButton(wrapper, '保存');
    await flushPromises();
    expect(api.save).toHaveBeenCalledWith(
      'all',
      expect.objectContaining({ hidden: [] }),
      { signal: expect.any(AbortSignal) },
    );
    expect(api.save.mock.calls[0]?.[1].order.slice(2, 4)).toEqual([
      'rightsHolderName',
      'customerName',
    ]);
    expect(wrapper.get('[role="status"]').text()).toBe('已保存');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it('keeps a failed or unknown save visibly unconfirmed and leaves the draft open', async () => {
    api.save.mockRejectedValue(new Error('unknown outcome'));
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-column-settings"]').trigger('click');
    await clickButton(wrapper, '保存');
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain('未确认保存');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
  });

  it('ignores a late GET after a same-identity session replacement', async () => {
    let finishOld!: (value: typeof defaults) => void;
    api.get
      .mockImplementationOnce(
        () => new Promise<typeof defaults>((resolve) => (finishOld = resolve)),
      )
      .mockResolvedValueOnce({ ...defaults, hidden: ['courtCaseNo'] });
    const wrapper = mountPanel();
    await wrapper.setProps({ requestGeneration: 'session-2' });
    await flushPromises();
    finishOld({ ...defaults, hidden: ['customerName'] });
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toBe('');
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('loads preferences again when the process bucket changes', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.setProps({ bucket: 'WAITING_ARCHIVE' });
    await flushPromises();
    expect(api.get).toHaveBeenNthCalledWith(1, 'all', {
      signal: expect.any(AbortSignal),
    });
    expect(api.get).toHaveBeenNthCalledWith(2, 'WAITING_ARCHIVE', {
      signal: expect.any(AbortSignal),
    });
  });

  it('allows a new-bucket save while the old PUT is pending and ignores its late success', async () => {
    let finishOldSave!: (value: typeof defaults) => void;
    api.save
      .mockImplementationOnce(
        () =>
          new Promise<typeof defaults>((resolve) => (finishOldSave = resolve)),
      )
      .mockResolvedValueOnce(defaults);
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="open-column-settings"]').trigger('click');
    await clickButton(wrapper, '保存');
    await wrapper.setProps({ bucket: 'ARCHIVED' });
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    await wrapper.get('[data-test="open-column-settings"]').trigger('click');
    await clickButton(wrapper, '保存');
    await flushPromises();
    expect(api.save).toHaveBeenNthCalledWith(
      2,
      'ARCHIVED',
      expect.any(Object),
      { signal: expect.any(AbortSignal) },
    );
    expect(wrapper.get('[role="status"]').text()).toBe('已保存');
    finishOldSave({ ...defaults, hidden: ['customerName'] });
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toBe('已保存');
  });

  it('aborts outstanding GET and PUT requests when the panel unmounts', async () => {
    let finishGet!: (value: typeof defaults) => void;
    api.get.mockImplementationOnce(
      () => new Promise<typeof defaults>((resolve) => (finishGet = resolve)),
    );
    const getWrapper = mountPanel();
    const getSignal = api.get.mock.calls[0]![1].signal as AbortSignal;
    getWrapper.unmount();
    expect(getSignal.aborted).toBe(true);
    finishGet(defaults);
    await flushPromises();

    let finishSave!: (value: typeof defaults) => void;
    api.save.mockImplementationOnce(
      () => new Promise<typeof defaults>((resolve) => (finishSave = resolve)),
    );
    const saveWrapper = mountPanel();
    await flushPromises();
    await saveWrapper
      .get('[data-test="open-column-settings"]')
      .trigger('click');
    await clickButton(saveWrapper, '保存');
    const saveSignal = api.save.mock.calls[0]![2].signal as AbortSignal;
    saveWrapper.unmount();
    expect(saveSignal.aborted).toBe(true);
    finishSave(defaults);
    await flushPromises();
  });
});
