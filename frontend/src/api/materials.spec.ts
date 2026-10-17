import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import {
  deleteMaterial,
  downloadMaterialVersion,
  listOwnerMaterials,
  restoreMaterial,
  uploadMaterialFile,
  uploadCaseSectionRecordFile,
  uploadCaseExecutionFilingSupplementFile,
  uploadLawyerCaseExecutionFilingSupplementFile,
  type CaseSectionRecordUploadTarget,
  type ExecutionFilingSupplementUploadTarget,
  type UploadMaterialFileInput,
} from './materials';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const uploaded = {
  materialId: 'material-1',
  contentVersionId: 'version-1',
  originalFilename: '营业执照.pdf',
  purpose: 'IDENTITY_FULL',
  mimeType: 'application/pdf',
  sizeBytes: 17,
  sha256: 'a'.repeat(64),
};

const sectionCaseId = 'a1000000-0000-4000-8000-000000000001';
const sectionTargetId = 'a1000000-0000-4000-8000-000000000002';
const sectionRoundId = 'a1000000-0000-4000-8000-000000000003';
const sectionClosureVersionId = 'a1000000-0000-4000-8000-000000000004';
const sectionDraftId = 'a1000000-0000-4000-8000-000000000005';
const sectionMaterialId = 'a1000000-0000-4000-8000-000000000006';
const sectionContentVersionId = 'a1000000-0000-4000-8000-000000000007';
const sectionBytes = '%PDF-1.4\nsection record source bytes';
const sectionUploads: Array<{
  target: CaseSectionRecordUploadTarget;
  route: string;
  purpose: string;
  anchors: object;
}> = [
  {
    target: {
      kind: 'EXECUTION_MAILING',
      targetId: sectionTargetId,
      expectedRevision: 0,
    },
    route: 'execution-mailing-correction',
    purpose: 'MAIL_RECEIPT',
    anchors: { mailingId: sectionTargetId, expectedMailingRevision: 0 },
  },
  {
    target: {
      kind: 'EXECUTION_FILING',
      targetId: sectionTargetId,
      expectedRevision: 2,
    },
    route: 'execution-filing-correction',
    purpose: 'EXECUTION_FILING_PROOF',
    anchors: { filingId: sectionTargetId, expectedFilingRevision: 2 },
  },
  {
    target: {
      kind: 'EXECUTION_FINISH',
      targetId: sectionTargetId,
      expectedRevision: 0,
    },
    route: 'execution-finish-correction',
    purpose: 'EXECUTION_FINISH_BASIS',
    anchors: { finishId: sectionTargetId, expectedFinishRevision: 0 },
  },
  {
    target: {
      kind: 'JUDGMENT',
      targetId: sectionTargetId,
      expectedRevision: 3,
      trialRoundId: sectionRoundId,
    },
    route: 'judgment-record-correction',
    purpose: 'JUDGMENT',
    anchors: {
      judgmentId: sectionTargetId,
      expectedJudgmentRevision: 3,
      trialRoundId: sectionRoundId,
    },
  },
  {
    target: {
      kind: 'CLOSURE',
      targetId: sectionTargetId,
      expectedRevision: 0,
      expectedClosureVersionId: sectionClosureVersionId,
    },
    route: 'closure-record-correction',
    purpose: 'CASE_CLOSURE_DOCUMENT',
    anchors: {
      closureId: sectionTargetId,
      expectedClosureRevision: 0,
      expectedClosureVersionId: sectionClosureVersionId,
    },
  },
];
function sectionUploadFixture(
  index = 0,
  filename = '  更正附件.pdf  ',
  mime = 'application/pdf',
) {
  vi.stubGlobal('crypto', webcrypto);
  const scenario = sectionUploads[index]!;
  const file = new File([sectionBytes], filename, { type: mime });
  const draft = {
    id: sectionDraftId,
    ownerType: 'CASE',
    ownerId: sectionCaseId,
    category: scenario.purpose,
    purpose: scenario.purpose,
    originalFilename: file.name.trim(),
    declaredMimeType: file.type.trim(),
    expiresAt: '2026-12-01T00:00:00.000Z',
    recordCorrection: scenario.target,
  };
  const result = {
    materialId: sectionMaterialId,
    contentVersionId: sectionContentVersionId,
    originalFilename: draft.originalFilename,
    purpose: scenario.purpose,
    mimeType: draft.declaredMimeType,
    sizeBytes: file.size,
    sha256: createHash('sha256').update(sectionBytes).digest('hex'),
    recordCorrection: scenario.target,
  };
  return { scenario, file, draft, result };
}
function mockSectionUpload(draft: unknown, result: unknown) {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(draft), { status: 201 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify(result), { status: 201 }),
    );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
describe('precisely bound section record uploads', () => {
  it.each(sectionUploads.map((scenario, index) => ({ ...scenario, index })))(
    'prepares and uploads $target.kind using only its exact anchors',
    async ({ index }) => {
      const { scenario, file, draft, result } = sectionUploadFixture(index);
      const fetch = mockSectionUpload(draft, result);
      await expect(
        uploadCaseSectionRecordFile(sectionCaseId, scenario.target, file),
      ).resolves.toEqual(result);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls[0]?.[0]).toBe(
        `/api/v1/cases/${sectionCaseId}/${scenario.route}/upload-drafts`,
      );
      expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
        ...scenario.anchors,
        originalFilename: file.name.trim(),
        declaredMimeType: file.type,
      });
      expect(fetch.mock.calls[1]?.[0]).toBe(
        `/api/v1/materials/upload-drafts/${sectionDraftId}/content`,
      );
      expect(fetch.mock.calls[1]?.[1]?.method).toBe('PUT');
      expect(fetch.mock.calls[1]?.[1]?.body).toBe(file);
      expect(
        new Headers(fetch.mock.calls[1]?.[1]?.headers).get('Content-Type'),
      ).toBe('application/octet-stream');
    },
  );
  it.each([
    ['proof.PDF', 'application/pdf'],
    ['photo.JPG', 'image/jpeg'],
    ['photo.jpeg', 'image/jpeg'],
    ['photo.PNG', 'image/png'],
  ])('accepts the supported filename/MIME pair %s', async (filename, mime) => {
    const { scenario, file, draft, result } = sectionUploadFixture(
      3,
      filename,
      mime,
    );
    mockSectionUpload(draft, result);
    await expect(
      uploadCaseSectionRecordFile(sectionCaseId, scenario.target, file),
    ).resolves.toEqual(result);
  });
  it('rejects invalid targets and free context before HTTP without inferring anchors', async () => {
    const { file } = sectionUploadFixture();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const invalidTargets = [
      null,
      {},
      { kind: 'HEARING', targetId: sectionTargetId, expectedRevision: 0 },
      { ...sectionUploads[0]!.target, expectedRevision: -1 },
      { ...sectionUploads[0]!.target, expectedRevision: 0.5 },
      { ...sectionUploads[0]!.target, expectedRevision: '0' },
      {
        ...sectionUploads[0]!.target,
        expectedRevision: Number.MAX_SAFE_INTEGER + 1,
      },
      { ...sectionUploads[0]!.target, targetId: 'wrong' },
      { ...sectionUploads[0]!.target, ownerType: 'CASE' },
      { ...sectionUploads[0]!.target, category: 'MAIL_RECEIPT' },
      { ...sectionUploads[0]!.target, trialRoundId: sectionRoundId },
      { kind: 'JUDGMENT', targetId: sectionTargetId, expectedRevision: 0 },
      { ...sectionUploads[3]!.target, trialRoundId: null },
      { kind: 'CLOSURE', targetId: sectionTargetId, expectedRevision: 0 },
      { ...sectionUploads[4]!.target, expectedClosureVersionId: null },
      { ...sectionUploads[4]!.target, expectedVersion: 10 },
    ];
    for (const target of invalidTargets)
      await expect(
        uploadCaseSectionRecordFile(
          sectionCaseId,
          target as CaseSectionRecordUploadTarget,
          file,
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      uploadCaseSectionRecordFile('case-1', sectionUploads[0]!.target, file),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects unsupported, empty, oversized and mismatched files before HTTP', async () => {
    const { scenario } = sectionUploadFixture();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const file of [
      new File(['x'], ' '),
      new File(['x'], `${'x'.repeat(200)}.pdf`, { type: 'application/pdf' }),
      new File(['x'], 'proof.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      new File(['x'], 'proof.png', { type: 'application/pdf' }),
      new File([], 'proof.pdf', { type: 'application/pdf' }),
      new File(['x'], 'proof.pdf'),
    ]) {
      await expect(
        uploadCaseSectionRecordFile(sectionCaseId, scenario.target, file),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    for (const [index, limit] of [
      [0, 20],
      [1, 50],
      [2, 50],
      [3, 50],
      [4, 50],
    ] as const) {
      const file = new File(['bytes'], 'oversized.pdf', {
        type: 'application/pdf',
      });
      Object.defineProperty(file, 'size', { value: limit * 1024 * 1024 + 1 });
      await expect(
        uploadCaseSectionRecordFile(
          sectionCaseId,
          sectionUploads[index]!.target,
          file,
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  for (const index of [0, 1, 2, 3, 4]) {
    it(`${sectionUploads[index]!.target.kind} rejects a wrong draft before sending bytes`, async () => {
      const { scenario, file, draft, result } = sectionUploadFixture(index);
      const contexts = [
        { ...scenario.target, targetId: sectionCaseId },
        { ...scenario.target, expectedRevision: 99 },
        { ...scenario.target, kind: 'HEARING' },
        { ...scenario.target, permission: true },
        ...(scenario.target.kind === 'JUDGMENT'
          ? [{ ...scenario.target, trialRoundId: sectionCaseId }]
          : []),
        ...(scenario.target.kind === 'CLOSURE'
          ? [{ ...scenario.target, expectedClosureVersionId: sectionCaseId }]
          : []),
      ];
      for (const change of [
        { id: 'invalid' },
        { ownerType: 'CUSTOMER' },
        { ownerId: sectionTargetId },
        { category: 'COMPLAINT' },
        { purpose: 'COMPLAINT' },
        { originalFilename: 'other.pdf' },
        { declaredMimeType: 'image/png' },
        { expiresAt: '2026-02-30T00:00:00Z' },
        { recordCorrection: undefined },
        { reservedOwnerId: sectionCaseId },
        ...contexts.map((recordCorrection) => ({ recordCorrection })),
      ]) {
        const fetch = mockSectionUpload({ ...draft, ...change }, result);
        await expect(
          uploadCaseSectionRecordFile(sectionCaseId, scenario.target, file),
        ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
        expect(fetch).toHaveBeenCalledTimes(1);
      }
    });
    it(`${sectionUploads[index]!.target.kind} refuses unconfirmed final metadata and context`, async () => {
      const { scenario, file, draft, result } = sectionUploadFixture(index);
      for (const change of [
        { materialId: 'wrong' },
        { contentVersionId: 'wrong' },
        { originalFilename: 'other.pdf' },
        { purpose: 'COMPLAINT' },
        { mimeType: 'image/png' },
        { sizeBytes: file.size + 1 },
        { sizeBytes: String(file.size) },
        { sha256: 'f'.repeat(64) },
        { sha256: 'bad' },
        { reservedOwnerId: sectionCaseId },
        { recordCorrection: undefined },
        { recordCorrection: { ...scenario.target, targetId: sectionCaseId } },
        { recordCorrection: { ...scenario.target, expectedRevision: 100 } },
        ...(scenario.target.kind === 'JUDGMENT'
          ? [
              {
                recordCorrection: {
                  ...scenario.target,
                  trialRoundId: sectionCaseId,
                },
              },
            ]
          : []),
        ...(scenario.target.kind === 'CLOSURE'
          ? [
              {
                recordCorrection: {
                  ...scenario.target,
                  expectedClosureVersionId: sectionCaseId,
                },
              },
            ]
          : []),
      ]) {
        const fetch = mockSectionUpload(draft, { ...result, ...change });
        await expect(
          uploadCaseSectionRecordFile(sectionCaseId, scenario.target, file),
        ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
        expect(fetch).toHaveBeenCalledTimes(2);
      }
    });
  }
  it('freezes the original target through async preparation instead of adopting a changed revision', async () => {
    const { scenario, file, draft, result } = sectionUploadFixture(4);
    const target = structuredClone(scenario.target);
    const fetch = mockSectionUpload(draft, result);
    const pending = uploadCaseSectionRecordFile(sectionCaseId, target, file);
    target.expectedRevision = 50;
    if (target.kind === 'CLOSURE')
      target.expectedClosureVersionId = sectionCaseId;
    await expect(pending).resolves.toEqual(result);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      ...scenario.anchors,
      originalFilename: file.name.trim(),
      declaredMimeType: file.type,
    });
  });
  it.each([0, 1])(
    'does not retry a CSRF rejection during phase %s even when options request retry',
    async (phase) => {
      const { scenario, file, draft } = sectionUploadFixture();
      const fetch = vi.fn();
      if (phase === 1)
        fetch.mockResolvedValueOnce(
          new Response(JSON.stringify(draft), { status: 201 }),
        );
      fetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 'CSRF_INVALID',
            message: 'invalid CSRF',
            requestId: 'test',
          }),
          { status: 403 },
        ),
      );
      vi.stubGlobal('fetch', fetch);
      await expect(
        uploadCaseSectionRecordFile(sectionCaseId, scenario.target, file, {
          retryOnCsrfInvalid: true,
        }),
      ).rejects.toMatchObject({ code: 'CSRF_INVALID' });
      expect(fetch).toHaveBeenCalledTimes(phase + 1);
    },
  );
  it.each([0, 1])(
    'keeps an unknown outcome in phase %s as an error without retry or business correction',
    async (phase) => {
      const { scenario, file, draft } = sectionUploadFixture();
      const fetch = vi.fn();
      if (phase === 1)
        fetch.mockResolvedValueOnce(
          new Response(JSON.stringify(draft), { status: 201 }),
        );
      fetch.mockRejectedValueOnce(new TypeError('connection closed'));
      vi.stubGlobal('fetch', fetch);
      await expect(
        uploadCaseSectionRecordFile(sectionCaseId, scenario.target, file),
      ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
      expect(fetch).toHaveBeenCalledTimes(phase + 1);
    },
  );
  it.each([0, 1])(
    'forwards abort through phase %s without a confirmed version or retry',
    async (phase) => {
      const { scenario, file, draft } = sectionUploadFixture();
      const controller = new AbortController();
      const fetch = vi.fn();
      if (phase === 1)
        fetch.mockResolvedValueOnce(
          new Response(JSON.stringify(draft), { status: 201 }),
        );
      fetch.mockImplementationOnce(
        (_url: string, options?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener(
              'abort',
              () => reject(options.signal?.reason),
              { once: true },
            );
          }),
      );
      vi.stubGlobal('fetch', fetch);
      const pending = uploadCaseSectionRecordFile(
        sectionCaseId,
        scenario.target,
        file,
        { signal: controller.signal, headers: { 'X-Upload-Test': 'caller' } },
      );
      const rejected = expect(pending).rejects.toMatchObject({
        name: 'AbortError',
      });
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(phase + 1));
      expect(
        new Headers(fetch.mock.calls[phase]?.[1]?.headers).get('X-Upload-Test'),
      ).toBe('caller');
      controller.abort();
      await rejected;
      expect(fetch.mock.calls[phase]?.[1]?.signal.aborted).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(phase + 1);
    },
  );
  it('does not send bytes when the caller aborts as the draft response arrives', async () => {
    const { scenario, file, draft } = sectionUploadFixture();
    const controller = new AbortController();
    const fetch = vi.fn().mockImplementationOnce(async () => {
      controller.abort();
      return new Response(JSON.stringify(draft), { status: 201 });
    });
    vi.stubGlobal('fetch', fetch);
    await expect(
      uploadCaseSectionRecordFile(sectionCaseId, scenario.target, file, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

function supplementUploadFixture(
  expectedRevision = 0,
  filename = '  补交材料.pdf  ',
  mime = 'application/pdf',
) {
  const { file } = sectionUploadFixture(1, filename, mime);
  const target: ExecutionFilingSupplementUploadTarget = {
    filingId: sectionTargetId,
    supplementId: sectionRoundId,
    expectedRevision,
  };
  const draft = {
    id: sectionDraftId,
    ownerType: 'CASE',
    ownerId: sectionCaseId,
    category: 'EXECUTION_SUPPLEMENT',
    purpose: 'EXECUTION_SUPPLEMENT',
    originalFilename: file.name.trim(),
    declaredMimeType: file.type,
    expiresAt: '2026-12-01T00:00:00.000Z',
    executionSupplement: structuredClone(target),
  };
  const result = {
    materialId: sectionMaterialId,
    contentVersionId: sectionContentVersionId,
    originalFilename: draft.originalFilename,
    purpose: 'EXECUTION_SUPPLEMENT',
    mimeType: draft.declaredMimeType,
    sizeBytes: file.size,
    sha256: createHash('sha256').update(sectionBytes).digest('hex'),
    executionSupplement: structuredClone(target),
  };
  return { target, file, draft, result };
}
function mockSupplementUpload(draft: unknown, result: unknown) {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(draft), { status: 201 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify(result), { status: 200 }),
    );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('EF001 precisely bound execution supplement uploads', () => {
  for (const { audience, prefix, upload } of [
    {
      audience: 'internal',
      prefix: 'cases',
      upload: uploadCaseExecutionFilingSupplementFile,
    },
    {
      audience: 'lawyer',
      prefix: 'lawyer/cases',
      upload: uploadLawyerCaseExecutionFilingSupplementFile,
    },
  ]) {
    it.each([0, 2])(
      `${audience} uses fixed routes and exact revision %s without a business save`,
      async (revision) => {
        const { target, file, draft, result } =
          supplementUploadFixture(revision);
        const fetch = mockSupplementUpload(draft, result);
        await expect(upload(sectionCaseId, target, file)).resolves.toEqual(
          result,
        );
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch.mock.calls[0]?.[0]).toBe(
          `/api/v1/${prefix}/${sectionCaseId}/execution-filings/${target.filingId}/supplements/${target.supplementId}/upload-drafts`,
        );
        expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST');
        expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
          expectedRevision: revision,
          originalFilename: file.name.trim(),
          declaredMimeType: file.type,
        });
        expect(fetch.mock.calls[1]?.[0]).toBe(
          `/api/v1/materials/upload-drafts/${draft.id}/content`,
        );
        expect(fetch.mock.calls[1]?.[1]?.method).toBe('PUT');
        expect(fetch.mock.calls[1]?.[1]?.body).toBe(file);
        expect(
          new Headers(fetch.mock.calls[1]?.[1]?.headers).get('Content-Type'),
        ).toBe('application/octet-stream');
        expect(result).not.toHaveProperty('reservedOwnerId');
      },
    );
    it.each([
      ['proof.PDF', 'application/pdf'],
      ['photo.JPG', 'image/jpeg'],
      ['photo.jpeg', 'image/jpeg'],
      ['photo.PNG', 'image/png'],
    ])(
      `${audience} accepts the supported filename/MIME pair %s`,
      async (filename, mime) => {
        const { target, file, draft, result } = supplementUploadFixture(
          0,
          filename,
          mime,
        );
        mockSupplementUpload(draft, result);
        await expect(upload(sectionCaseId, target, file)).resolves.toEqual(
          result,
        );
      },
    );
    it(`${audience} rejects invalid anchors, free context and invalid files before HTTP`, async () => {
      const { target, file } = supplementUploadFixture();
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      for (const invalid of [
        null,
        {},
        { ...target, filingId: 'wrong' },
        { ...target, supplementId: 'wrong' },
        { ...target, expectedRevision: undefined },
        { ...target, expectedRevision: -1 },
        { ...target, expectedRevision: 0.5 },
        { ...target, expectedRevision: '0' },
        { ...target, expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
        { ...target, expectedRevision: Infinity },
        { ...target, caseId: sectionCaseId },
        { ...target, ownerType: 'CASE' },
        { ...target, category: 'EXECUTION_SUPPLEMENT' },
        { ...target, kind: 'EXECUTION_FILING' },
        { ...target, expectedVersion: 18 },
      ]) {
        await expect(
          upload(
            sectionCaseId,
            invalid as ExecutionFilingSupplementUploadTarget,
            file,
          ),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      }
      await expect(upload('case-1', target, file)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      await expect(
        upload(sectionCaseId, target, new Blob(['x']) as File),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      for (const invalidFile of [
        new File(['x'], ' ', { type: 'application/pdf' }),
        new File(['x'], `${'x'.repeat(200)}.pdf`, { type: 'application/pdf' }),
        new File(['x'], 'bad\u0001name.pdf', { type: 'application/pdf' }),
        new File(['x'], 'bad\u007fname.pdf', { type: 'application/pdf' }),
        new File(['x'], 'proof.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        new File(['x'], 'proof.png', { type: 'application/pdf' }),
        new File([], 'proof.pdf', { type: 'application/pdf' }),
        new File(['x'], 'proof.pdf'),
      ])
        await expect(
          upload(sectionCaseId, target, invalidFile),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      for (const size of [
        50 * 1024 * 1024 + 1,
        Number.MAX_SAFE_INTEGER + 1,
        NaN,
      ]) {
        const oversized = new File(['x'], 'proof.pdf', {
          type: 'application/pdf',
        });
        Object.defineProperty(oversized, 'size', { value: size });
        await expect(
          upload(sectionCaseId, target, oversized),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      }
      expect(fetch).not.toHaveBeenCalled();
    });
    it(`${audience} rejects wrong or incomplete draft metadata before sending bytes`, async () => {
      const { target, file, draft, result } = supplementUploadFixture();
      for (const change of [
        { id: 'wrong' },
        { ownerType: 'CUSTOMER' },
        { ownerId: sectionTargetId },
        { category: 'EXECUTION_APPLICATION' },
        { purpose: 'EXECUTION_FILING_PROOF' },
        { originalFilename: 'other.pdf' },
        { declaredMimeType: 'image/png' },
        { expiresAt: '2026-02-30T00:00:00Z' },
        { reservedOwnerId: sectionCaseId },
        { actorUserId: sectionCaseId },
        { recordCorrection: sectionUploads[1]!.target },
        { executionSupplement: undefined },
        { executionSupplement: null },
        { executionSupplement: { ...target, filingId: sectionCaseId } },
        { executionSupplement: { ...target, supplementId: sectionCaseId } },
        { executionSupplement: { ...target, expectedRevision: 1 } },
        { executionSupplement: { ...target, expectedRevision: '0' } },
        { executionSupplement: { ...target, supplementId: undefined } },
        { executionSupplement: { ...target, ownerId: sectionCaseId } },
      ]) {
        const fetch = mockSupplementUpload({ ...draft, ...change }, result);
        await expect(upload(sectionCaseId, target, file)).rejects.toMatchObject(
          { code: 'INVALID_RESPONSE' },
        );
        expect(fetch).toHaveBeenCalledTimes(1);
      }
    });
    it(`${audience} refuses unconfirmed content metadata, wrong bytes and context`, async () => {
      const { target, file, draft, result } = supplementUploadFixture(2);
      for (const change of [
        { materialId: 'wrong' },
        { contentVersionId: 'wrong' },
        { materialId: undefined },
        { contentVersionId: undefined },
        { originalFilename: 'other.pdf' },
        { purpose: 'EXECUTION_APPLICATION' },
        { mimeType: 'image/png' },
        { sizeBytes: file.size + 1 },
        { sizeBytes: String(file.size) },
        { sizeBytes: -1 },
        { sha256: 'f'.repeat(64) },
        { sha256: 'bad' },
        { sha256: undefined },
        { reservedOwnerId: sectionCaseId },
        { ownerId: sectionCaseId },
        { category: 'EXECUTION_SUPPLEMENT' },
        { actorUserId: sectionCaseId },
        { recordCorrection: sectionUploads[1]!.target },
        { executionSupplement: undefined },
        { executionSupplement: { ...target, filingId: sectionCaseId } },
        { executionSupplement: { ...target, supplementId: sectionCaseId } },
        { executionSupplement: { ...target, expectedRevision: 3 } },
        { executionSupplement: { ...target, expectedRevision: '2' } },
        {
          executionSupplement: {
            ...target,
            internalActorUserId: sectionCaseId,
          },
        },
      ]) {
        const fetch = mockSupplementUpload(draft, { ...result, ...change });
        await expect(upload(sectionCaseId, target, file)).rejects.toMatchObject(
          { code: 'INVALID_RESPONSE' },
        );
        expect(fetch).toHaveBeenCalledTimes(2);
      }
    });
    it(`${audience} snapshots the original anchors, revision and lifecycle options before asynchronous hashing`, async () => {
      const { target, file, draft, result } = supplementUploadFixture(1);
      const original = structuredClone(target);
      const controller = new AbortController();
      const options = {
        signal: controller.signal,
        headers: { 'X-Upload-Test': 'original' },
      };
      const fetch = mockSupplementUpload(draft, result);
      const pending = upload(sectionCaseId, target, file, options);
      target.filingId = sectionCaseId;
      target.supplementId = sectionCaseId;
      target.expectedRevision = 99;
      options.signal = AbortSignal.abort();
      options.headers['X-Upload-Test'] = 'changed';
      await expect(pending).resolves.toEqual(result);
      expect(fetch.mock.calls[0]?.[0]).toContain(
        `/execution-filings/${original.filingId}/supplements/${original.supplementId}/`,
      );
      expect(
        JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).expectedRevision,
      ).toBe(original.expectedRevision);
      for (const call of fetch.mock.calls) {
        expect(new Headers(call[1]?.headers).get('X-Upload-Test')).toBe(
          'original',
        );
        expect(call[1]?.signal.aborted).toBe(false);
      }
    });
    it.each([0, 1])(
      `${audience} never retries phase %s CSRF rejection even if explicitly requested`,
      async (phase) => {
        const { target, file, draft } = supplementUploadFixture();
        const fetch = vi.fn();
        if (phase === 1)
          fetch.mockResolvedValueOnce(
            new Response(JSON.stringify(draft), { status: 201 }),
          );
        fetch.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              code: 'CSRF_INVALID',
              message: 'invalid CSRF',
              requestId: 'test',
            }),
            { status: 403 },
          ),
        );
        vi.stubGlobal('fetch', fetch);
        await expect(
          upload(sectionCaseId, target, file, { retryOnCsrfInvalid: true }),
        ).rejects.toMatchObject({ code: 'CSRF_INVALID' });
        expect(fetch).toHaveBeenCalledTimes(phase + 1);
      },
    );
    it.each([0, 1])(
      `${audience} preserves phase %s unknown outcomes without retry or a confirmed version`,
      async (phase) => {
        const { target, file, draft } = supplementUploadFixture();
        const fetch = vi.fn();
        if (phase === 1)
          fetch.mockResolvedValueOnce(
            new Response(JSON.stringify(draft), { status: 201 }),
          );
        fetch.mockRejectedValueOnce(new TypeError('connection closed'));
        vi.stubGlobal('fetch', fetch);
        await expect(upload(sectionCaseId, target, file)).rejects.toMatchObject(
          { code: 'NETWORK_ERROR' },
        );
        expect(fetch).toHaveBeenCalledTimes(phase + 1);
      },
    );
    it.each([0, 1])(
      `${audience} forwards abort during phase %s without confirming a content version`,
      async (phase) => {
        const { target, file, draft } = supplementUploadFixture();
        const controller = new AbortController();
        const fetch = vi.fn();
        if (phase === 1)
          fetch.mockResolvedValueOnce(
            new Response(JSON.stringify(draft), { status: 201 }),
          );
        fetch.mockImplementationOnce(
          (_url: string, options?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              options?.signal?.addEventListener(
                'abort',
                () => reject(options.signal?.reason),
                { once: true },
              );
            }),
        );
        vi.stubGlobal('fetch', fetch);
        const pending = upload(sectionCaseId, target, file, {
          signal: controller.signal,
          headers: { 'X-Upload-Test': 'caller' },
        });
        const rejected = expect(pending).rejects.toMatchObject({
          name: 'AbortError',
        });
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(phase + 1));
        expect(
          new Headers(fetch.mock.calls[phase]?.[1]?.headers).get(
            'X-Upload-Test',
          ),
        ).toBe('caller');
        controller.abort();
        await rejected;
        expect(fetch.mock.calls[phase]?.[1]?.signal.aborted).toBe(true);
        expect(fetch).toHaveBeenCalledTimes(phase + 1);
      },
    );
    it.each([0, 1])(
      `${audience} rejects phase %s late success after lifecycle abort`,
      async (phase) => {
        const { target, file, draft, result } = supplementUploadFixture();
        const controller = new AbortController();
        const fetch = vi.fn();
        if (phase === 1)
          fetch.mockResolvedValueOnce(
            new Response(JSON.stringify(draft), { status: 201 }),
          );
        fetch.mockImplementationOnce(async () => {
          controller.abort();
          return new Response(JSON.stringify(phase === 0 ? draft : result), {
            status: phase === 0 ? 201 : 200,
          });
        });
        vi.stubGlobal('fetch', fetch);
        await expect(
          upload(sectionCaseId, target, file, { signal: controller.signal }),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetch).toHaveBeenCalledTimes(phase + 1);
      },
    );
    it(`${audience} sends nothing for a pre-aborted session`, async () => {
      const { target, file } = supplementUploadFixture();
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      await expect(
        upload(sectionCaseId, target, file, { signal: AbortSignal.abort() }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(fetch).not.toHaveBeenCalled();
    });
  }
  it('decodes the new category in owner metadata while denying generic creation for every owner', async () => {
    const { file, result } = supplementUploadFixture();
    const item = {
      id: result.materialId,
      ownerType: 'CASE',
      ownerId: sectionCaseId,
      category: 'EXECUTION_SUPPLEMENT',
      purpose: 'EXECUTION_SUPPLEMENT',
      currentVersionId: result.contentVersionId,
      status: 'ACTIVE',
      version: 1,
      deletedAt: null,
      createdAt: '2026-10-16T01:00:00Z',
      updatedAt: '2026-10-16T01:00:00Z',
      contentVersions: [
        {
          id: result.contentVersionId,
          materialId: result.materialId,
          originalFilename: result.originalFilename,
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes,
          sha256: result.sha256,
          status: 'AVAILABLE',
          createdAt: '2026-10-16T01:00:00Z',
        },
      ],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [item], total: 1 })),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(listOwnerMaterials('CASE', sectionCaseId)).resolves.toEqual({
      items: [item],
      total: 1,
    });
    fetch.mockClear();
    for (const ownerType of [
      'CASE',
      'CUSTOMER',
      'LEAD_DRAFT',
      'NOTARY_MATTER',
    ] as const)
      for (const [category, purpose] of [
        ['EXECUTION_SUPPLEMENT', 'EXECUTION_SUPPLEMENT'],
        ['EXECUTION_SUPPLEMENT', 'EXECUTION_APPLICATION'],
        ['EXECUTION_APPLICATION', 'EXECUTION_SUPPLEMENT'],
      ] as const) {
        const input: UploadMaterialFileInput = {
          ownerType,
          ownerId: sectionCaseId,
          category,
          purpose,
          file,
        };
        await expect(uploadMaterialFile(input)).rejects.toMatchObject({
          code: 'VALIDATION_ERROR',
        });
      }
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('materials API', () => {
  it.each([
    ['SECOND_INSTANCE_DOCUMENT', 'SECOND_INSTANCE_DOCUMENT'],
    ['SECOND_INSTANCE_SERVICE', 'SECOND_INSTANCE_SERVICE'],
    ['SECOND_INSTANCE_JUDGMENT', 'SECOND_INSTANCE_JUDGMENT'],
    ['EXECUTION_APPLICATION', 'EXECUTION_APPLICATION'],
    ['EXECUTION_FILING_PROOF', 'EXECUTION_FILING_PROOF'],
    ['EXECUTION_FINISH_BASIS', 'EXECUTION_FINISH_BASIS'],
    ['CASE_CLOSURE_DOCUMENT', 'CASE_CLOSURE_DOCUMENT'],
  ] as const)(
    'uploads the explicit %s category and purpose',
    async (category, purpose) => {
      const file = new File(['workflow bytes'], '案件材料.pdf', {
        type: 'application/pdf',
      });
      const uploadedResult = {
        ...uploaded,
        materialId: `material-${category}`,
        contentVersionId: `version-${category}`,
        originalFilename: file.name,
        purpose,
        mimeType: file.type,
        sizeBytes: file.size,
      };
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: 'draft-second-instance',
              ownerType: 'CASE',
              ownerId: 'case-1',
              category,
              purpose,
              originalFilename: file.name,
              declaredMimeType: file.type,
              expiresAt: '2026-10-07T00:00:00Z',
            }),
          ),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify(uploadedResult)));
      vi.stubGlobal('fetch', fetch);
      await expect(
        uploadMaterialFile({
          ownerType: 'CASE',
          ownerId: 'case-1',
          category,
          purpose,
          file,
        }),
      ).resolves.toMatchObject({ contentVersionId: `version-${category}` });
      expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
        category,
        purpose,
        ownerId: 'case-1',
      });
    },
  );

  it('accepts only PDF, DOC, and DOCX for execution applications', async () => {
    const file = new File(['docx bytes'], '执行申请书.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const uploadedResult = {
      ...uploaded,
      materialId: 'execution-material',
      contentVersionId: 'execution-version',
      originalFilename: file.name,
      purpose: 'EXECUTION_APPLICATION',
      mimeType: file.type,
      sizeBytes: file.size,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'draft-execution',
            ownerType: 'CASE',
            ownerId: 'case-1',
            category: 'EXECUTION_APPLICATION',
            purpose: 'EXECUTION_APPLICATION',
            originalFilename: file.name,
            declaredMimeType: file.type,
            expiresAt: '2026-10-08T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(uploadedResult)));
    vi.stubGlobal('fetch', fetch);
    await expect(
      uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: 'case-1',
        category: 'EXECUTION_APPLICATION',
        purpose: 'EXECUTION_APPLICATION',
        file,
      }),
    ).resolves.toMatchObject({ contentVersionId: 'execution-version' });

    const image = new File(['png bytes'], '执行申请书.png', {
      type: 'image/png',
    });
    await expect(
      uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: 'case-1',
        category: 'EXECUTION_APPLICATION',
        purpose: 'EXECUTION_APPLICATION',
        file: image,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('uses the dedicated customer proof category and rejects a file over 20 MiB before upload', async () => {
    const file = new File(['%PDF-1.4'], 'proof.pdf', {
      type: 'application/pdf',
    });
    const result = {
      ...uploaded,
      originalFilename: file.name,
      purpose: 'CUSTOMER_RIGHT_EVIDENCE',
      mimeType: file.type,
      sizeBytes: file.size,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'draft-proof',
            ownerType: 'CUSTOMER',
            ownerId: 'customer-1',
            category: 'CUSTOMER_RIGHT_EVIDENCE',
            purpose: 'CUSTOMER_RIGHT_EVIDENCE',
            originalFilename: file.name,
            declaredMimeType: file.type,
            expiresAt: '2026-10-08T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', fetch);
    await expect(
      uploadMaterialFile({
        ownerType: 'CUSTOMER',
        ownerId: 'customer-1',
        category: 'CUSTOMER_RIGHT_EVIDENCE',
        purpose: 'CUSTOMER_RIGHT_EVIDENCE',
        file,
      }),
    ).resolves.toEqual(result);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      category: 'CUSTOMER_RIGHT_EVIDENCE',
      purpose: 'CUSTOMER_RIGHT_EVIDENCE',
    });
    const tooLarge = new File(
      [new Uint8Array(20 * 1024 * 1024 + 1)],
      'large.pdf',
      { type: 'application/pdf' },
    );
    await expect(
      uploadMaterialFile({
        ownerType: 'CUSTOMER',
        ownerId: 'customer-1',
        category: 'CUSTOMER_RIGHT_EVIDENCE',
        purpose: 'CUSTOMER_RIGHT_EVIDENCE',
        file: tooLarge,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('uploads a real customer agreement file through the matching category and purpose', async () => {
    const file = new File(['agreement bytes'], '客户协议.pdf', {
      type: 'application/pdf',
    });
    const result = {
      ...uploaded,
      materialId: 'agreement-material',
      contentVersionId: 'agreement-version',
      originalFilename: file.name,
      purpose: 'CUSTOMER_AGREEMENT',
      mimeType: file.type,
      sizeBytes: file.size,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'agreement-draft',
            ownerType: 'CUSTOMER',
            ownerId: 'customer-1',
            category: 'CUSTOMER_AGREEMENT',
            purpose: 'CUSTOMER_AGREEMENT',
            originalFilename: file.name,
            declaredMimeType: file.type,
            expiresAt: '2026-10-09T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', fetch);

    await expect(
      uploadMaterialFile({
        ownerType: 'CUSTOMER',
        ownerId: 'customer-1',
        category: 'CUSTOMER_AGREEMENT' as never,
        purpose: 'CUSTOMER_AGREEMENT' as never,
        file,
      }),
    ).resolves.toEqual(result);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      category: 'CUSTOMER_AGREEMENT',
      purpose: 'CUSTOMER_AGREEMENT',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('uploads real JUDGMENT documents with the court-document limits', async () => {
    const file = new File(['actual judgment bytes'], '判决书.jpg', {
      type: 'image/jpeg',
    });
    const result = {
      ...uploaded,
      materialId: 'material-judgment',
      contentVersionId: 'judgment-version',
      originalFilename: file.name,
      purpose: 'JUDGMENT',
      mimeType: file.type,
      sizeBytes: file.size,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'draft-judgment',
            ownerType: 'CASE',
            ownerId: 'case-1',
            category: 'JUDGMENT',
            purpose: 'JUDGMENT',
            originalFilename: file.name,
            declaredMimeType: file.type,
            expiresAt: '2026-10-07T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', fetch);

    await expect(
      uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: 'case-1',
        category: 'JUDGMENT',
        purpose: 'JUDGMENT',
        file,
      }),
    ).resolves.toEqual(result);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      ownerId: 'case-1',
      category: 'JUDGMENT',
      purpose: 'JUDGMENT',
    });
    expect(fetch.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ body: file, method: 'PUT' }),
    );
  });

  it('uploads complaint files as real CASE-owned materials', async () => {
    const file = new File(['pdf-content'], '起诉状.pdf', {
      type: 'application/pdf',
    });
    const result = {
      ...uploaded,
      originalFilename: file.name,
      purpose: 'COMPLAINT',
      mimeType: file.type,
      sizeBytes: file.size,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'draft-case',
            ownerType: 'CASE',
            ownerId: 'case-1',
            category: 'COMPLAINT',
            purpose: 'COMPLAINT',
            originalFilename: file.name,
            declaredMimeType: file.type,
            expiresAt: '2026-09-30T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', fetch);
    await expect(
      uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: 'case-1',
        category: 'COMPLAINT',
        purpose: 'COMPLAINT',
        file,
      }),
    ).resolves.toEqual(result);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      ownerType: 'CASE',
      ownerId: 'case-1',
      category: 'COMPLAINT',
      purpose: 'COMPLAINT',
    });
    expect(fetch.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ body: file, method: 'PUT' }),
    );
  });

  it('validates complaint uploads before creating a server draft', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: 'case-1',
        category: 'COMPLAINT',
        purpose: 'COMPLAINT',
        file: new File(['data'], '诉状.exe', {
          type: 'application/octet-stream',
        }),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uploads filing evidence and screenshots with their exact CASE categories', async () => {
    const evidence = new File(['evidence'], '起诉证据.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const screenshot = new File(['image'], '立案截图.jpg', {
      type: 'image/jpeg',
    });
    let currentCategory = '';
    const fetch = vi
      .fn()
      .mockImplementation(
        async (url: string | URL | Request, init?: RequestInit) => {
          if (String(url).endsWith('/content')) {
            return new Response(
              JSON.stringify({
                ...uploaded,
                originalFilename:
                  currentCategory === 'FILING_EVIDENCE'
                    ? evidence.name
                    : screenshot.name,
                purpose: currentCategory,
                mimeType:
                  currentCategory === 'FILING_EVIDENCE'
                    ? evidence.type
                    : screenshot.type,
                sizeBytes:
                  currentCategory === 'FILING_EVIDENCE'
                    ? evidence.size
                    : screenshot.size,
              }),
            );
          }
          const body = JSON.parse(String(init?.body)) as {
            category: string;
            originalFilename: string;
          };
          currentCategory = body.category;
          const id =
            body.category === 'FILING_EVIDENCE'
              ? 'evidence-draft'
              : 'screenshot-draft';
          return new Response(
            JSON.stringify({
              id,
              ownerType: 'CASE',
              ownerId: 'case-1',
              category: body.category,
              purpose: body.category,
              originalFilename: body.originalFilename,
              declaredMimeType:
                body.category === 'FILING_EVIDENCE'
                  ? evidence.type
                  : screenshot.type,
              expiresAt: '2026-10-04T00:00:00.000Z',
            }),
          );
        },
      );
    vi.stubGlobal('fetch', fetch);

    await expect(
      uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: 'case-1',
        category: 'FILING_EVIDENCE',
        purpose: 'FILING_EVIDENCE',
        file: evidence,
      }),
    ).resolves.toMatchObject({ purpose: 'FILING_EVIDENCE' });
    await expect(
      uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: 'case-1',
        category: 'FILING_SCREENSHOT',
        purpose: 'FILING_SCREENSHOT',
        file: screenshot,
      }),
    ).resolves.toMatchObject({ purpose: 'FILING_SCREENSHOT' });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      category: 'FILING_EVIDENCE',
      purpose: 'FILING_EVIDENCE',
      originalFilename: evidence.name,
    });
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toMatchObject({
      category: 'FILING_SCREENSHOT',
      purpose: 'FILING_SCREENSHOT',
      originalFilename: screenshot.name,
    });
    expect(fetch.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ body: evidence, method: 'PUT' }),
    );
    expect(fetch.mock.calls[3]?.[1]).toEqual(
      expect.objectContaining({ body: screenshot, method: 'PUT' }),
    );
  });

  it('uploads each formal acceptance category as a real CASE-owned PDF, JPEG, or PNG file', async () => {
    const file = new File(['notice'], '受理通知书.png', { type: 'image/png' });
    const result = {
      ...uploaded,
      originalFilename: file.name,
      purpose: 'ACCEPTANCE_NOTICE',
      mimeType: file.type,
      sizeBytes: file.size,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'draft-acceptance',
            ownerType: 'CASE',
            ownerId: 'case-1',
            category: 'ACCEPTANCE_NOTICE',
            purpose: 'ACCEPTANCE_NOTICE',
            originalFilename: file.name,
            declaredMimeType: file.type,
            expiresAt: '2026-10-06T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', fetch);
    await expect(
      uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: 'case-1',
        category: 'ACCEPTANCE_NOTICE',
        purpose: 'ACCEPTANCE_NOTICE',
        file,
      }),
    ).resolves.toEqual(result);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      ownerType: 'CASE',
      ownerId: 'case-1',
      category: 'ACCEPTANCE_NOTICE',
      purpose: 'ACCEPTANCE_NOTICE',
    });
  });

  it('uploads a real fee proof through the existing CASE POST+PUT flow with its own purpose', async () => {
    const file = new File(['%PDF-1.4 proof bytes'], '费用发票.pdf', {
      type: 'application/pdf',
    });
    const result = {
      ...uploaded,
      purpose: 'FEE_PROOF',
      originalFilename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'proof-draft',
            ownerType: 'CASE',
            ownerId: 'case-1',
            category: 'FEE_PROOF',
            purpose: 'FEE_PROOF',
            originalFilename: file.name,
            declaredMimeType: file.type,
            expiresAt: '2026-10-18T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', fetch);
    await expect(
      uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: 'case-1',
        category: 'FEE_PROOF',
        purpose: 'FEE_PROOF',
        file,
      }),
    ).resolves.toEqual(result);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      ownerType: 'CASE',
      ownerId: 'case-1',
      category: 'FEE_PROOF',
      purpose: 'FEE_PROOF',
    });
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: 'PUT',
      body: file,
    });
  });
  it('rejects mislabelled, oversized or externally owned fee proofs before upload', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const file = new File(['proof'], '凭证.pdf', { type: 'application/pdf' });
    await expect(
      uploadMaterialFile({
        ownerType: 'NOTARY_MATTER',
        ownerId: 'matter',
        category: 'FEE_PROOF',
        purpose: 'FEE_PROOF',
        file,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: 'case',
        category: 'FEE_PROOF',
        purpose: 'PAYMENT_LIST',
        file,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: 'case',
        category: 'FEE_PROOF',
        purpose: 'FEE_PROOF',
        file: new File(['bad'], '凭证.pdf', { type: 'image/png' }),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: 'case',
        category: 'FEE_PROOF',
        purpose: 'FEE_PROOF',
        file: new File([new Uint8Array(50 * 1024 * 1024 + 1)], '超大.pdf', {
          type: 'application/pdf',
        }),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('enforces the distinct evidence and screenshot file type/size limits', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const invalidUploads = [
      {
        category: 'FILING_EVIDENCE' as const,
        purpose: 'FILING_EVIDENCE' as const,
        file: new File(['bad'], '证据.gif', { type: 'image/gif' }),
      },
      {
        category: 'FILING_SCREENSHOT' as const,
        purpose: 'FILING_SCREENSHOT' as const,
        file: new File(['bad'], '截图.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      },
      {
        category: 'FILING_EVIDENCE' as const,
        purpose: 'FILING_EVIDENCE' as const,
        file: new File([new Uint8Array(50 * 1024 * 1024 + 1)], '超大证据.pdf', {
          type: 'application/pdf',
        }),
      },
      {
        category: 'FILING_SCREENSHOT' as const,
        purpose: 'FILING_SCREENSHOT' as const,
        file: new File([new Uint8Array(20 * 1024 * 1024 + 1)], '超大截图.png', {
          type: 'image/png',
        }),
      },
    ];
    for (const upload of invalidUploads) {
      await expect(
        uploadMaterialFile({ ownerType: 'CASE', ownerId: 'case-1', ...upload }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('creates upload metadata then sends the original File as a raw body', async () => {
    const file = new File(['real-file-content'], '营业执照.pdf', {
      type: 'application/pdf',
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'draft-1',
            ownerType: 'CUSTOMER',
            ownerId: 'customer-1',
            category: 'CUSTOMER_IDENTITY',
            purpose: 'IDENTITY_FULL',
            originalFilename: file.name,
            declaredMimeType: file.type,
            expiresAt: '2026-09-22T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(uploaded)));
    vi.stubGlobal('fetch', fetch);

    await expect(
      uploadMaterialFile({
        ownerType: 'CUSTOMER',
        ownerId: 'customer-1',
        category: 'CUSTOMER_IDENTITY',
        purpose: 'IDENTITY_FULL',
        file,
      }),
    ).resolves.toEqual(uploaded);
    expect(fetch.mock.calls[0]).toEqual([
      '/api/v1/materials/upload-drafts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          ownerType: 'CUSTOMER',
          ownerId: 'customer-1',
          category: 'CUSTOMER_IDENTITY',
          purpose: 'IDENTITY_FULL',
          originalFilename: file.name,
          declaredMimeType: file.type,
        }),
      }),
    ]);
    expect(fetch.mock.calls[1]).toEqual([
      '/api/v1/materials/upload-drafts/draft-1/content',
      expect.objectContaining({ body: file, method: 'PUT' }),
    ]);
  });

  it('normalizes surrounding filename whitespace for metadata while uploading the original File bytes', async () => {
    const file = new File(['real-file-content'], '  营业执照.pdf  ', {
      type: 'application/pdf',
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'draft-1',
            ownerType: 'CUSTOMER',
            ownerId: 'customer-1',
            category: 'CUSTOMER_IDENTITY',
            purpose: 'IDENTITY_FULL',
            originalFilename: '营业执照.pdf',
            declaredMimeType: file.type,
            expiresAt: '2026-09-22T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...uploaded,
            originalFilename: '营业执照.pdf',
            sizeBytes: file.size,
          }),
        ),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(
      uploadMaterialFile({
        ownerType: 'CUSTOMER',
        ownerId: 'customer-1',
        category: 'CUSTOMER_IDENTITY',
        purpose: 'IDENTITY_FULL',
        file,
      }),
    ).resolves.toMatchObject({ originalFilename: '营业执照.pdf' });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      originalFilename: '营业执照.pdf',
    });
    expect(fetch.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ body: file }),
    );
  });

  it('rejects an empty normalized filename with the backend validation code before metadata upload', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      uploadMaterialFile({
        ownerType: 'CUSTOMER',
        ownerId: 'customer-1',
        category: 'CUSTOMER_IDENTITY',
        purpose: 'IDENTITY_FULL',
        file: new File(['content'], '   ', { type: 'application/pdf' }),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts and returns the server-reserved owner for lead drafts', async () => {
    const file = new File(['image'], '线索.png', { type: 'image/png' });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'draft-1',
            ownerType: 'LEAD_DRAFT',
            ownerId: 'reserved-lead-1',
            reservedOwnerId: 'reserved-lead-1',
            category: 'LEAD_SCREENSHOT',
            purpose: 'LEAD_SCREENSHOT',
            originalFilename: file.name,
            declaredMimeType: file.type,
            expiresAt: '2026-09-22T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...uploaded,
            originalFilename: file.name,
            purpose: 'LEAD_SCREENSHOT',
            mimeType: file.type,
            sizeBytes: file.size,
            reservedOwnerId: 'reserved-lead-1',
          }),
        ),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(
      uploadMaterialFile({
        ownerType: 'LEAD_DRAFT',
        category: 'LEAD_SCREENSHOT',
        purpose: 'LEAD_SCREENSHOT',
        file,
      }),
    ).resolves.toMatchObject({ reservedOwnerId: 'reserved-lead-1' });
  });

  it('uploads an opening photo as a real notary matter material', async () => {
    const file = new File(['photo'], '开箱.jpg', { type: 'image/jpeg' });
    const result = {
      ...uploaded,
      originalFilename: file.name,
      purpose: 'NOTARY_OPENING_PHOTO',
      mimeType: file.type,
      sizeBytes: file.size,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'draft-1',
            ownerType: 'NOTARY_MATTER',
            ownerId: 'matter-1',
            category: 'NOTARY_OPENING_PHOTO',
            purpose: 'NOTARY_OPENING_PHOTO',
            originalFilename: file.name,
            declaredMimeType: file.type,
            expiresAt: '2026-09-24T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', fetch);

    await expect(
      uploadMaterialFile({
        ownerType: 'NOTARY_MATTER',
        ownerId: 'matter-1',
        category: 'NOTARY_OPENING_PHOTO',
        purpose: 'NOTARY_OPENING_PHOTO',
        file,
      }),
    ).resolves.toEqual(result);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      ownerType: 'NOTARY_MATTER',
      ownerId: 'matter-1',
      category: 'NOTARY_OPENING_PHOTO',
      purpose: 'NOTARY_OPENING_PHOTO',
    });
    expect(fetch.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ body: file }),
    );
  });

  it('uploads a certificate PDF as a real notary matter material', async () => {
    const file = new File(['certificate'], '公证书.pdf', {
      type: 'application/pdf',
    });
    const result = {
      ...uploaded,
      originalFilename: file.name,
      purpose: 'NOTARY_CERTIFICATE',
      mimeType: file.type,
      sizeBytes: file.size,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'draft-2',
            ownerType: 'NOTARY_MATTER',
            ownerId: 'matter-1',
            category: 'NOTARY_CERTIFICATE',
            purpose: 'NOTARY_CERTIFICATE',
            originalFilename: file.name,
            declaredMimeType: file.type,
            expiresAt: '2026-09-28T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', fetch);

    await expect(
      uploadMaterialFile({
        ownerType: 'NOTARY_MATTER',
        ownerId: 'matter-1',
        category: 'NOTARY_CERTIFICATE',
        purpose: 'NOTARY_CERTIFICATE',
        file,
      }),
    ).resolves.toEqual(result);
  });

  it('rejects malformed upload and list responses', async () => {
    const file = new File(['real-file-content'], '营业执照.pdf', {
      type: 'application/pdf',
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ id: 'draft-1' }))),
    );
    await expect(
      uploadMaterialFile({
        ownerType: 'CUSTOMER',
        ownerId: 'customer-1',
        category: 'CUSTOMER_IDENTITY',
        purpose: 'IDENTITY_FULL',
        file,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ items: [{ id: 'material-1' }], total: 1 }),
          ),
        ),
    );
    await expect(
      listOwnerMaterials('CUSTOMER', 'customer-1'),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects a well-shaped upload response that does not match the requested purpose', async () => {
    const file = new File(['real-file-content'], '营业执照.pdf', {
      type: 'application/pdf',
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: 'draft-1',
              ownerType: 'CUSTOMER',
              ownerId: 'customer-1',
              category: 'CUSTOMER_IDENTITY',
              purpose: 'IDENTITY_FULL',
              originalFilename: file.name,
              declaredMimeType: file.type,
              expiresAt: '2026-09-22T00:00:00.000Z',
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ ...uploaded, purpose: 'LEAD_SCREENSHOT' }),
          ),
        ),
    );

    await expect(
      uploadMaterialFile({
        ownerType: 'CUSTOMER',
        ownerId: 'customer-1',
        category: 'CUSTOMER_IDENTITY',
        purpose: 'IDENTITY_FULL',
        file,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('decodes current material versions and uses optimistic delete/restore', async () => {
    const item = {
      id: 'material-1',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      category: 'CUSTOMER_IDENTITY',
      purpose: 'IDENTITY_FULL',
      currentVersionId: 'version-1',
      status: 'ACTIVE',
      version: 1,
      deletedAt: null,
      createdAt: '2026-09-21T00:00:00.000Z',
      updatedAt: '2026-09-21T00:00:00.000Z',
      contentVersions: [
        {
          id: 'version-1',
          materialId: 'material-1',
          originalFilename: '营业执照.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 128,
          sha256: 'a'.repeat(64),
          status: 'AVAILABLE',
          createdAt: '2026-09-21T00:00:00.000Z',
        },
      ],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [item], total: 1 })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'material-1', status: 'DELETED', version: 2 }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'material-1', status: 'ACTIVE', version: 3 }),
        ),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(listOwnerMaterials('CUSTOMER', 'customer-1')).resolves.toEqual(
      { items: [item], total: 1 },
    );
    await expect(deleteMaterial('material-1', 1)).resolves.toMatchObject({
      status: 'DELETED',
      version: 2,
    });
    await expect(restoreMaterial('material-1', 2)).resolves.toMatchObject({
      status: 'ACTIVE',
      version: 3,
    });
    expect(fetch.mock.calls[1]?.[0]).toBe(
      '/api/v1/materials/material-1?expectedVersion=1',
    );
    expect(fetch.mock.calls[2]?.[0]).toBe(
      '/api/v1/materials/material-1/restore',
    );
  });

  it('opens an authorized download only for the click and revokes its URL', async () => {
    const click = vi.fn();
    const remove = vi.fn();
    const anchor = { href: '', download: '', click, remove };
    vi.spyOn(document, 'createElement').mockReturnValue(
      anchor as unknown as HTMLAnchorElement,
    );
    const createObjectURL = vi.fn().mockReturnValue('blob:download-1');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Blob(['real-file']), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': "attachment; filename*=UTF-8''id.pdf",
          },
        }),
      ),
    );

    await downloadMaterialVersion('material-1', 'version-1');

    expect(anchor).toMatchObject({
      href: 'blob:download-1',
      download: 'id.pdf',
    });
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:download-1');
  });

  it('cancels a late blob before it creates a browser link', async () => {
    const controller = new AbortController();
    const click = vi.fn();
    const createObjectURL = vi.fn().mockReturnValue('blob:late-download');
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click,
      remove: vi.fn(),
    } as unknown as HTMLAnchorElement);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    let finishBlob!: (blob: Blob) => void;
    const response = new Response(new Blob(['original-file']));
    const readBlob = vi.spyOn(response, 'blob').mockReturnValue(
      new Promise<Blob>((resolve) => {
        finishBlob = resolve;
      }),
    );
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetch);

    const download = downloadMaterialVersion(
      'material-1',
      'version-1',
      controller.signal,
    );
    await vi.waitFor(() => expect(readBlob).toHaveBeenCalledOnce());
    controller.abort();
    finishBlob(new Blob(['late-file']));

    await expect(download).rejects.toMatchObject({ name: 'AbortError' });
    expect((fetch.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(
      true,
    );
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it('does not click if cancellation happens while preparing the link and releases its URL', async () => {
    const controller = new AbortController();
    const click = vi.fn();
    const createObjectURL = vi.fn(() => {
      controller.abort();
      return 'blob:cancel-during-link';
    });
    const revokeObjectURL = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click,
      remove: vi.fn(),
    } as unknown as HTMLAnchorElement);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new Blob(['file']))),
    );

    await expect(
      downloadMaterialVersion('material-1', 'version-1', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      'blob:cancel-during-link',
    );
  });
});
