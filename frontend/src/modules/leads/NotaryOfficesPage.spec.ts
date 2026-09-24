import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import NotaryOfficesPage from './NotaryOfficesPage.vue';

const api = vi.hoisted(() => ({
  listNotaryOffices: vi.fn(),
  createNotaryOffice: vi.fn(),
}));
vi.mock('../../api/notary', () => api);

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/notary-offices', component: NotaryOfficesPage }],
  });
  await router.push('/notary-offices');
  await router.isReady();
  const wrapper = mount(NotaryOfficesPage, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.resetAllMocks();
  api.listNotaryOffices.mockResolvedValue({
    items: [
      { id: 'office-1', name: '广州市南方公证处', status: 'ACTIVE' },
      { id: 'office-2', name: '深圳市深圳公证处', status: 'ACTIVE' },
    ],
    capabilities: { create: true },
  });
  api.createNotaryOffice.mockResolvedValue({
    id: 'office-3',
    name: '东莞市东莞公证处',
    status: 'ACTIVE',
  });
});

describe('NotaryOfficesPage', () => {
  it('lists current active offices and creates one only when allowed', async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('公证处');
    expect(wrapper.text()).toContain('广州市南方公证处');
    expect(wrapper.text()).toContain('深圳市深圳公证处');
    expect(wrapper.text()).toContain('后续移交线索时可从本部门公证处中选择');
    expect(
      wrapper.get('[data-test="create-notary-office"]').attributes('disabled'),
    ).toBeDefined();
    expect(wrapper.findAll('.required-mark')).toHaveLength(1);

    await wrapper
      .get('[data-test="new-notary-office-name"]')
      .setValue(' 东莞市东莞公证处 ');
    await wrapper.get('[data-test="create-notary-office"]').trigger('click');
    await flushPromises();

    expect(api.createNotaryOffice).toHaveBeenCalledWith('东莞市东莞公证处');
    expect(wrapper.text()).toContain('公证处已新增');
    expect(wrapper.text()).toContain('东莞市东莞公证处');
  });

  it('shows offices without a create form when create capability is absent', async () => {
    api.listNotaryOffices.mockResolvedValueOnce({
      items: [{ id: 'office-1', name: '广州市南方公证处', status: 'ACTIVE' }],
      capabilities: { create: false },
    });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('广州市南方公证处');
    expect(wrapper.text()).toContain('如需新增公证处，请联系部门管理员');
    expect(
      wrapper.find('[data-test="notary-office-create-form"]').exists(),
    ).toBe(false);
  });

  it('renders clear forbidden and recoverable failure states', async () => {
    api.listNotaryOffices.mockRejectedValueOnce(
      new ApiError('forbidden', 403, 'ACTION_FORBIDDEN'),
    );
    const forbidden = await mountPage();
    expect(forbidden.text()).toContain('当前账号无权查看公证处');

    api.listNotaryOffices.mockRejectedValueOnce(new Error('offline'));
    const failed = await mountPage();
    expect(failed.text()).toContain('公证处列表暂时无法加载');
    await failed.get('[data-test="refresh-notary-offices"]').trigger('click');
    await flushPromises();
    expect(api.listNotaryOffices).toHaveBeenCalledTimes(3);
  });

  it('explains duplicate and denied office creation errors', async () => {
    api.createNotaryOffice.mockRejectedValueOnce(
      new ApiError('duplicate', 409, 'OFFICE_EXISTS'),
    );
    const wrapper = await mountPage();
    await wrapper
      .get('[data-test="new-notary-office-name"]')
      .setValue('已存在公证处');
    await wrapper.get('[data-test="create-notary-office"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('该公证处已存在，请检查名称或联系管理员');
  });
});
