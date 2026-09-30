import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';

const http = vi.hoisted(() => ({ getJson: vi.fn(), requestJson: vi.fn() }));
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  getJson: http.getJson,
  requestJson: http.requestJson,
}));

import {
  getNotaryListPreference,
  saveNotaryListPreference,
  type NotaryListPreference,
} from './notary-list-preference';

const valid: NotaryListPreference = {
  order: ['businessNo', 'stage', 'sourceLead', 'notaryOffice', 'createdAt'],
  hidden: [],
};

beforeEach(() => vi.resetAllMocks());

describe('notary list preference API', () => {
  it('reads the exact fixed-column contract and preserves an optional column order', async () => {
    const value = {
      order: ['businessNo', 'stage', 'createdAt', 'notaryOffice', 'sourceLead'],
      hidden: ['notaryOffice'],
    };
    http.getJson.mockResolvedValue(value);

    await expect(
      getNotaryListPreference({ signal: new AbortController().signal }),
    ).resolves.toEqual(value);
    expect(http.getJson).toHaveBeenCalledWith(
      '/notary-matters/list-preference',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it.each([
    [
      'an unknown column',
      {
        order: ['businessNo', 'stage', 'sourceLead', 'notaryOffice', 'other'],
        hidden: [],
      },
    ],
    [
      'a repeated column',
      {
        order: ['businessNo', 'stage', 'sourceLead', 'sourceLead', 'createdAt'],
        hidden: [],
      },
    ],
    [
      'a misplaced fixed column',
      {
        order: [
          'stage',
          'businessNo',
          'sourceLead',
          'notaryOffice',
          'createdAt',
        ],
        hidden: [],
      },
    ],
    ['a hidden fixed column', { order: valid.order, hidden: ['stage'] }],
    [
      'a repeated hidden column',
      { order: valid.order, hidden: ['sourceLead', 'sourceLead'] },
    ],
    ['an extra response key', { ...valid, userId: 'user-1' }],
  ])('rejects %s in an API response', async (_label, response) => {
    http.getJson.mockResolvedValue(response);

    await expect(getNotaryListPreference()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    } satisfies Partial<ApiError>);
  });

  it('writes the strict two-key body with PUT and decodes the returned value', async () => {
    http.requestJson.mockResolvedValue(valid);

    await expect(saveNotaryListPreference(valid)).resolves.toEqual(valid);
    expect(http.requestJson).toHaveBeenCalledWith(
      '/notary-matters/list-preference',
      { method: 'PUT', body: valid },
    );
  });

  it('rejects an invalid request locally without sending it', async () => {
    const invalid = {
      order: ['businessNo', 'stage', 'sourceLead', 'sourceLead', 'createdAt'],
      hidden: [],
    } as unknown as NotaryListPreference;

    await expect(saveNotaryListPreference(invalid)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(http.requestJson).not.toHaveBeenCalled();
  });

  it('rejects an invalid successful PUT response', async () => {
    http.requestJson.mockResolvedValue({ ...valid, extra: true });

    await expect(saveNotaryListPreference(valid)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
