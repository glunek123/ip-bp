import { beforeEach, describe, expect, it, vi } from 'vitest';
const http = vi.hoisted(() => ({ getJson: vi.fn(), requestJson: vi.fn() }));
vi.mock('./http', async (original) => ({
  ...(await original<typeof import('./http')>()),
  getJson: http.getJson,
  requestJson: http.requestJson,
}));
import {
  isCaseHandlingGroupAttempt,
  isCaseHandlingGroupCommandResult,
  type CaseHandlingGroupAttempt,
  createCaseHandlingGroup,
  dissolveCaseHandlingGroup,
  getCaseHandlingGroup,
  getCaseHandlingGroupCapability,
  listCaseHandlingGroupCandidates,
  listCaseHandlingGroups,
} from './case-handling-groups';
const id = '33333333-3333-4333-8333-333333333333';
const other = '44444444-4444-4444-8444-444444444444';
const group = '55555555-5555-4555-8555-555555555555';
const attempt = (): CaseHandlingGroupAttempt => ({
  kind: 'CREATE',
  actorKey: 'actor:INTERNAL:dept',
  input: {
    groupId: group,
    caseIds: [id, other],
    idempotencyKey: 'original-key',
  },
});
beforeEach(() => vi.resetAllMocks());
describe('handling group pure command contract', () => {
  it('requires stable UUID membership, no hidden anchors and a canonical untrimmed key', () => {
    expect(isCaseHandlingGroupAttempt(attempt())).toBe(true);
    expect(isCaseHandlingGroupAttempt({ ...attempt(), actorId: 'extra' })).toBe(
      false,
    );
    for (const idempotencyKey of ['', ' key', 'key ', 'x'.repeat(129)])
      expect(
        isCaseHandlingGroupAttempt({
          ...attempt(),
          input: { ...attempt().input, idempotencyKey },
        }),
      ).toBe(false);
    expect(
      isCaseHandlingGroupAttempt({
        ...attempt(),
        input: { groupId: group, caseIds: [id], idempotencyKey: 'key' },
      }),
    ).toBe(false);
    expect(
      isCaseHandlingGroupAttempt({
        ...attempt(),
        input: { groupId: group, caseIds: [id, id], idempotencyKey: 'key' },
      }),
    ).toBe(false);
    expect(
      isCaseHandlingGroupAttempt({
        ...attempt(),
        input: {
          groupId: group,
          caseIds: Array.from(
            { length: 21 },
            (_, i) =>
              `${String(i).padStart(8, '0')}-1234-4234-8234-123456789abc`,
          ),
          idempotencyKey: 'key',
        },
      }),
    ).toBe(false);
  });
  it('uses case-insensitive UUID identity while retaining original inputs and Unicode key limits', () => {
    const groupId = 'ABCDEFAB-1234-4234-8234-123456789ABC';
    const original = {
      kind: 'CREATE' as const,
      actorKey: 'actor:INTERNAL:dept',
      input: {
        groupId,
        caseIds: [id, other],
        idempotencyKey: '😀'.repeat(128),
      },
    };
    expect(isCaseHandlingGroupAttempt(original)).toBe(true);
    expect(
      isCaseHandlingGroupCommandResult(
        {
          id: groupId.toLowerCase(),
          revision: 1,
          status: 'ACTIVE',
          recordedAt: '2026-10-20T00:00:00.000Z',
        },
        original,
      ),
    ).toBe(true);
    expect(original.input.groupId).toBe(groupId);
    expect(
      isCaseHandlingGroupAttempt({
        ...original,
        input: { ...original.input, idempotencyKey: '😀'.repeat(129) },
      }),
    ).toBe(false);
  });
  it('strictly correlates the full result with the original command', () => {
    const result = {
      id: group,
      revision: 1,
      status: 'ACTIVE',
      recordedAt: '2026-10-20T00:00:00.000Z',
    };
    expect(isCaseHandlingGroupCommandResult(result, attempt())).toBe(true);
    expect(
      isCaseHandlingGroupCommandResult({ ...result, caseId: id }, attempt()),
    ).toBe(false);
    expect(
      isCaseHandlingGroupCommandResult({ ...result, revision: 2 }, attempt()),
    ).toBe(false);
    expect(isCaseHandlingGroupCommandResult({ ...result, id }, attempt())).toBe(
      false,
    );
  });
});

const source = {
  caseId: id,
  businessNo: 'CA-合成001',
  customerId: '66666666-6666-4666-8666-666666666666',
  customerName: '合成客户',
  stage: 'WAITING_ARCHIVE',
};
const detail = () => ({
  id: group,
  revision: 1,
  status: 'ACTIVE',
  createdAt: '2026-10-20T00:00:00.000Z',
  members: [source],
  canDissolve: false,
});
describe('handling group frozen production API', () => {
  it('reads the real capability and paged candidates with only frozen query fields', async () => {
    http.getJson
      .mockResolvedValueOnce({ canCreate: true })
      .mockResolvedValueOnce({
        items: [source],
        total: 1,
        page: 2,
        pageSize: 100,
      });
    await expect(getCaseHandlingGroupCapability()).resolves.toEqual({
      canCreate: true,
    });
    await expect(
      listCaseHandlingGroupCandidates({
        page: 2,
        pageSize: 100,
        customerId: source.customerId,
        q: '  CA-合成  ',
      }),
    ).resolves.toMatchObject({ items: [source], page: 2 });
    expect(http.getJson.mock.calls.map(([path]) => path)).toEqual([
      '/case-handling-groups/capability',
      `/case-handling-groups/candidates?page=2&pageSize=100&customerId=${source.customerId}&q=CA-%E5%90%88%E6%88%90`,
    ]);
  });
  it('accepts a partial readable member projection without inventing a total member count', async () => {
    http.getJson.mockResolvedValueOnce(detail()).mockResolvedValueOnce({
      items: [detail()],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await expect(getCaseHandlingGroup(group)).resolves.toEqual(detail());
    await expect(listCaseHandlingGroups()).resolves.toMatchObject({
      items: [detail()],
    });
  });
  it.each([{ canCreate: true, actorId: id }, { canCreate: 1 }, {}])(
    'rejects malformed capability %j',
    async (value) => {
      http.getJson.mockResolvedValue(value);
      await expect(getCaseHandlingGroupCapability()).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    },
  );
  it.each([
    { ...detail(), hiddenMemberCount: 1 },
    { ...detail(), members: [{ ...source, feeAmount: '1.00' }] },
    { ...detail(), members: [{ ...source, stage: 'UNKNOWN' }] },
    { ...detail(), members: [source, source] },
    { ...detail(), id },
  ])('rejects non-contract detail data %j', async (value) => {
    http.getJson.mockResolvedValue(value);
    await expect(getCaseHandlingGroup(group)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it.each([
    { pageSize: 101 },
    { page: 0 },
    { page: 2_147_483_647, pageSize: 100 },
    { caseIds: [id] },
    { customerId: 'not-uuid' },
    { q: '😀'.repeat(201) },
  ])('rejects invalid candidate query before reading %j', async (query) => {
    await expect(
      listCaseHandlingGroupCandidates(query as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(http.getJson).not.toHaveBeenCalled();
  });
  it.each(['😀'.repeat(200), '😀\uFE0F'.repeat(200), 'a\uFE0F'.repeat(200)])(
    'uses actual validator length semantics for candidate q case %#',
    async (q) => {
      http.getJson.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
      await expect(
        listCaseHandlingGroupCandidates({ q }),
      ).resolves.toBeDefined();
    },
  );
  it('checks page identity, strict fields and duplicate visible group IDs', async () => {
    for (const value of [
      { items: [detail()], total: 1, page: 2, pageSize: 20 },
      { items: [detail()], total: 1, page: 1, pageSize: 20, hiddenCount: 2 },
      { items: [detail(), detail()], total: 2, page: 1, pageSize: 20 },
    ]) {
      http.getJson.mockResolvedValueOnce(value);
      await expect(listCaseHandlingGroups()).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
  });
  it('captures original create body/key/order and disables CSRF replay', async () => {
    let resolve!: (value: unknown) => void;
    http.requestJson.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const input = {
      groupId: group,
      caseIds: [other, id],
      idempotencyKey: 'original-key',
    };
    const response = createCaseHandlingGroup(input, {
      retryOnCsrfInvalid: true,
    });
    input.caseIds.reverse();
    input.groupId = id;
    input.idempotencyKey = 'changed';
    resolve({
      id: group,
      revision: 1,
      status: 'ACTIVE',
      recordedAt: '2026-10-20T00:00:00.000Z',
    });
    await expect(response).resolves.toMatchObject({ id: group });
    expect(http.requestJson).toHaveBeenCalledExactlyOnceWith(
      '/case-handling-groups',
      {
        method: 'POST',
        body: {
          groupId: group,
          caseIds: [other, id],
          idempotencyKey: 'original-key',
        },
        retryOnCsrfInvalid: false,
      },
    );
  });
  it('puts the dissolve target in the route and preserves the exact revision/key body', async () => {
    http.requestJson.mockResolvedValue({
      id: group,
      revision: 2,
      status: 'DISSOLVED',
      recordedAt: '2026-10-20T00:00:00.000Z',
    });
    const controller = new AbortController();
    await dissolveCaseHandlingGroup(
      group,
      { expectedRevision: 1, idempotencyKey: 'original-key' },
      { signal: controller.signal },
    );
    expect(http.requestJson).toHaveBeenCalledExactlyOnceWith(
      `/case-handling-groups/${group}/dissolve`,
      {
        method: 'POST',
        body: { expectedRevision: 1, idempotencyKey: 'original-key' },
        signal: controller.signal,
        retryOnCsrfInvalid: false,
      },
    );
  });
  it('refuses extra anchors and noncanonical keys without posting', async () => {
    await expect(
      createCaseHandlingGroup({
        groupId: group,
        caseIds: [id, other],
        idempotencyKey: ' key',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      dissolveCaseHandlingGroup(group, {
        expectedRevision: 1,
        idempotencyKey: 'key',
        groupId: id,
      } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(http.requestJson).not.toHaveBeenCalled();
  });
  it('preserves HTTP failure and rejects partial or mismatched command success', async () => {
    const forbidden = new Error('403');
    http.requestJson.mockRejectedValueOnce(forbidden);
    await expect(
      dissolveCaseHandlingGroup(group, {
        expectedRevision: 1,
        idempotencyKey: 'key',
      }),
    ).rejects.toBe(forbidden);
    http.requestJson.mockResolvedValueOnce({
      id: group,
      revision: 1,
      status: 'ACTIVE',
      recordedAt: '2026-10-20T00:00:00.000Z',
    });
    await expect(
      dissolveCaseHandlingGroup(group, {
        expectedRevision: 1,
        idempotencyKey: 'key',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(http.requestJson).toHaveBeenCalledTimes(2);
  });
});
