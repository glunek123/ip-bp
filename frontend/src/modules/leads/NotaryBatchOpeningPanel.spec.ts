import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotaryMatterDetail } from '../../api/notary';
import NotaryBatchOpeningPanel from './NotaryBatchOpeningPanel.vue';

const api = vi.hoisted(() => ({ get: vi.fn(), failRecoveryOnce: false }));
vi.mock('../../api/notary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/notary')>()),
  getNotaryMatter: api.get,
}));
vi.mock('./NotaryMatterWorkflowPanel.vue', async () => {
  const vue = await import('vue');
  return {
    default: vue.defineComponent({
      emits: ['failed'],
      props: {
        detail: { type: Object, required: true },
        session: { type: Object, required: true },
      },
      setup(props, { emit }) {
        vue.onMounted(() => {
          const detail = props.detail as { id: string };
          const session = props.session as { restoreUnknown: () => boolean };
          let found = false;
          for (let index = 0; index < sessionStorage.length; index += 1) {
            const key = sessionStorage.key(index);
            if (!key?.startsWith('notary-list-request:')) continue;
            try {
              const tuple: unknown = JSON.parse(
                key.slice('notary-list-request:'.length),
              );
              if (
                Array.isArray(tuple) &&
                tuple.length === 3 &&
                typeof tuple[0] === 'string' &&
                tuple[0].split(':').slice(0, 3).join(':') ===
                  actorKey.split(':').slice(0, 3).join(':') &&
                tuple[1] === detail.id &&
                tuple[2] === 'opening-form'
              )
                found = true;
            } catch {
              /* malformed slots are handled by the real workflow panel */
            }
          }
          if (found) session.restoreUnknown();
        });
        return () =>
          vue.h('div', [
            vue.h(
              'button',
              {
                'data-test': 'single-submit',
                onClick: () => {
                  const session = props.session as {
                    beginSubmit: () => boolean;
                    endSubmit: (outcome: 'success') => boolean;
                  };
                  if (session.beginSubmit()) session.endSubmit('success');
                },
              },
              'submit',
            ),
            vue.h(
              'button',
              {
                'data-test': 'single-recover',
                onClick: () => {
                  const session = props.session as {
                    beginSubmit: (options: { recovery: boolean }) => boolean;
                    endSubmit: (outcome: 'success' | 'failed') => boolean;
                    deny: () => void;
                  };
                  if (session.beginSubmit({ recovery: true })) {
                    if (api.failRecoveryOnce) {
                      api.failRecoveryOnce = false;
                      session.endSubmit('failed');
                      session.deny();
                    } else {
                      session.endSubmit('success');
                    }
                  }
                },
              },
              'recover',
            ),
            vue.h(
              'button',
              {
                'data-test': 'single-fail',
                onClick: () => {
                  const session = props.session as {
                    beginSubmit: () => boolean;
                    endSubmit: (outcome: 'failed') => boolean;
                  };
                  if (session.beginSubmit()) {
                    session.endSubmit('failed');
                    emit('failed', '明确拒绝：字段不合法');
                  }
                },
              },
              'fail',
            ),
          ]);
      },
    }),
  };
});

const actorKey = 'operator-1:INTERNAL:department-1:7';
function matter(
  id: string,
  stage: NotaryMatterDetail['stage'] = 'WAITING_UNBOX',
) {
  return {
    id,
    businessNo: `NT-${id}`,
    stage,
    version: 4,
    capabilities: {
      recordOpening: stage === 'WAITING_UNBOX',
      recordEvidence: false,
      reviewOpening: false,
      decideIssuance: false,
      archiveReturn: false,
    },
  } as NotaryMatterDetail;
}
function mountPanel(matterIds: string[], currentActor = actorKey) {
  return mount(NotaryBatchOpeningPanel, {
    props: { matterIds, actorKey: currentActor },
  });
}
beforeEach(() => {
  sessionStorage.clear();
  vi.resetAllMocks();
  api.failRecoveryOnce = false;
});

describe('NotaryBatchOpeningPanel', () => {
  it('saves one selected matter at a time and requires an explicit next action', async () => {
    api.get.mockImplementation((id: string) => Promise.resolve(matter(id)));
    const wrapper = mountPanel(['matter-1', 'matter-2']);
    await flushPromises();
    expect(api.get).toHaveBeenCalledTimes(1);
    await wrapper.get('[data-test="single-submit"]').trigger('click');
    expect(wrapper.get('[data-test="opening-item-matter-1"]').text()).toContain(
      '成功',
    );
    expect(api.get).toHaveBeenCalledTimes(1);
    await wrapper.get('[data-test="batch-opening-next"]').trigger('click');
    await flushPromises();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[data-test="opening-item-matter-1"]').text()).toContain(
      '成功',
    );
  });

  it('reports successful IDs when closing after partial progress', async () => {
    api.get.mockImplementation((id: string) => Promise.resolve(matter(id)));
    const wrapper = mountPanel(['matter-1', 'matter-2']);
    await flushPromises();
    await wrapper.get('[data-test="single-submit"]').trigger('click');
    await wrapper.get('[data-test="batch-opening-next"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="batch-opening-close"]').trigger('click');
    expect(wrapper.emitted('close')?.[0]?.[0]).toEqual(['matter-1']);
    wrapper.unmount();
  });

  it('recovers an original opening request even when a fresh read shows the stage already advanced', async () => {
    const key = `notary-list-request:${JSON.stringify([actorKey, 'matter-1', 'opening-form'])}`;
    sessionStorage.setItem(
      key,
      JSON.stringify({
        command: {
          kind: 'opening',
          input: { expectedVersion: 4, contentVersionIds: ['photo-v1'] },
        },
        key: 'original-opening-key',
      }),
    );
    api.get.mockResolvedValue(matter('matter-1', 'UNBOX_REVIEW'));
    const wrapper = mountPanel(['matter-1']);
    await flushPromises();
    expect(wrapper.get('[data-test="opening-item-matter-1"]').text()).toContain(
      '未知',
    );
    await wrapper.get('[data-test="single-recover"]').trigger('click');
    expect(wrapper.get('[data-test="opening-item-matter-1"]').text()).toContain(
      '成功',
    );
    expect(
      wrapper.find('[data-test="batch-opening-close"]').attributes('disabled'),
    ).toBeUndefined();
  });

  it('keeps a recovery denial unknown and locked until fresh facts allow the original request retry', async () => {
    const key = `notary-list-request:${JSON.stringify([
      'operator-1:INTERNAL:department-1',
      'matter-1',
      'opening-form',
    ])}`;
    const frozen = {
      command: {
        kind: 'opening',
        input: { expectedVersion: 4, contentVersionIds: ['photo-v1'] },
      },
      key: 'recovery-original-key',
    };
    sessionStorage.setItem(key, JSON.stringify(frozen));
    api.failRecoveryOnce = true;
    api.get
      .mockResolvedValueOnce(matter('matter-1', 'UNBOX_REVIEW'))
      .mockResolvedValueOnce(matter('matter-1', 'WAITING_UNBOX'));
    const wrapper = mountPanel(
      ['matter-1'],
      'operator-1:INTERNAL:department-1:8',
    );
    await flushPromises();
    await wrapper.get('[data-test="single-recover"]').trigger('click');
    expect(wrapper.get('[data-test="opening-item-matter-1"]').text()).toContain(
      '未知',
    );
    expect(wrapper.text()).toContain('原请求仍未确认');
    expect(sessionStorage.getItem(key)).toBe(JSON.stringify(frozen));
    expect(
      wrapper.get('[data-test="batch-opening-close"]').attributes('disabled'),
    ).toBeDefined();
    expect(wrapper.find('[data-test="batch-opening-next"]').exists()).toBe(
      false,
    );

    await wrapper
      .get('[data-test="batch-opening-reread-unknown"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="opening-item-matter-1"]').text()).toContain(
      '未知',
    );
    expect(sessionStorage.getItem(key)).toBe(JSON.stringify(frozen));
    await wrapper.get('[data-test="single-recover"]').trigger('click');
    expect(wrapper.get('[data-test="opening-item-matter-1"]').text()).toContain(
      '成功',
    );
    expect(wrapper.emitted('completed')).toBeUndefined();
    wrapper.unmount();
  });

  it('does not finish after A succeeds when B already has an unknown opening request', async () => {
    const key = `notary-list-request:${JSON.stringify([actorKey, 'matter-2', 'opening-form'])}`;
    sessionStorage.setItem(
      key,
      JSON.stringify({
        command: {
          kind: 'opening',
          input: { expectedVersion: 4, contentVersionIds: ['photo-v2'] },
        },
        key: 'pending-b',
      }),
    );
    api.get.mockImplementation((id: string) =>
      Promise.resolve(
        matter(id, id === 'matter-2' ? 'UNBOX_REVIEW' : 'WAITING_UNBOX'),
      ),
    );
    const wrapper = mountPanel(['matter-1', 'matter-2']);
    await flushPromises();
    await wrapper.get('[data-test="single-submit"]').trigger('click');
    expect(wrapper.get('[data-test="opening-item-matter-1"]').text()).toContain(
      '成功',
    );
    await wrapper.get('[data-test="batch-opening-next"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="opening-item-matter-2"]').text()).toContain(
      '未知',
    );
    expect(wrapper.find('[data-test="batch-opening-finish"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.get('[data-test="batch-opening-close"]').attributes('disabled'),
    ).toBeDefined();
    wrapper.unmount();
  });

  it('detects the same matter pending request after authorization revision changes', async () => {
    const oldActor = 'operator-1:INTERNAL:department-1:7';
    const oldKey = `notary-list-request:${JSON.stringify([oldActor, 'matter-1', 'opening-form'])}`;
    sessionStorage.setItem(
      oldKey,
      JSON.stringify({
        command: {
          kind: 'opening',
          input: { expectedVersion: 4, contentVersionIds: ['photo-v1'] },
        },
        key: 'same-actor-key',
      }),
    );
    api.get.mockResolvedValue(matter('matter-1', 'UNBOX_REVIEW'));
    const wrapper = mountPanel(
      ['matter-1'],
      'operator-1:INTERNAL:department-1:8',
    );
    await flushPromises();
    expect(wrapper.get('[data-test="opening-item-matter-1"]').text()).toContain(
      '未知',
    );
    expect(wrapper.find('[data-test="single-recover"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('keeps an unknown item unresolved when rereading facts fails', async () => {
    const key = `notary-list-request:${JSON.stringify([actorKey, 'matter-1', 'opening-form'])}`;
    sessionStorage.setItem(
      key,
      JSON.stringify({
        command: {
          kind: 'opening',
          input: { expectedVersion: 4, contentVersionIds: ['photo-v1'] },
        },
        key: 'pending-a',
      }),
    );
    api.get
      .mockRejectedValueOnce(new Error('temporary read failure'))
      .mockResolvedValueOnce(matter('matter-1', 'UNBOX_REVIEW'));
    const wrapper = mountPanel(['matter-1']);
    await flushPromises();
    expect(wrapper.get('[data-test="opening-item-matter-1"]').text()).toContain(
      '未知',
    );
    expect(wrapper.find('[data-test="batch-opening-finish"]').exists()).toBe(
      false,
    );
    await wrapper
      .get('[data-test="batch-opening-reread-unknown"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="opening-item-matter-1"]').text()).toContain(
      '未知',
    );
    expect(wrapper.find('[data-test="batch-opening-finish"]').exists()).toBe(
      false,
    );
    expect(api.get).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('aborts an in-flight fact read when the panel unmounts', async () => {
    api.get.mockReturnValue(new Promise(() => {}));
    const wrapper = mountPanel(['matter-1']);
    const signal = api.get.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    wrapper.unmount();
    expect(signal.aborted).toBe(true);
  });

  it('retains a failed result after a later item succeeds and reports failures on completion', async () => {
    api.get.mockImplementation((id: string) => Promise.resolve(matter(id)));
    const wrapper = mountPanel(['matter-1', 'matter-2']);
    await flushPromises();
    await wrapper.get('[data-test="single-fail"]').trigger('click');
    expect(wrapper.get('[data-test="opening-item-matter-1"]').text()).toContain(
      '确定失败',
    );
    await wrapper.get('[data-test="batch-opening-next"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="single-submit"]').trigger('click');
    expect(wrapper.get('[data-test="opening-item-matter-2"]').text()).toContain(
      '成功',
    );
    await wrapper
      .get('[data-test="batch-opening-return-failed"]')
      .trigger('click');
    expect(wrapper.get('[data-test="opening-item-matter-1"]').text()).toContain(
      '确定失败',
    );
    expect(wrapper.get('[data-test="batch-opening-finish"]').text()).toContain(
      '1 个失败事项',
    );
    await wrapper.get('[data-test="batch-opening-finish"]').trigger('click');
    expect(wrapper.emitted('completed')?.[0]?.[0]).toEqual([
      expect.objectContaining({ id: 'matter-1' }),
    ]);
    wrapper.unmount();
  });
});
