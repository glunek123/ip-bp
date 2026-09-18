import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import LoginPage from './LoginPage.vue';

const api = vi.hoisted(() => ({
  login: vi.fn(),
}));
vi.mock('../../api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/auth')>()),
  login: api.login,
}));

afterEach(() => vi.resetAllMocks());

async function mountPage(returnTo = '/customers') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: LoginPage },
      { path: '/customers', component: { template: '<div />' } },
      { path: '/customers/:id', component: { template: '<div />' } },
    ],
  });
  await router.push({ path: '/login', query: { returnTo } });
  await router.isReady();
  return {
    router,
    wrapper: mount(LoginPage, {
      global: { plugins: [createPinia(), router] },
    }),
  };
}

async function fillCredentials(
  wrapper: ReturnType<typeof mount>,
): Promise<void> {
  await wrapper.get('#username').setValue('admin');
  await wrapper.get('#password').setValue('correct horse battery staple');
}

describe('LoginPage', () => {
  it('logs in and returns only to a safe internal path', async () => {
    api.login.mockResolvedValue(undefined);
    const { wrapper, router } = await mountPage('/customers/customer-1');
    await fillCredentials(wrapper);

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(api.login).toHaveBeenCalledWith(
      'admin',
      'correct horse battery staple',
      undefined,
    );
    expect(router.currentRoute.value.fullPath).toBe('/customers/customer-1');
  });

  it('rejects a backslash return path and uses the customer home', async () => {
    api.login.mockResolvedValue(undefined);
    const { wrapper, router } = await mountPage('/\\evil.example');
    await fillCredentials(wrapper);

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe('/customers');
  });

  it('asks for an explicit department and retries with that choice', async () => {
    api.login
      .mockRejectedValueOnce(
        new ApiError('请选择部门', 409, 'DEPARTMENT_REQUIRED', undefined, {
          departments: [
            { id: 'department-1', name: '知产部' },
            { id: 'department-2', name: '品维部' },
          ],
        }),
      )
      .mockResolvedValueOnce(undefined);
    const { wrapper } = await mountPage();
    await fillCredentials(wrapper);

    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('请选择要进入的部门');

    await wrapper.get('#department').setValue('department-2');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(api.login).toHaveBeenLastCalledWith(
      'admin',
      'correct horse battery staple',
      'department-2',
    );
  });
});
