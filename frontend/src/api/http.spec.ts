import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getBlob,
  getJson,
  requestBinary,
  requestJson,
  setCsrfToken,
  setSessionIdentity,
} from './http';

afterEach(() => {
  setCsrfToken(null);
  setSessionIdentity(null);
  vi.unstubAllGlobals();
});

describe('HTTP boundary', () => {
  it('sends a raw Blob through the shared authenticated request boundary', async () => {
    const body = new Blob(['real-file-bytes'], { type: 'application/pdf' });
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response('{"stored":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await expect(
      requestBinary('/materials/upload-drafts/draft-1/content', body, {
        method: 'PUT',
      }),
    ).resolves.toEqual({ stored: true });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/materials/upload-drafts/draft-1/content',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'same-origin',
        body,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/octet-stream',
        },
      }),
    );
  });

  it('refreshes CSRF and replays the same raw Blob once', async () => {
    const { setCsrfToken } = await import('./http');
    const body = new Blob(['real-file-bytes']);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'CSRF_INVALID' }), { status: 403 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ csrfToken: 'fresh-token' })),
      )
      .mockResolvedValueOnce(new Response('{"stored":true}'));
    vi.stubGlobal('fetch', fetch);
    setCsrfToken('stale-token');

    await requestBinary('/materials/upload-drafts/draft-1/content', body, {
      method: 'PUT',
    });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({
        body,
        headers: expect.objectContaining({ 'X-CSRF-Token': 'fresh-token' }),
      }),
    );
    setCsrfToken(null);
  });

  it('parses a structured JSON error returned by a binary endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'MATERIAL_INVALID_VERSION',
            message: '文件内容不符合要求',
            requestId: 'request-binary-1',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(
      requestBinary('/materials/upload-drafts/draft-1/content', new Blob(), {
        method: 'PUT',
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'MATERIAL_INVALID_VERSION',
      requestId: 'request-binary-1',
    });
  });

  it('downloads a Blob with a decoded RFC 5987 filename', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('downloaded-bytes', {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition':
              "attachment; filename*=UTF-8''%E8%90%A5%E4%B8%9A%E6%89%A7%E7%85%A7.pdf",
          },
        }),
      ),
    );

    const result = await getBlob('/materials/m1/versions/v1/content');

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBe(16);
    expect(result).toMatchObject({
      filename: '营业执照.pdf',
      mimeType: 'application/pdf',
    });
  });

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
          credentials: 'same-origin',
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
  it('adds the current CSRF token to cookie-authenticated writes', async () => {
    const { setCsrfToken } = await import('./http');
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    setCsrfToken('csrf-token');
    await requestJson('/customers', { method: 'POST', body: { name: '甲' } });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/customers',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-token' }),
      }),
    );
    setCsrfToken(null);
  });

  it('refreshes a stale CSRF token and retries the write once', async () => {
    const { setCsrfToken } = await import('./http');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 'CSRF_INVALID', message: '请刷新页面后重试' }),
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ csrfToken: 'fresh-csrf-token' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    setCsrfToken('stale-csrf-token');

    await expect(
      requestJson('/customers', { method: 'POST', body: { name: '甲' } }),
    ).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1]?.[0]).toBe('/api/v1/auth/session');
    expect(fetch.mock.calls[2]?.[1].headers).toEqual(
      expect.objectContaining({ 'X-CSRF-Token': 'fresh-csrf-token' }),
    );
    setCsrfToken(null);
  });

  it('surfaces the CSRF failure when the session cannot be refreshed', async () => {
    const { setCsrfToken } = await import('./http');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'CSRF_INVALID' }), { status: 403 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    setCsrfToken('stale-csrf-token');

    await expect(
      requestJson('/customers', { method: 'POST', body: { name: '甲' } }),
    ).rejects.toMatchObject({ status: 403, code: 'CSRF_INVALID' });
    expect(fetch).toHaveBeenCalledTimes(2);
    setCsrfToken(null);
  });

  it('retries a refreshed CSRF write at most once', async () => {
    const { setCsrfToken } = await import('./http');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'CSRF_INVALID' }), { status: 403 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ csrfToken: 'fresh-csrf-token' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'CSRF_INVALID' }), { status: 403 }),
      );
    vi.stubGlobal('fetch', fetch);
    setCsrfToken('stale-csrf-token');

    await expect(
      requestJson('/customers', { method: 'POST', body: { name: '甲' } }),
    ).rejects.toMatchObject({ status: 403, code: 'CSRF_INVALID' });
    expect(fetch).toHaveBeenCalledTimes(3);
    setCsrfToken(null);
  });

  it('notifies the auth boundary when the refresh itself is unauthorized', async () => {
    const { onUnauthorized, setCsrfToken } = await import('./http');
    const listener = vi.fn();
    const dispose = onUnauthorized(listener);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'CSRF_INVALID' }), { status: 403 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    setCsrfToken('stale-csrf-token');

    await expect(
      requestJson('/customers', { method: 'POST', body: { name: '甲' } }),
    ).rejects.toMatchObject({ status: 403, code: 'CSRF_INVALID' });
    expect(listener).toHaveBeenCalledTimes(1);
    setCsrfToken(null);
    dispose();
  });

  it('refuses to replay a write once the session switched to another account', async () => {
    const { onUnauthorized, setCsrfToken, setSessionIdentity } =
      await import('./http');
    const listener = vi.fn();
    const dispose = onUnauthorized(listener);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'CSRF_INVALID' }), { status: 403 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            csrfToken: 'other-account-token',
            user: { id: 'other-user' },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetch);
    setCsrfToken('stale-csrf-token');
    setSessionIdentity('current-user');

    await expect(
      requestJson('/customers', { method: 'POST', body: { name: '甲' } }),
    ).rejects.toMatchObject({ status: 403, code: 'CSRF_INVALID' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    setCsrfToken(null);
    setSessionIdentity(null);
    dispose();
  });

  it('notifies the auth boundary on 401 without calling it a network error', async () => {
    const { onUnauthorized } = await import('./http');
    const listener = vi.fn();
    const dispose = onUnauthorized(listener);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ code: 'UNAUTHORIZED', message: '请登录' }),
          {
            status: 401,
          },
        ),
      ),
    );
    await expect(getJson('/customers')).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });
    expect(listener).toHaveBeenCalledTimes(1);
    dispose();
  });
  it('leaves logout failure handling to the caller', async () => {
    const { onUnauthorized } = await import('./http');
    const listener = vi.fn();
    const dispose = onUnauthorized(listener);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ code: 'UNAUTHORIZED', message: '退出失败' }),
            { status: 401 },
          ),
        ),
    );

    await expect(
      requestJson('/auth/logout', { method: 'POST' }),
    ).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(listener).not.toHaveBeenCalled();
    dispose();
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
