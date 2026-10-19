import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import type { NotaryMatterDetail } from '../../api/notary';
import NotaryRecordCorrectionPanel from './NotaryRecordCorrectionPanel.vue';

const api = vi.hoisted(() => ({ evidence: vi.fn(), sender: vi.fn() }));
vi.mock('../../api/notary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/notary')>()),
  correctNotaryEvidence: api.evidence,
  correctNotaryOpeningSender: api.sender,
}));

const actorKey = 'operator-1:INTERNAL:department-1:7';
const actorIdentity = 'operator-1:INTERNAL:department-1';
function detail(
  overrides: Partial<NotaryMatterDetail> = {},
): NotaryMatterDetail {
  return {
    id: 'matter-1',
    businessNo: 'NT-001',
    leadId: 'lead-1',
    leadStatus: 'TRANSFERRED_TO_NOTARY',
    leadVersion: 2,
    stage: 'WAITING_RETURN',
    version: 8,
    createdAt: '2026-10-01T00:00:00Z',
    notaryOffice: { id: 'office-1', name: '公证处' },
    sourceLead: { id: 'lead-1', businessNo: 'LD-001' },
    sourceSummary: {
      customer: { id: 'c', name: '客户' },
      rightsHolder: { id: 'r', name: '主体' },
      platform: 'TAOBAO',
      shopName: '店铺',
      shopExternalId: null,
    },
    transferredAt: '2026-10-01',
    evidenceAt: '2026-10-01',
    openingSummary: {
      photoCount: 1,
      senderName: '原姓名',
      senderPhone: null,
      senderAddress: null,
    },
    certificateSummary: null,
    fees: {
      notary: { state: 'UNRECORDED', amount: null },
      investigation: { state: 'UNRECORDED', amount: null },
      sample: { state: 'PENDING', amount: null },
    },
    linkedCase: null,
    capabilities: {
      recordEvidence: false,
      recordOpening: false,
      reviewOpening: false,
      decideIssuance: false,
      archiveReturn: true,
    },
    certificateFiles: [],
    evidence: {
      evidenceAt: '2026-10-01',
      sampleFeeState: 'PENDING',
      sampleFeeAmount: null,
      recordedAt: '2026-10-01T00:00:00Z',
      recordedByUserId: 'operator-1',
      logistics: [
        {
          id: 'log-1',
          companyState: 'PRESENT',
          companyValue: '顺丰',
          trackingState: 'PRESENT',
          trackingValue: 'SF1',
        },
      ],
    },
    opening: {
      senderName: '原姓名',
      senderPhone: null,
      senderAddress: null,
      recordedAt: '2026-10-02T00:00:00Z',
      recordedByUserId: 'operator-1',
      photos: [],
    },
    reviewDecision: null,
    issuanceDecision: null,
    returnArchive: null,
    selectedProducts: [],
    selectedMaterials: [],
    evidenceMode: 'ONLINE_PURCHASE',
    batchPurpose: '取证',
    selectedProductIds: [],
    selectedContentVersionIds: [],
    recordEdits: {
      evidence: {
        canCorrect: false,
        revision: 0,
        original: {
          evidenceAt: '2026-10-01',
          logistics: [
            {
              id: 'log-1',
              companyState: 'PRESENT',
              companyValue: '顺丰',
              trackingState: 'PRESENT',
              trackingValue: 'SF1',
            },
          ],
        },
        effective: {
          evidenceAt: '2026-10-01',
          logistics: [
            {
              id: 'log-1',
              companyState: 'PRESENT',
              companyValue: '顺丰',
              trackingState: 'PRESENT',
              trackingValue: 'SF1',
            },
          ],
        },
        history: [],
      },
      openingSender: {
        canCorrect: false,
        revision: 0,
        original: {
          senderName: '原姓名',
          senderPhone: null,
          senderAddress: null,
        },
        effective: {
          senderName: '原姓名',
          senderPhone: null,
          senderAddress: null,
        },
        history: [],
      },
    },
    ...overrides,
  } as NotaryMatterDetail;
}

beforeEach(() => {
  sessionStorage.clear();
  vi.resetAllMocks();
});

describe('NotaryRecordCorrectionPanel', () => {
  it('renders history and sends a revision-bound evidence correction without fee or photo fields', async () => {
    api.evidence.mockResolvedValue({
      matterId: 'matter-1',
      correctionId: 'correction-1',
      kind: 'EVIDENCE',
      revision: 1,
      recordedAt: '2026-10-18T00:00:00Z',
    });
    const wrapper = mount(NotaryRecordCorrectionPanel, {
      props: {
        detail: detail({
          recordEdits: {
            ...detail().recordEdits!,
            evidence: { ...detail().recordEdits!.evidence!, canCorrect: true },
          },
        }),
        actorKey,
      },
    });
    expect(
      wrapper.get('[data-test="evidence-correction-history"]').text(),
    ).toContain('原始取证日期');
    await wrapper
      .get('[data-test="evidence-correction-history"] summary')
      .trigger('click');
    await wrapper.get('textarea').setValue('物流单号录入错误');
    await wrapper.get('[data-test="correct-evidence"]').trigger('click');
    await flushPromises();
    expect(api.evidence).toHaveBeenCalledWith(
      'matter-1',
      expect.objectContaining({
        expectedVersion: 8,
        expectedRevision: 0,
        correctionReason: '物流单号录入错误',
        evidenceAt: '2026-10-01',
      }),
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const submitted = api.evidence.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(submitted).not.toHaveProperty('sampleFeeState');
    expect(submitted).not.toHaveProperty('contentVersionIds');
    expect(wrapper.emitted('refreshed')).toHaveLength(1);
  });

  it('shows logistics-only revisions with complete before and after values, actor, reason, and time', async () => {
    const base = detail().recordEdits!;
    const wrapper = mount(NotaryRecordCorrectionPanel, {
      props: {
        detail: detail({
          recordEdits: {
            ...base,
            evidence: {
              canCorrect: false,
              revision: 1,
              original: {
                evidenceAt: '2026-10-01',
                logistics: [
                  {
                    id: 'log-1',
                    companyState: 'PRESENT',
                    companyValue: '顺丰',
                    trackingState: 'PRESENT',
                    trackingValue: 'SF1',
                  },
                ],
              },
              effective: {
                evidenceAt: '2026-10-01',
                logistics: [
                  {
                    id: 'log-2',
                    companyState: 'PRESENT',
                    companyValue: '中通',
                    trackingState: 'PRESENT',
                    trackingValue: 'ZT2',
                  },
                ],
              },
              history: [
                {
                  correctionId: 'c-1',
                  revision: 1,
                  correctionReason: '物流录入错误',
                  actorUserId: 'operator-1',
                  recordedAt: '2026-10-18T09:00:00Z',
                  before: {
                    evidenceAt: '2026-10-01',
                    logistics: [
                      {
                        id: 'log-1',
                        companyState: 'PRESENT',
                        companyValue: '顺丰',
                        trackingState: 'PRESENT',
                        trackingValue: 'SF1',
                      },
                    ],
                  },
                  after: {
                    evidenceAt: '2026-10-01',
                    logistics: [
                      {
                        id: 'log-2',
                        companyState: 'PRESENT',
                        companyValue: '中通',
                        trackingState: 'PRESENT',
                        trackingValue: 'ZT2',
                      },
                    ],
                  },
                },
              ],
            },
          },
        }),
        actorKey,
      },
    });
    await wrapper
      .get('[data-test="evidence-correction-history"] summary')
      .trigger('click');
    const history = wrapper
      .get('[data-test="evidence-correction-history"]')
      .text();
    expect(history).toContain('顺丰 / SF1');
    expect(history).toContain('中通 / ZT2');
    expect(history).toContain('operator-1');
    expect(history).toContain('物流录入错误');
    expect(history).toContain('2026-10-18T09:00:00Z');
    wrapper.unmount();
  });

  it('shows sender-only revisions with complete before and after values', async () => {
    const base = detail().recordEdits!;
    const wrapper = mount(NotaryRecordCorrectionPanel, {
      props: {
        detail: detail({
          recordEdits: {
            ...base,
            openingSender: {
              canCorrect: false,
              revision: 1,
              original: {
                senderName: '甲',
                senderPhone: '111',
                senderAddress: '旧址',
              },
              effective: {
                senderName: null,
                senderPhone: '222',
                senderAddress: '新址',
              },
              history: [
                {
                  correctionId: 'c-2',
                  revision: 1,
                  correctionReason: '寄件人资料更正',
                  actorUserId: 'operator-2',
                  recordedAt: '2026-10-18T10:00:00Z',
                  before: {
                    senderName: '甲',
                    senderPhone: '111',
                    senderAddress: '旧址',
                  },
                  after: {
                    senderName: null,
                    senderPhone: '222',
                    senderAddress: '新址',
                  },
                },
              ],
            },
          },
        }),
        actorKey,
      },
    });
    await wrapper
      .get('[data-test="sender-correction-history"] summary')
      .trigger('click');
    const history = wrapper
      .get('[data-test="sender-correction-history"]')
      .text();
    expect(history).toContain('甲 / 111 / 旧址');
    expect(history).toContain('未登记 / 222 / 新址');
    expect(history).toContain('operator-2');
    expect(history).toContain('寄件人资料更正');
    wrapper.unmount();
  });

  it('replays the original key and body when a prior correction succeeded before archival', async () => {
    const frozen = {
      actorKey,
      departmentId: 'department-1',
      matterId: 'matter-1',
      kind: 'openingSender',
      key: 'original-key',
      input: {
        expectedVersion: 8,
        expectedRevision: 0,
        correctionReason: '姓名写错',
        senderName: null,
        senderPhone: '13800000000',
        senderAddress: '地址',
      },
    };
    sessionStorage.setItem(
      `notary-record-correction:${JSON.stringify([actorIdentity, 'matter-1'])}`,
      JSON.stringify(frozen),
    );
    api.sender.mockResolvedValue({
      matterId: 'matter-1',
      correctionId: 'c-2',
      kind: 'OPENING_SENDER',
      revision: 1,
      recordedAt: '2026-10-18T00:00:00Z',
    });
    const archived = detail({
      stage: 'ARCHIVED',
      capabilities: {
        recordEvidence: false,
        recordOpening: false,
        reviewOpening: false,
        decideIssuance: false,
        archiveReturn: false,
      },
    });
    const wrapper = mount(NotaryRecordCorrectionPanel, {
      props: { detail: archived, actorKey },
    });
    expect(wrapper.find('[data-test="retry-correction"]').exists()).toBe(true);
    expect(
      wrapper.get('[data-test="pending-correction-summary"]').text(),
    ).toContain('原请求；可能与当前值不同');
    expect(
      wrapper.get('[data-test="pending-correction-summary"]').text(),
    ).toContain('13800000000 / 地址');
    await wrapper.get('[data-test="retry-correction"]').trigger('click');
    await flushPromises();
    expect(api.sender).toHaveBeenCalledWith(
      'matter-1',
      frozen.input,
      'original-key',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.text()).toContain('更正已记录');
  });

  it('fails closed on malformed pending storage instead of issuing a new correction', async () => {
    sessionStorage.setItem(
      `notary-record-correction:${JSON.stringify([actorIdentity, 'matter-1'])}`,
      '{',
    );
    const wrapper = mount(NotaryRecordCorrectionPanel, {
      props: {
        detail: detail({
          recordEdits: {
            ...detail().recordEdits!,
            evidence: { ...detail().recordEdits!.evidence!, canCorrect: true },
          },
        }),
        actorKey,
      },
    });
    expect(wrapper.text()).toContain('已停止更正');
    await wrapper.get('[data-test="correct-evidence"]').trigger('click');
    await flushPromises();
    expect(api.evidence).not.toHaveBeenCalled();
  });

  it('retries an unknown correction with the exact saved body and key and blocks duplicate clicks', async () => {
    api.evidence
      .mockRejectedValueOnce(new ApiError('timeout', 0, 'TIMEOUT'))
      .mockResolvedValueOnce({
        matterId: 'matter-1',
        correctionId: 'c-3',
        kind: 'EVIDENCE',
        revision: 1,
        recordedAt: '2026-10-18T11:00:00Z',
      });
    const canCorrect = detail({
      recordEdits: {
        ...detail().recordEdits!,
        evidence: { ...detail().recordEdits!.evidence!, canCorrect: true },
      },
    });
    const wrapper = mount(NotaryRecordCorrectionPanel, {
      props: { detail: canCorrect, actorKey },
    });
    await wrapper.get('textarea').setValue('保留原请求');
    await wrapper.get('[data-test="correct-evidence"]').trigger('click');
    await flushPromises();
    const frozen = JSON.parse(
      sessionStorage.getItem(
        `notary-record-correction:${JSON.stringify([actorIdentity, 'matter-1'])}`,
      )!,
    );
    const retry = wrapper.get('[data-test="retry-correction"]');
    await Promise.all([retry.trigger('click'), retry.trigger('click')]);
    await flushPromises();
    expect(api.evidence).toHaveBeenCalledTimes(2);
    expect(api.evidence.mock.calls[0]?.slice(0, 3)).toEqual(
      api.evidence.mock.calls[1]?.slice(0, 3),
    );
    expect(api.evidence.mock.calls[1]?.[1]).toEqual(frozen.input);
    expect(api.evidence.mock.calls[1]?.[2]).toBe(frozen.key);
    wrapper.unmount();
  });

  it('keeps the old actor request when identity changes before a late response', async () => {
    let resolve: (value: unknown) => void = () => {};
    api.evidence.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const current = detail({
      recordEdits: {
        ...detail().recordEdits!,
        evidence: { ...detail().recordEdits!.evidence!, canCorrect: true },
      },
    });
    const wrapper = mount(NotaryRecordCorrectionPanel, {
      props: { detail: current, actorKey },
    });
    await wrapper.get('textarea').setValue('迟到响应');
    await wrapper.get('[data-test="correct-evidence"]').trigger('click');
    const signal = api.evidence.mock.calls[0]?.[3]?.signal as AbortSignal;
    const storageKey = `notary-record-correction:${JSON.stringify([actorIdentity, 'matter-1'])}`;
    const pending = sessionStorage.getItem(storageKey);
    await wrapper.setProps({ actorKey: 'operator-2:INTERNAL:department-2:8' });
    expect(signal.aborted).toBe(true);
    resolve({
      matterId: 'matter-1',
      correctionId: 'late',
      kind: 'EVIDENCE',
      revision: 1,
      recordedAt: '2026-10-18T12:00:00Z',
    });
    await flushPromises();
    expect(sessionStorage.getItem(storageKey)).toBe(pending);
    expect(wrapper.emitted('corrected')).toBeUndefined();
    wrapper.unmount();
  });

  it('stops after a permission denial and does not allow a new correction', async () => {
    api.evidence
      .mockRejectedValueOnce(new ApiError('forbidden', 403, 'ACTION_FORBIDDEN'))
      .mockResolvedValueOnce({
        matterId: 'matter-1',
        correctionId: 'fresh',
        kind: 'EVIDENCE',
        revision: 1,
        recordedAt: '2026-10-18T12:30:00Z',
      });
    const current = detail({
      recordEdits: {
        ...detail().recordEdits!,
        evidence: { ...detail().recordEdits!.evidence!, canCorrect: true },
      },
    });
    const wrapper = mount(NotaryRecordCorrectionPanel, {
      props: { detail: current, actorKey },
    });
    await wrapper.get('textarea').setValue('不要重复提交');
    await wrapper.get('[data-test="correct-evidence"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="retry-correction"]').exists()).toBe(false);
    expect(api.evidence).toHaveBeenCalledTimes(1);
    expect(
      sessionStorage.getItem(
        `notary-record-correction:${JSON.stringify([actorIdentity, 'matter-1'])}`,
      ),
    ).toBeNull();
    expect(
      wrapper.get('.correction-form').attributes('disabled'),
    ).toBeDefined();
    await wrapper.setProps({ detail: { ...current, version: 9 } });
    await wrapper.get('textarea').setValue('权限事实刷新后新建');
    await wrapper.get('[data-test="correct-evidence"]').trigger('click');
    await flushPromises();
    expect(api.evidence).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('keeps correction inputs and reports a stale version for refresh after a 409', async () => {
    api.evidence.mockRejectedValue(
      new ApiError('stale', 409, 'VERSION_CONFLICT'),
    );
    const current = detail({
      recordEdits: {
        ...detail().recordEdits!,
        evidence: { ...detail().recordEdits!.evidence!, canCorrect: true },
      },
    });
    const wrapper = mount(NotaryRecordCorrectionPanel, {
      props: { detail: current, actorKey },
    });
    await wrapper.get('textarea').setValue('保留原因');
    await wrapper.get('[data-test="correct-evidence"]').trigger('click');
    await flushPromises();
    expect(api.evidence).toHaveBeenCalledTimes(1);
    expect(wrapper.get('textarea').element.value).toBe('保留原因');
    expect(wrapper.text()).toContain('事项状态或版本已变化');
    expect(wrapper.emitted('refreshed')).toHaveLength(1);
    wrapper.unmount();
  });

  it('preserves an unknown request after recovery is denied and replays it after authorization refresh', async () => {
    api.evidence
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockRejectedValueOnce(new ApiError('forbidden', 403, 'ACTION_FORBIDDEN'))
      .mockResolvedValueOnce({
        matterId: 'matter-1',
        correctionId: 'c-4',
        kind: 'EVIDENCE',
        revision: 1,
        recordedAt: '2026-10-18T13:00:00Z',
      });
    const editable = detail({
      recordEdits: {
        ...detail().recordEdits!,
        evidence: { ...detail().recordEdits!.evidence!, canCorrect: true },
      },
    });
    const wrapper = mount(NotaryRecordCorrectionPanel, {
      props: { detail: editable, actorKey },
    });
    await wrapper.get('textarea').setValue('unknown then denied');
    await wrapper.get('[data-test="correct-evidence"]').trigger('click');
    await flushPromises();
    const key = `notary-record-correction:${JSON.stringify([actorIdentity, 'matter-1'])}`;
    const frozenText = sessionStorage.getItem(key);
    const frozen = JSON.parse(frozenText!);
    await wrapper.get('[data-test="retry-correction"]').trigger('click');
    await flushPromises();
    expect(sessionStorage.getItem(key)).toBe(frozenText);
    expect(
      wrapper.get('[data-test="retry-correction"]').attributes('disabled'),
    ).toBeDefined();

    const refreshed = detail({
      version: 9,
      recordEdits: {
        ...editable.recordEdits!,
        evidence: {
          ...editable.recordEdits!.evidence!,
          canCorrect: false,
          revision: 1,
        },
      },
    });
    await wrapper.setProps({ detail: refreshed });
    expect(sessionStorage.getItem(key)).toBe(frozenText);
    expect(
      wrapper.get('[data-test="retry-correction"]').attributes('disabled'),
    ).toBeDefined();
    expect(api.evidence).toHaveBeenCalledTimes(2);

    await wrapper.setProps({ actorKey: 'operator-1:INTERNAL:department-1:8' });
    expect(sessionStorage.getItem(key)).toBe(frozenText);
    expect(
      wrapper.get('[data-test="retry-correction"]').attributes('disabled'),
    ).toBeUndefined();
    await wrapper.get('[data-test="retry-correction"]').trigger('click');
    await flushPromises();
    expect(api.evidence).toHaveBeenCalledTimes(3);
    expect(api.evidence.mock.calls[2]?.[1]).toEqual(frozen.input);
    expect(api.evidence.mock.calls[2]?.[2]).toBe(frozen.key);
    expect(sessionStorage.getItem(key)).toBeNull();
    wrapper.unmount();
  });

  it.each([
    ['different user', 'operator-2:INTERNAL:department-1:8'],
    ['different department', 'operator-1:INTERNAL:department-2:8'],
  ])(
    'does not expose another %s pending correction',
    async (_label, otherActor) => {
      const frozen = {
        actorKey,
        departmentId: 'department-1',
        matterId: 'matter-1',
        kind: 'evidence',
        key: 'protected-key',
        input: {
          expectedVersion: 8,
          expectedRevision: 0,
          correctionReason: 'private old request',
          evidenceAt: '2026-10-01',
          logistics: [
            {
              companyState: 'PRESENT',
              companyValue: '顺丰',
              trackingState: 'PRESENT',
              trackingValue: 'SF1',
            },
          ],
        },
      };
      const key = `notary-record-correction:${JSON.stringify([actorIdentity, 'matter-1'])}`;
      sessionStorage.setItem(key, JSON.stringify(frozen));
      const editable = detail({
        recordEdits: {
          ...detail().recordEdits!,
          evidence: { ...detail().recordEdits!.evidence!, canCorrect: true },
        },
      });
      const wrapper = mount(NotaryRecordCorrectionPanel, {
        props: { detail: editable, actorKey: otherActor },
      });
      expect(wrapper.find('[data-test="retry-correction"]').exists()).toBe(
        false,
      );
      expect(wrapper.text()).not.toContain('private old request');
      expect(sessionStorage.getItem(key)).toEqual(JSON.stringify(frozen));
      wrapper.unmount();
    },
  );

  it('fails closed when multiple revision-keyed pending slots match one actor and matter', async () => {
    const oldActor = actorKey;
    const oldKey = `notary-record-correction:${JSON.stringify([oldActor, 'matter-1'])}`;
    const stableKey = `notary-record-correction:${JSON.stringify([actorIdentity, 'matter-1'])}`;
    const frozen = {
      actorKey,
      departmentId: 'department-1',
      matterId: 'matter-1',
      kind: 'evidence',
      key: 'one-key',
      input: {
        expectedVersion: 8,
        expectedRevision: 0,
        correctionReason: 'same actor request',
        evidenceAt: '2026-10-01',
        logistics: [
          {
            companyState: 'PRESENT',
            companyValue: '顺丰',
            trackingState: 'PRESENT',
            trackingValue: 'SF1',
          },
        ],
      },
    };
    sessionStorage.setItem(oldKey, JSON.stringify(frozen));
    sessionStorage.setItem(
      stableKey,
      JSON.stringify({ ...frozen, key: 'different-key' }),
    );
    const editable = detail({
      recordEdits: {
        ...detail().recordEdits!,
        evidence: { ...detail().recordEdits!.evidence!, canCorrect: true },
      },
    });
    const wrapper = mount(NotaryRecordCorrectionPanel, {
      props: { detail: editable, actorKey },
    });
    expect(wrapper.text()).toContain('原请求记录无法安全读取');
    await wrapper.get('[data-test="correct-evidence"]').trigger('click');
    expect(api.evidence).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
