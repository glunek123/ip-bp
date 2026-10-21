import { beforeEach, describe, expect, it, vi } from 'vitest';
const http = vi.hoisted(() => ({ getJson: vi.fn() }));
vi.mock('./http', async (original) => ({
  ...(await original<typeof import('./http')>()),
  getJson: http.getJson,
}));
import { ApiError } from './http';
import {
  getCaseHandlingGroupFees,
  getCaseHandlingGroupMaterials,
  type GroupResourceSnapshot,
} from './case-handling-group-resources';
const groupId = '55555555-5555-4555-8555-555555555555';
const caseId = '33333333-3333-4333-8333-333333333333';
const materialId = '44444444-4444-4444-8444-444444444444';
const cv = '66666666-6666-4666-8666-666666666666';
const snapshot: GroupResourceSnapshot = {
  groupId,
  revision: 1,
  status: 'ACTIVE',
};
const material = {
  caseId,
  businessNo: 'CA-合成001',
  materialId,
  contentVersionId: cv,
  originalFilename: '历史证据.pdf',
  mimeType: 'application/pdf',
  sizeBytes: '9007199254740993',
  sha256: 'a'.repeat(64),
  category: 'COMPLAINT',
  purpose: 'COMPLAINT',
  isCurrent: false,
};
const summary = {
  caseId,
  businessNo: 'CA-合成001',
  sourceType: 'NOTARY_MATTER_EVIDENCE',
  sourceId: materialId,
  category: 'SAMPLE',
  state: 'PENDING',
  amount: null,
};
const fee = {
  feeId: cv,
  caseId,
  businessNo: 'CA-合成001',
  type: '样品费',
  direction: '支出',
  status: '已登记',
  amount: '0.00',
  feeDate: '2026-10-21',
  source: '人工录入',
  sourceKind: null,
  sourceId: null,
  note: null,
  version: 1,
  proofMaterialId: materialId,
  proofContentVersionId: cv,
  proofOriginalFilename: '原凭证.pdf',
};
const materials = () => ({
  ...snapshot,
  items: [material],
  total: 1,
  page: 1,
  pageSize: 20,
});
const fees = () => ({
  ...snapshot,
  notarySummaries: [summary],
  canReadLedger: true,
  ledger: { items: [fee], total: 1, page: 1, pageSize: 20 },
});
beforeEach(() => vi.resetAllMocks());
describe('handling group frozen resource API', () => {
  it.each(['materials', 'fees'] as const)(
    'accepts the maximum legal offset and matching response page for %s',
    async (resource) => {
      const query = { page: 2_147_483_648, pageSize: 1 };
      const projection = { items: [], total: 0, ...query };
      http.getJson.mockResolvedValue(
        resource === 'materials'
          ? { ...snapshot, ...projection }
          : { ...fees(), ledger: projection },
      );
      const read =
        resource === 'materials'
          ? getCaseHandlingGroupMaterials
          : getCaseHandlingGroupFees;
      const result = await read(snapshot, query);
      expect('ledger' in result ? result.ledger : result).toMatchObject(
        projection,
      );
      expect(http.getJson).toHaveBeenCalledExactlyOnceWith(
        `/case-handling-groups/${groupId}/${resource}?page=2147483648&pageSize=1`,
        {},
      );
    },
  );
  it.each(['materials', 'fees'] as const)(
    'rejects an offset above the maximum without reading %s',
    async (resource) => {
      const read =
        resource === 'materials'
          ? getCaseHandlingGroupMaterials
          : getCaseHandlingGroupFees;
      for (const query of [
        { page: 2_147_483_649, pageSize: 1 },
        { page: 2_147_483_648, pageSize: 2 },
      ])
        await expect(read(snapshot, query)).rejects.toMatchObject({
          code: 'VALIDATION_ERROR',
        });
      expect(http.getJson).not.toHaveBeenCalled();
    },
  );
  it.each(['materials', 'fees'] as const)(
    'still rejects a mismatched response page at the legal boundary for %s',
    async (resource) => {
      const projection = {
        items: [],
        total: 0,
        page: 2_147_483_647,
        pageSize: 1,
      };
      http.getJson.mockResolvedValue(
        resource === 'materials'
          ? { ...snapshot, ...projection }
          : { ...fees(), ledger: projection },
      );
      const read =
        resource === 'materials'
          ? getCaseHandlingGroupMaterials
          : getCaseHandlingGroupFees;
      await expect(
        read(snapshot, { page: 2_147_483_648, pageSize: 1 }),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    },
  );
  it('reads exact historical CV and byte size as text using only the bounded page query', async () => {
    http.getJson.mockResolvedValue(materials());
    const signal = new AbortController().signal;
    await expect(
      getCaseHandlingGroupMaterials(snapshot, {}, { signal }),
    ).resolves.toMatchObject({ items: [material] });
    expect(http.getJson).toHaveBeenCalledExactlyOnceWith(
      `/case-handling-groups/${groupId}/materials?page=1&pageSize=20`,
      { signal },
    );
  });
  it('captures snapshot before awaiting and correlates a dissolved group response', async () => {
    const expected = { ...snapshot, revision: 2, status: 'DISSOLVED' as const };
    let resolve!: (value: unknown) => void;
    http.getJson.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const response = getCaseHandlingGroupMaterials(expected);
    expected.groupId = materialId;
    resolve({ ...materials(), revision: 2, status: 'DISSOLVED' });
    await expect(response).resolves.toMatchObject({
      groupId,
      revision: 2,
      status: 'DISSOLVED',
    });
  });
  it.each([
    { page: 0 },
    { pageSize: 101 },
    { page: 1.1 },
    { page: 2_147_483_647, pageSize: 100 },
    { caseIds: [caseId] },
    { departmentId: materialId },
    { pageSize: null },
  ])('rejects caller scope anchors or invalid pagination %j', async (query) => {
    await expect(
      getCaseHandlingGroupMaterials(snapshot, query as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(http.getJson).not.toHaveBeenCalled();
  });
  it.each([
    { ...snapshot, groupId: 'invalid' },
    { ...snapshot, revision: 2 },
    { ...snapshot, status: 'DISSOLVED' },
    { ...snapshot, departmentId: caseId },
  ])('rejects invalid snapshot %j before reading', async (value) => {
    await expect(
      getCaseHandlingGroupFees(value as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(http.getJson).not.toHaveBeenCalled();
  });
  it.each([
    { ...materials(), groupId: materialId },
    { ...materials(), revision: 2 },
    { ...materials(), status: 'DISSOLVED', revision: 2 },
    { ...materials(), hiddenCount: 1 },
    { ...materials(), page: 2 },
    { ...materials(), total: 0 },
    {
      ...materials(),
      items: [material, { ...material, caseId: caseId.toUpperCase() }],
      total: 2,
    },
  ])('rejects mismatched or non-contract materials %j', async (value) => {
    http.getJson.mockResolvedValue(value);
    await expect(getCaseHandlingGroupMaterials(snapshot)).rejects.toMatchObject(
      { code: 'INVALID_RESPONSE' },
    );
  });
  it.each([
    { ...material, category: 'FEE_PROOF' },
    { ...material, category: 'UNKNOWN' },
    { ...material, sizeBytes: 5 },
    { ...material, sizeBytes: '01' },
    { ...material, sha256: 'bad' },
    { ...material, contentVersionId: '' },
    { ...material, storageKey: 'private-path' },
    { ...material, isCurrent: 'false' },
  ])('rejects unsafe or malformed material %j', async (item) => {
    http.getJson.mockResolvedValue({ ...materials(), items: [item] });
    await expect(getCaseHandlingGroupMaterials(snapshot)).rejects.toMatchObject(
      { code: 'INVALID_RESPONSE' },
    );
  });
  it('preserves each notary source/category and keeps an unreadable ledger explicitly null', async () => {
    const summaries = [
      summary,
      {
        ...summary,
        state: 'KNOWN',
        amount: '0.00',
        sourceType: 'NOTARY_CERTIFICATE_FEE',
        category: 'NOTARY',
      },
      {
        ...summary,
        state: 'KNOWN',
        amount: '9007199254740993.01',
        sourceType: 'NOTARY_CERTIFICATE_FEE',
        category: 'DISCLOSURE',
      },
    ];
    http.getJson.mockResolvedValue({
      ...snapshot,
      notarySummaries: summaries,
      canReadLedger: false,
      ledger: null,
    });
    await expect(
      getCaseHandlingGroupFees(snapshot, { page: 2, pageSize: 100 }),
    ).resolves.toMatchObject({
      notarySummaries: summaries,
      canReadLedger: false,
      ledger: null,
    });
    expect(http.getJson).toHaveBeenCalledExactlyOnceWith(
      `/case-handling-groups/${groupId}/fees?page=2&pageSize=100`,
      {},
    );
  });
  it('keeps original fee and proof identities without merging amounts or source rows', async () => {
    http.getJson.mockResolvedValue(fees());
    await expect(getCaseHandlingGroupFees(snapshot)).resolves.toEqual(fees());
  });
  it.each([
    { ...fees(), canReadLedger: false },
    { ...fees(), ledger: null },
    { ...fees(), canReadLedger: 1 },
    { ...fees(), hiddenMemberCount: 1 },
    { ...fees(), notarySummaries: [summary, summary] },
    { ...fees(), notarySummaries: [{ ...summary, amount: '0.00' }] },
    {
      ...fees(),
      notarySummaries: [{ ...summary, state: 'KNOWN', amount: null }],
    },
    {
      ...fees(),
      notarySummaries: [{ ...summary, sourceType: 'NOTARY_CERTIFICATE_FEE' }],
    },
    { ...fees(), notarySummaries: [{ ...summary, sourceId: 'bad' }] },
    { ...fees(), notarySummaries: [{ ...summary, category: ['SAMPLE'] }] },
    { ...fees(), ledger: { ...fees().ledger, page: 2 } },
    { ...fees(), ledger: { ...fees().ledger, items: [fee, fee], total: 2 } },
  ])('fails closed for invalid fee projection %j', async (value) => {
    http.getJson.mockResolvedValue(value);
    await expect(getCaseHandlingGroupFees(snapshot)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it.each([
    { ...fee, amount: 0 },
    { ...fee, proofContentVersionId: null },
    { ...fee, feeDate: '2026-02-30' },
    { ...fee, version: 0 },
    { ...fee, feeId: 'bad' },
    { ...fee, direction: ['支出'] },
    { ...fee, sourceRows: [fee] },
  ])('rejects malformed or merged fee records %j', async (item) => {
    http.getJson.mockResolvedValue({
      ...fees(),
      ledger: { ...fees().ledger, items: [item] },
    });
    await expect(getCaseHandlingGroupFees(snapshot)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it.each([403, 404])(
    'preserves HTTP %i without turning it into an empty projection',
    async (status) => {
      const failure = new ApiError('not readable', status, 'DENIED');
      http.getJson.mockRejectedValue(failure);
      await expect(getCaseHandlingGroupFees(snapshot)).rejects.toBe(failure);
      expect(http.getJson).toHaveBeenCalledTimes(1);
    },
  );
});
