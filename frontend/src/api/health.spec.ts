import { afterEach, expect, it, vi } from 'vitest';
import { getHealth } from './health';

afterEach(() => vi.unstubAllGlobals());
it('returns validated health status', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('{"status":"ok","database":"up"}')),
  );
  expect(await getHealth()).toEqual({ status: 'ok', database: 'up' });
});
it.each([null, [], {}, { status: 'ok', database: 'down' }])(
  'rejects invalid health %j',
  async (body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
    );
    await expect(getHealth()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  },
);
