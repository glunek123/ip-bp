import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseDetail } from '../../api/cases';
import { ApiError } from '../../api/http';
import CaseAcceptanceCorrectionPanel from './CaseAcceptanceCorrectionPanel.vue';
import CaseDefendantContactPanel from './CaseDefendantContactPanel.vue';

const api = vi.hoisted(() => ({
  updateCaseDefendantContact: vi.fn(),
  correctCaseAcceptance: vi.fn(),
}));
vi.mock('../../api/cases', async (original) => ({
  ...(await original<typeof import('../../api/cases')>()),
  updateCaseDefendantContact: api.updateCaseDefendantContact,
  correctCaseAcceptance: api.correctCaseAcceptance,
}));

const defendantId = '10000000-0000-4000-8000-000000000001';
const acceptanceId = '20000000-0000-4000-8000-000000000001';
const roundId = '30000000-0000-4000-8000-000000000001';
const caseId = '40000000-0000-4000-8000-000000000001';

function detail(): CaseDetail {
  return {
    id: caseId,
    defendants: [
      { id: defendantId, name: '被告甲', phone: ' 100 ', address: ' 原地址 ' },
    ],
    acceptances: [
      {
        id: acceptanceId,
        trialRoundId: roundId,
        acceptedAt: '2026-10-01',
        courtCaseNo: '（2026）原案号',
      },
    ],
    acceptance: {
      id: acceptanceId,
      trialRoundId: roundId,
      acceptedAt: '2026-10-01',
      courtCaseNo: '（2026）原案号',
    },
    recordEdits: {
      canUpdateDefendantContact: true,
      canCorrectAcceptance: true,
      defendantContacts: [{ defendantId, contactRevision: 0, history: [] }],
      acceptanceCorrections: [
        {
          acceptanceId,
          trialRoundId: roundId,
          acceptanceRevision: 0,
          originalAcceptedAt: '2026-10-01',
          originalCourtCaseNo: '（2026）原案号',
          history: [],
        },
      ],
    },
  } as unknown as CaseDetail;
}

describe('case record edit panels', () => {
  beforeEach(() => {
    api.updateCaseDefendantContact.mockReset();
    api.correctCaseAcceptance.mockReset();
  });

  it('only reports contact success after a resolved save and clears it on cancel or context change', async () => {
    const wrapper = mount(CaseDefendantContactPanel, {
      props: { item: detail(), contextKey: 'case:case-1:user:operator-1' },
    });
    expect(wrapper.find('[role="status"]').exists()).toBe(false);

    await wrapper.get('[data-test="defendant-contact-phone"]').setValue('200');
    await wrapper
      .get('[data-test="defendant-contact-cancel"]')
      .trigger('click');
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.emitted('cancel')).toHaveLength(1);

    await wrapper.get('[data-test="defendant-contact-phone"]').setValue('200');
    api.updateCaseDefendantContact.mockResolvedValue({
      caseId,
      defendantId,
      changeId: '50000000-0000-4000-8000-000000000001',
      contactRevision: 1,
      phone: '200',
      address: '原地址',
      recordedAt: '2026-10-14T00:00:00.000Z',
    });
    await wrapper.get('[data-test="defendant-contact-save"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(true);

    await wrapper.setProps({ contextKey: 'case:case-1:user:operator-2' });
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });

  it('only reports acceptance correction success after a resolved save and clears it on cancel', async () => {
    const wrapper = mount(CaseAcceptanceCorrectionPanel, {
      props: { item: detail(), contextKey: 'case:case-1:user:operator-1' },
    });
    expect(wrapper.find('[role="status"]').exists()).toBe(false);

    await wrapper
      .get('[data-test="acceptance-correction-date"]')
      .setValue('2026-10-02');
    await wrapper
      .get('[data-test="acceptance-correction-court-case-no"]')
      .setValue('new-no');
    await wrapper
      .get('[data-test="acceptance-correction-reason"]')
      .setValue('reason');
    await wrapper
      .get('[data-test="acceptance-correction-cancel"]')
      .trigger('click');
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.emitted('cancel')).toHaveLength(1);

    await wrapper
      .get('[data-test="acceptance-correction-date"]')
      .setValue('2026-10-02');
    await wrapper
      .get('[data-test="acceptance-correction-court-case-no"]')
      .setValue('new-no');
    await wrapper
      .get('[data-test="acceptance-correction-reason"]')
      .setValue('reason');
    api.correctCaseAcceptance.mockResolvedValue({
      caseId,
      acceptanceId,
      correctionId: '60000000-0000-4000-8000-000000000001',
      acceptanceRevision: 1,
      acceptedAt: '2026-10-02',
      courtCaseNo: 'new-no',
      recordedAt: '2026-10-14T00:00:00.000Z',
    });
    await wrapper
      .get('[data-test="acceptance-correction-save"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
  });

  it('trims before enforcing contact length limits without truncating valid values', async () => {
    const phone = ` ${'p'.repeat(100)} `;
    const address = ` ${'a'.repeat(500)} `;
    api.updateCaseDefendantContact.mockResolvedValue({
      caseId,
      defendantId,
      changeId: '50000000-0000-4000-8000-000000000002',
      contactRevision: 1,
      phone: 'p'.repeat(100),
      address: 'a'.repeat(500),
      recordedAt: '2026-10-14T00:00:00.000Z',
    });
    const wrapper = mount(CaseDefendantContactPanel, {
      props: { item: detail(), contextKey: 'case:case-1:user:operator-1' },
    });

    expect(
      wrapper
        .get('[data-test="defendant-contact-phone"]')
        .attributes('maxlength'),
    ).toBeUndefined();
    await wrapper.get('[data-test="defendant-contact-phone"]').setValue(phone);
    await wrapper
      .get('[data-test="defendant-contact-address"]')
      .setValue(address);
    expect(
      (
        wrapper.get('[data-test="defendant-contact-save"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    await wrapper.get('[data-test="defendant-contact-save"]').trigger('click');
    await flushPromises();
    expect(api.updateCaseDefendantContact.mock.calls[0]?.[1]).toMatchObject({
      phone: 'p'.repeat(100),
      address: 'a'.repeat(500),
    });

    await wrapper
      .get('[data-test="defendant-contact-phone"]')
      .setValue('p'.repeat(101));
    expect(
      (
        wrapper.get('[data-test="defendant-contact-save"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('trims before enforcing acceptance correction length limits without truncating valid values', async () => {
    const courtCaseNo = ` ${'n'.repeat(100)} `;
    const reason = ` ${'r'.repeat(500)} `;
    api.correctCaseAcceptance.mockResolvedValue({
      caseId,
      acceptanceId,
      correctionId: '60000000-0000-4000-8000-000000000002',
      acceptanceRevision: 1,
      acceptedAt: '2026-10-02',
      courtCaseNo: 'n'.repeat(100),
      recordedAt: '2026-10-14T00:00:00.000Z',
    });
    const wrapper = mount(CaseAcceptanceCorrectionPanel, {
      props: { item: detail(), contextKey: 'case:case-1:user:operator-1' },
    });

    expect(
      wrapper
        .get('[data-test="acceptance-correction-court-case-no"]')
        .attributes('maxlength'),
    ).toBeUndefined();
    expect(
      wrapper
        .get('[data-test="acceptance-correction-reason"]')
        .attributes('maxlength'),
    ).toBeUndefined();
    await wrapper
      .get('[data-test="acceptance-correction-date"]')
      .setValue('2026-10-02');
    await wrapper
      .get('[data-test="acceptance-correction-court-case-no"]')
      .setValue(courtCaseNo);
    await wrapper
      .get('[data-test="acceptance-correction-reason"]')
      .setValue(reason);
    expect(
      (
        wrapper.get('[data-test="acceptance-correction-save"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    await wrapper
      .get('[data-test="acceptance-correction-save"]')
      .trigger('click');
    await flushPromises();
    expect(api.correctCaseAcceptance.mock.calls[0]?.[1]).toMatchObject({
      acceptedAt: '2026-10-02',
      courtCaseNo: 'n'.repeat(100),
      reason: 'r'.repeat(500),
    });

    await wrapper
      .get('[data-test="acceptance-correction-reason"]')
      .setValue('r'.repeat(501));
    expect(
      (
        wrapper.get('[data-test="acceptance-correction-save"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('submits both trimmed contact fields and preserves the original request for explicit retry', async () => {
    const item = detail();
    api.updateCaseDefendantContact
      .mockRejectedValueOnce(new ApiError('unknown', 0, 'NETWORK_ERROR'))
      .mockResolvedValueOnce({
        caseId,
        defendantId,
        changeId: '50000000-0000-4000-8000-000000000001',
        contactRevision: 1,
        phone: null,
        address: '新地址',
        recordedAt: '2026-10-14T00:00:00.000Z',
      });
    const wrapper = mount(CaseDefendantContactPanel, {
      props: { item, contextKey: 'case:case-1:user:operator-1' },
    });

    await wrapper.get('[data-test="defendant-contact-phone"]').setValue('   ');
    await wrapper
      .get('[data-test="defendant-contact-address"]')
      .setValue(' 新地址 ');
    await wrapper.get('[data-test="defendant-contact-save"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-test="record-edit-unknown"]').text()).toContain(
      '\u8bf7\u6c42\u7ed3\u679c\u5f85\u6838\u5bf9\uff0c\u4fdd\u7559\u539f\u8bf7\u6c42\u5185\u5bb9\u548c\u8bf7\u6c42\u952e\u3002',
    );
    expect(
      (
        wrapper.get('[data-test="defendant-contact-cancel"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(wrapper.emitted('cancel')).toBeUndefined();
    expect(api.updateCaseDefendantContact).toHaveBeenCalledTimes(1);
    const firstRequest = api.updateCaseDefendantContact.mock.calls[0];
    expect(firstRequest[0]).toBe(caseId);
    expect(firstRequest[1]).toEqual({
      defendantId,
      expectedContactRevision: 0,
      idempotencyKey: expect.any(String),
      phone: null,
      address: '新地址',
    });

    await wrapper
      .get('[data-test="defendant-contact-retry-original"]')
      .trigger('click');
    await flushPromises();

    expect(api.updateCaseDefendantContact).toHaveBeenCalledTimes(2);
    expect(api.updateCaseDefendantContact.mock.calls[1][1]).toEqual(
      firstRequest[1],
    );
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it('requires a reason and retries acceptance correction with its original body and key', async () => {
    api.correctCaseAcceptance
      .mockRejectedValueOnce(new ApiError('unknown', 0, 'TIMEOUT'))
      .mockResolvedValueOnce({
        caseId,
        acceptanceId,
        correctionId: '60000000-0000-4000-8000-000000000001',
        acceptanceRevision: 1,
        acceptedAt: '2026-10-02',
        courtCaseNo: '（2026）更正案号',
        recordedAt: '2026-10-14T00:00:00.000Z',
      });
    const wrapper = mount(CaseAcceptanceCorrectionPanel, {
      props: { item: detail(), contextKey: 'case:case-1:user:operator-1' },
    });

    await wrapper
      .get('[data-test="acceptance-correction-date"]')
      .setValue('2026-10-02');
    await wrapper
      .get('[data-test="acceptance-correction-court-case-no"]')
      .setValue(' （2026）更正案号 ');
    expect(
      (
        wrapper.get('[data-test="acceptance-correction-save"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await wrapper
      .get('[data-test="acceptance-correction-reason"]')
      .setValue('核对立案通知');
    await wrapper
      .get('[data-test="acceptance-correction-save"]')
      .trigger('click');
    await flushPromises();

    const firstRequest = api.correctCaseAcceptance.mock.calls[0];
    expect(firstRequest[0]).toBe(caseId);
    expect(firstRequest[1]).toEqual({
      acceptanceId,
      expectedAcceptanceRevision: 0,
      idempotencyKey: expect.any(String),
      acceptedAt: '2026-10-02',
      courtCaseNo: '（2026）更正案号',
      reason: '核对立案通知',
    });
    expect(
      (
        wrapper.get('[data-test="acceptance-correction-cancel"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(wrapper.emitted('cancel')).toBeUndefined();
    await wrapper
      .get('[data-test="acceptance-correction-retry-original"]')
      .trigger('click');
    await flushPromises();
    expect(api.correctCaseAcceptance.mock.calls[1][1]).toEqual(firstRequest[1]);
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it('keeps edits disabled when an older response has no record edit capabilities', () => {
    const oldProjection = { ...detail() };
    delete oldProjection.recordEdits;
    const wrapper = mount(CaseDefendantContactPanel, {
      props: { item: oldProjection, contextKey: 'case:case-1:user:operator-1' },
    });

    expect(wrapper.find('[data-test="record-edit-unavailable"]').exists()).toBe(
      true,
    );
    expect(
      (
        wrapper.get('[data-test="defendant-contact-save"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('does not add an acceptance selector when only one acceptance is registered', () => {
    const wrapper = mount(CaseAcceptanceCorrectionPanel, {
      props: { item: detail(), contextKey: 'case:case-1:user:operator-1' },
    });

    expect(
      wrapper.find('[data-test="acceptance-correction-record"]').exists(),
    ).toBe(false);
  });
});
