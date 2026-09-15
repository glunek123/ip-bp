import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HealthPage from './HealthPage.vue';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('connection page', () => {
  it('does not count a proxy failure as a backend response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Bad gateway', { status: 502 })),
    );
    const wrapper = mount(HealthPage);
    await flushPromises();
    expect(wrapper.text()).toContain('连接失败');
    expect(wrapper.text()).not.toContain('服务已响应');
    wrapper.unmount();
  });
  it('shows actual readiness returned by the backend', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('{"status":"ok","database":"up"}')),
    );
    const wrapper = mount(HealthPage);
    await flushPromises();
    expect(wrapper.text()).toContain('连接正常');
    expect(wrapper.text()).toContain('数据库已连接');
    wrapper.unmount();
  });
  it('shows failure and recovers when the user retries', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            '{"message":"数据库暂时不可用","code":"DATABASE_UNAVAILABLE","requestId":"r1"}',
            { status: 503 },
          ),
        )
        .mockResolvedValueOnce(new Response('{"status":"ok","database":"up"}')),
    );
    const wrapper = mount(HealthPage);
    await flushPromises();
    expect(wrapper.text()).toContain('连接失败');
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('连接正常');
    wrapper.unmount();
  });
  it('rejects a successful HTTP response with the wrong shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    const wrapper = mount(HealthPage);
    await flushPromises();
    expect(wrapper.text()).toContain('连接失败');
    wrapper.unmount();
  });
});
