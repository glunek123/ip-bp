import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createNotaryOfficeAccount,
  listNotaryOfficeAccounts,
  setNotaryOfficeAccountActive,
} from './notary-office-accounts';

afterEach(() => vi.unstubAllGlobals());
const account = {
  id: 'user-1',
  displayName: '办理员',
  username: 'office.user',
  accountActive: true,
  bindingActive: true,
  bindingVersion: 1,
};

describe('notary office accounts API', () => {
  it('strictly decodes account list and rejects extra fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ items: [{ ...account, passwordHash: 'secret' }] }),
          ),
        ),
    );
    await expect(listNotaryOfficeAccounts('office-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('creates an account and sends status changes to the account status endpoint', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(account))),
      );
    vi.stubGlobal('fetch', fetch);
    await createNotaryOfficeAccount('office-1', {
      displayName: '办理员',
      username: ' office.user ',
      password: 'correct horse battery staple',
    });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      displayName: '办理员',
      username: 'office.user',
      password: 'correct horse battery staple',
    });
    await setNotaryOfficeAccountActive('office-1', 'user-1', false);
    expect(fetch.mock.calls[1]?.[0]).toContain(
      '/notary-offices/office-1/accounts/user-1/status',
    );
  });
});
