import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeadDetail } from '../../api/leads';
import ProxyLeadEvidencePanel from './ProxyLeadEvidencePanel.vue';
import { hasPendingProxyLeadEvidence } from './lead-proxy-evidence-recovery';

const api = vi.hoisted(() => ({
  getLead: vi.fn(),
  confirmProxyLeadEvidence: vi.fn(),
}));
vi.mock('../../api/leads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/leads')>()),
  getLead: api.getLead,
  confirmProxyLeadEvidence: api.confirmProxyLeadEvidence,
}));
const id = '33333333-3333-4333-8333-333333333333';
const identity = 'actor:INTERNAL:dept:3';
const detail = {
  id,
  version: 3,
  status: 'WAITING_EVIDENCE_DECISION',
  capabilities: { proxyConfirmEvidence: true },
} as LeadDetail;
function mountPanel() {
  return mount(ProxyLeadEvidencePanel, {
    props: { leadId: id, identity, detail },
  });
}

describe('ProxyLeadEvidencePanel', () => {
  beforeEach(() => {
    sessionStorage.clear();
    api.getLead.mockReset().mockResolvedValue(detail);
    api.confirmProxyLeadEvidence.mockReset();
  });
  it('sends EVIDENCE once, clears frozen request and emits refresh', async () => {
    api.confirmProxyLeadEvidence.mockResolvedValue({ result: 'EVIDENCE' });
    const wrapper = mountPanel();
    await wrapper.find('[data-test="proxy-evidence-open"]').trigger('click');
    await flushPromises();
    await wrapper.find('[data-test="proxy-evidence-submit"]').trigger('click');
    await flushPromises();
    expect(api.confirmProxyLeadEvidence).toHaveBeenCalledWith(
      id,
      'EVIDENCE',
      3,
      expect.any(String),
      undefined,
    );
    expect(hasPendingProxyLeadEvidence(identity, id)).toBe(false);
    expect(wrapper.emitted('completed')).toHaveLength(1);
  });
  it('retains exact original body and key after unknown outcome and remount', async () => {
    api.confirmProxyLeadEvidence
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ result: 'NO_EVIDENCE' });
    const first = mountPanel();
    await first.find('[data-test="proxy-evidence-open"]').trigger('click');
    await flushPromises();
    await first.find('input[value="NO_EVIDENCE"]').setValue();
    await first
      .find('[data-test="proxy-evidence-reason"]')
      .setValue(' 不再取证 ');
    await first.find('[data-test="proxy-evidence-submit"]').trigger('click');
    await flushPromises();
    expect(hasPendingProxyLeadEvidence(identity, id)).toBe(true);
    expect(first.text()).toContain('结果尚未确认');
    const original = api.confirmProxyLeadEvidence.mock.calls[0];
    first.unmount();
    const second = mountPanel();
    await second.find('[data-test="proxy-evidence-open"]').trigger('click');
    await flushPromises();
    await second.find('[data-test="proxy-evidence-submit"]').trigger('click');
    await flushPromises();
    expect(api.confirmProxyLeadEvidence.mock.calls[1]).toEqual(original);
    expect(hasPendingProxyLeadEvidence(identity, id)).toBe(false);
  });
  it('does not emit late success after identity changes', async () => {
    let finish!: (value: unknown) => void;
    api.confirmProxyLeadEvidence.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const wrapper = mountPanel();
    await wrapper.find('[data-test="proxy-evidence-open"]').trigger('click');
    await flushPromises();
    await wrapper.find('[data-test="proxy-evidence-submit"]').trigger('click');
    await wrapper.setProps({ identity: 'other:INTERNAL:dept:3' });
    finish({ result: 'EVIDENCE' });
    await flushPromises();
    expect(wrapper.emitted('completed')).toBeUndefined();
    expect(hasPendingProxyLeadEvidence(identity, id)).toBe(true);
  });
});
