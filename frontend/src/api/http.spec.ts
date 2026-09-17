import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJson, requestJson } from './http';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HTTP boundary', () => {
  it.each(['timeout', 'cancel'] as const)(
    'handles %s while consuming a response body',
    async (mode) => {
      const caller = new AbortController();
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, init: RequestInit) =>
          Promise.resolve({
            status: 200,
            ok: true,
            json: () =>
              new Promise((_resolve, reject) => {
                init.signal?.addEventListener('abort', () =>
                  reject(init.signal?.reason),
                );
                if (mode === 'cancel') caller.abort();
              }),
          }),
        ),
      );
      await expect(
        requestJson('/example', {
          method: 'POST',
          body: {},
          timeoutMs: 5,
          signal: caller.signal,
        }),
      ).rejects.toMatchObject(
        mode === 'timeout' ? { code: 'TIMEOUT' } : { name: 'AbortError' },
      );
    },
  );
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    'sends %s JSON once',
    async (method) => {
      const fetch = vi.fn().mockResolvedValue(new Response('{"saved":true}'));
      vi.stubGlobal('fetch', fetch);
      expect(
        await requestJson('/example', { method, body: { value: null } }),
      ).toEqual({ saved: true });
      expect(fetch).toHaveBeenCalledExactlyOnceWith(
        '/api/v1/example',
        expect.objectContaining({
          method,
          body: '{"value":null}',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
        }),
      );
    },
  );
  it('merges only explicitly supplied request headers', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"saved":true}'));
    vi.stubGlobal('fetch', fetch);

    await requestJson('/customers/c1/rights-holders', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'command-1' },
      body: { expectedCustomerVersion: 1, name: '主体甲' },
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/customers/c1/rights-holders',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'command-1',
        }),
      }),
    );
  });
  it('accepts 204 without trying to parse JSON', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    expect(await requestJson('/example', { method: 'DELETE' })).toBeUndefined();
    expect(fetch.mock.calls[0]?.[1].headers).toEqual({
      Accept: 'application/json',
    });
  });
  it('rejects malformed successful JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('broken')));
    await expect(getJson('/example')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('never retries failed writes', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('network'));
    vi.stubGlobal('fetch', fetch);
    await expect(
      requestJson('/example', { method: 'POST', body: {} }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"status":"ok"}')),
    );
    expect(await getJson('/health')).toEqual({ status: 'ok' });
  });
  it('preserves a structured server failure and does not retry', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'DATABASE_UNAVAILABLE',
          message: '数据库暂时不可用',
          requestId: 'request-1',
        }),
        { status: 503 },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(getJson('/health')).rejects.toMatchObject({
      status: 503,
      code: 'DATABASE_UNAVAILABLE',
      requestId: 'request-1',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('turns a non-JSON proxy error into a readable failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<html>Bad gateway</html>', { status: 502 }),
        ),
    );
    await expect(getJson('/health')).rejects.toMatchObject({
      status: 502,
      code: 'HTTP_ERROR',
    });
  });
  it('aborts a request when its deadline expires', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener(
              'abort',
              () => {
                reject(init.signal?.reason);
              },
              { once: true },
            );
          }),
      ),
    );
    await expect(getJson('/health', { timeoutMs: 5 })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });
  it('honors an already cancelled caller signal', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        init.signal?.throwIfAborted();
      }),
    );
    await expect(
      getJson('/health', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
