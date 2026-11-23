import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../api/lawyer-profiles';
import { ApiError } from '../../api/http';
import LawyerLibraryPage from './LawyerLibraryPage.vue';

vi.mock('../../api/lawyer-profiles', () => ({
  listLawyerProfiles: vi.fn(),
  createLawyerProfile: vi.fn(),
  updateLawyerProfile: vi.fn(),
  setLawyerProfileStatus: vi.fn(),
  openLawyerAccountForProfile: vi.fn(),
}));

const profile = {
  id: '11111111-1111-4111-8111-111111111111',
  fullName: '顾言',
  lawFirm: '远泽律师事务所',
  phone: '13800000000',
  email: 'guyan@example.com',
  barNumber: '13301202010000001',
  lawFirmCreditCode: '91330100MA2XXXXXXX',
  region: '浙江省杭州市',
  address: null,
  status: 'ACTIVE' as const,
  source: 'MANUAL' as const,
  version: 3,
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
  assignmentCount: 2,
  account: null,
  hasAccount: false,
};
const emptyPage = { items: [], total: 0, page: 1, pageSize: 20 };

describe('LawyerLibraryPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.listLawyerProfiles).mockResolvedValue({
      items: [profile],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  it('lists profiles and marks lawyers without an account', async () => {
    const wrapper = mount(LawyerLibraryPage);
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain('顾言');
    expect(text).toContain('远泽律师事务所');
    expect(text).toContain('13301202010000001');
    expect(text).toContain('未开通账号');
    expect(text).toContain('浙江省杭州市');
  });

  it('creates a profile with the fields from the old lawyer list', async () => {
    vi.mocked(api.createLawyerProfile).mockResolvedValue(profile);
    const wrapper = mount(LawyerLibraryPage);
    await flushPromises();
    await wrapper.get('[data-test="lawyer-profile-create"]').trigger('click');
    await wrapper.get('[data-test="lawyer-profile-name"]').setValue('林岸');
    await wrapper.get('[data-test="lawyer-profile-firm"]').setValue('海城律所');
    await wrapper
      .get('[data-test="lawyer-profile-bar"]')
      .setValue('13301202010000002');
    await wrapper
      .get('[data-test="lawyer-profile-region"]')
      .setValue('浙江省宁波市');
    await wrapper.get('[data-test="lawyer-profile-form"]').trigger('submit');
    await flushPromises();
    expect(api.createLawyerProfile).toHaveBeenCalledWith({
      fullName: '林岸',
      lawFirm: '海城律所',
      phone: null,
      email: null,
      barNumber: '13301202010000002',
      lawFirmCreditCode: null,
      region: '浙江省宁波市',
      address: null,
    });
    expect(wrapper.text()).toContain('律师档案已创建');
  });

  it('stops a profile and explains that assignment candidates drop it', async () => {
    vi.mocked(api.setLawyerProfileStatus).mockResolvedValue({
      ...profile,
      status: 'INACTIVE',
      version: 4,
    });
    const wrapper = mount(LawyerLibraryPage);
    await flushPromises();
    await wrapper
      .get(`[data-test="lawyer-profile-toggle-${profile.id}"]`)
      .trigger('click');
    await flushPromises();
    expect(api.setLawyerProfileStatus).toHaveBeenCalledWith(
      profile.id,
      false,
      3,
    );
    expect(wrapper.text()).toContain('指派候选不再包含该律师');
  });

  it('opens an account for an existing profile', async () => {
    vi.mocked(api.openLawyerAccountForProfile).mockResolvedValue(undefined);
    const wrapper = mount(LawyerLibraryPage);
    await flushPromises();
    await wrapper
      .get(`[data-test="lawyer-profile-open-account-${profile.id}"]`)
      .trigger('click');
    await wrapper
      .get('[data-test="lawyer-account-username"]')
      .setValue('guyan');
    await wrapper
      .get('[data-test="lawyer-account-password"]')
      .setValue('Valid-password-2026!');
    await wrapper.get('[data-test="lawyer-account-form"]').trigger('submit');
    await flushPromises();
    expect(api.openLawyerAccountForProfile).toHaveBeenCalledWith(profile.id, {
      username: 'guyan',
      password: 'Valid-password-2026!',
    });
    expect(wrapper.text()).toContain('账号已开通');
  });

  it('shows a permission message instead of an empty table on 403', async () => {
    vi.mocked(api.listLawyerProfiles).mockRejectedValue(
      new ApiError('无权管理律师库', 403, 'ACTION_FORBIDDEN'),
    );
    const wrapper = mount(LawyerLibraryPage);
    await flushPromises();
    expect(wrapper.text()).toContain('没有查看律师库的权限');
    expect(wrapper.find('[data-test="lawyer-profile-table"]').exists()).toBe(
      false,
    );
  });

  it('keeps an empty list distinct from a load failure', async () => {
    vi.mocked(api.listLawyerProfiles).mockResolvedValue(emptyPage);
    const wrapper = mount(LawyerLibraryPage);
    await flushPromises();
    expect(wrapper.text()).toContain('当前筛选条件下没有律师档案');
  });
});
