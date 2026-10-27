import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createClientAccount,
  getClientAccountCapabilities,
  listClientAccounts,
  setClientAccountStatus,
} from './client-accounts';

afterEach(() => vi.unstubAllGlobals());

const account = {
  id: 'user-1',
  displayName: '客户审核人',
  username: 'client.a',
  accountActive: true,
  bindingActive: true,
  bindingVersion: 1,
};

describe('client account API', () => {
  it('strictly decodes capabilities', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ canCreate: true, canManage: false })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ canCreate: 'yes', canManage: false })),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(getClientAccountCapabilities('customer-1')).resolves.toEqual({
      canCreate: true,
      canManage: false,
    });
    await expect(
      getClientAccountCapabilities('customer-1'),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('lists, creates and deactivates a bound client account', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [account] })))
      .mockResolvedValueOnce(new Response(JSON.stringify(account)))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...account,
            accountActive: false,
            bindingActive: false,
            bindingVersion: 2,
          }),
        ),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(listClientAccounts('customer-1')).resolves.toEqual([account]);
    await expect(
      createClientAccount('customer-1', {
        displayName: '客户审核人',
        username: 'client.a',
        password: 'correct horse battery staple',
      }),
    ).resolves.toEqual(account);
    await expect(
      setClientAccountStatus('customer-1', 'user-1', false),
    ).resolves.toMatchObject({ accountActive: false, bindingActive: false });
    expect(fetch.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetch.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
