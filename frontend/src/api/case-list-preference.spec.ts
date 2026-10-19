import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultCaseListPreference,
  getCaseListPreference,
  saveCaseListPreference,
  type CaseListPreference,
} from './case-list-preference';

afterEach(() => vi.unstubAllGlobals());

function mockJson(payload: unknown, status = 200) {
  const fetchMock = vi
    .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
    .mockImplementation(
      async () => new Response(JSON.stringify(payload), { status }),
    );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('case list preference API', () => {
  it('GETs the fixed bucket endpoint and strictly decodes the exact shape', async () => {
    const expected = structuredClone(defaultCaseListPreference);
    const fetchMock = mockJson(expected);
    await expect(getCaseListPreference('WAITING_HEARING')).resolves.toEqual(
      expected,
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/cases/list-preferences/WAITING_HEARING',
    );
  });

  it('PUTs a complete preference with request options and returns decoded server state', async () => {
    const preference: CaseListPreference = {
      order: [...defaultCaseListPreference.order].reverse().reverse(),
      hidden: ['platform', 'shopName'],
    };
    const controller = new AbortController();
    const fetchMock = mockJson(preference);
    await expect(
      saveCaseListPreference('all', preference, {
        signal: controller.signal,
        headers: { 'X-Test': 'request-option' },
      }),
    ).resolves.toEqual(preference);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/cases/list-preferences/all',
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PUT');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(
      preference,
    );
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('X-Test'),
    ).toBe('request-option');
  });

  it('snapshots the preference body before the caller can mutate its arrays', async () => {
    let complete!: (response: Response) => void;
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const preference = structuredClone(defaultCaseListPreference);
    preference.hidden = ['platform'];
    const original = structuredClone(preference);
    const pending = saveCaseListPreference('all', preference);
    preference.order.reverse();
    preference.hidden.push('shopName');
    complete(new Response(JSON.stringify(original), { status: 200 }));
    await expect(pending).resolves.toEqual(original);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(
      original,
    );
  });

  it('rejects an unknown bucket and invalid PUT shapes before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      getCaseListPreference('unknown' as never),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    const invalidPreferences: unknown[] = [
      {
        ...defaultCaseListPreference,
        order: defaultCaseListPreference.order.slice(1),
      },
      {
        ...defaultCaseListPreference,
        order: [
          defaultCaseListPreference.order[0],
          ...defaultCaseListPreference.order.slice(2),
          defaultCaseListPreference.order[2],
        ],
      },
      {
        ...defaultCaseListPreference,
        order: [...defaultCaseListPreference.order].reverse(),
      },
      { ...defaultCaseListPreference, hidden: ['businessNo'] },
      { ...defaultCaseListPreference, hidden: ['futureColumn'] },
      { ...defaultCaseListPreference, hidden: ['platform', 'platform'] },
      { ...defaultCaseListPreference, userId: 'unexpected' },
    ];
    for (const preference of invalidPreferences)
      await expect(
        saveCaseListPreference('all', preference as CaseListPreference),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed response bodies and does not report failed saves as success', async () => {
    for (const invalid of [
      { ...defaultCaseListPreference, extra: true },
      {
        ...defaultCaseListPreference,
        order: [...defaultCaseListPreference.order].reverse(),
      },
      { ...defaultCaseListPreference, hidden: ['businessNo'] },
      { ...defaultCaseListPreference, hidden: ['platform', 'platform'] },
    ]) {
      mockJson(invalid);
      await expect(getCaseListPreference('all')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
    mockJson({ message: 'not saved', code: 'FORBIDDEN' }, 403);
    await expect(
      saveCaseListPreference('all', defaultCaseListPreference),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });
});
