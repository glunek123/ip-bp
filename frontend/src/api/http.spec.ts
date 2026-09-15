import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJson } from './http';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HTTP boundary', () => {
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
