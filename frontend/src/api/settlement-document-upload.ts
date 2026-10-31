import {
  ApiError,
  requestBinary,
  requestJson,
  type RequestOptions,
} from './http';
import type { UploadedMaterial } from './materials';

export type SettlementDocumentUploadedMaterial = Omit<
  UploadedMaterial,
  'reservedOwnerId' | 'purpose'
> & {
  purpose: 'CASE_CLOSURE_DOCUMENT';
  caseId: string;
  settlementUpdateTarget: { id: string; expectedClosureVersionId: string };
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function uuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}
function invalidResponse(): ApiError {
  return new ApiError(
    '服务返回了无效的结算文书上传数据',
    200,
    'INVALID_RESPONSE',
  );
}
async function hash(file: File): Promise<string> {
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () =>
      reader.result instanceof ArrayBuffer
        ? resolve(reader.result)
        : reject(new ApiError('无法读取文件', 400, 'VALIDATION_ERROR'));
    reader.readAsArrayBuffer(file);
  });
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** Prepares an upload only. The settlement command must separately associate its content version. */
export async function uploadSettlementUpdateDocumentFile(
  caseId: string,
  expectedClosureVersionId: string,
  file: File,
  options: RequestOptions = {},
): Promise<SettlementDocumentUploadedMaterial> {
  if (
    !uuid(caseId) ||
    !uuid(expectedClosureVersionId) ||
    !(file instanceof File)
  )
    throw new ApiError('结算文书上传目标无效', 400, 'VALIDATION_ERROR');
  const originalFilename = file.name.trim();
  const declaredMimeType = file.type.trim();
  const types = new Map([
    ['.pdf', 'application/pdf'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png'],
  ]);
  const extension = originalFilename.toLowerCase().match(/\.[^.]+$/u)?.[0];
  if (
    !originalFilename ||
    originalFilename.length > 200 ||
    Array.from(originalFilename).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    }) ||
    types.get(extension ?? '') !== declaredMimeType ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    file.size > 50 * 1024 * 1024
  )
    throw new ApiError(
      '结算文书仅支持不超过 50MB 的 PDF、JPG 或 PNG 文件',
      400,
      'VALIDATION_ERROR',
    );
  options.signal?.throwIfAborted();
  const sha256 = await hash(file);
  options.signal?.throwIfAborted();
  const draft = await requestJson(
    `/materials/cases/${encodeURIComponent(caseId)}/settlement-update-document-upload-drafts`,
    {
      ...options,
      method: 'POST',
      retryOnCsrfInvalid: false,
      body: { expectedClosureVersionId, originalFilename, declaredMimeType },
    },
  );
  options.signal?.throwIfAborted();
  if (
    !record(draft) ||
    !uuid(draft.id) ||
    draft.ownerType !== 'CASE' ||
    !uuid(draft.ownerId) ||
    draft.ownerId.toLowerCase() !== caseId.toLowerCase() ||
    draft.category !== 'CASE_CLOSURE_DOCUMENT' ||
    draft.purpose !== 'CASE_CLOSURE_DOCUMENT' ||
    draft.originalFilename !== originalFilename ||
    draft.declaredMimeType !== declaredMimeType ||
    typeof draft.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(draft.expiresAt)) ||
    draft.reservedOwnerId !== undefined ||
    !record(draft.settlementUpdateTarget) ||
    !uuid(draft.settlementUpdateTarget.id) ||
    !uuid(draft.settlementUpdateTarget.expectedClosureVersionId) ||
    draft.settlementUpdateTarget.expectedClosureVersionId.toLowerCase() !==
      expectedClosureVersionId.toLowerCase()
  )
    throw invalidResponse();
  // Capture only the target actually issued by this draft response.
  const settlementUpdateTarget = {
    id: draft.settlementUpdateTarget.id,
    expectedClosureVersionId:
      draft.settlementUpdateTarget.expectedClosureVersionId,
  };
  const uploaded = await requestBinary(
    `/materials/upload-drafts/${encodeURIComponent(draft.id)}/content`,
    file,
    {
      ...options,
      method: 'PUT',
      retryOnCsrfInvalid: false,
    },
  );
  options.signal?.throwIfAborted();
  if (
    !record(uploaded) ||
    !uuid(uploaded.materialId) ||
    !uuid(uploaded.contentVersionId) ||
    uploaded.materialId.toLowerCase() ===
      uploaded.contentVersionId.toLowerCase() ||
    uploaded.reservedOwnerId !== undefined ||
    uploaded.originalFilename !== originalFilename ||
    uploaded.purpose !== 'CASE_CLOSURE_DOCUMENT' ||
    uploaded.mimeType !== declaredMimeType ||
    uploaded.sizeBytes !== file.size ||
    uploaded.sha256 !== sha256
  )
    throw invalidResponse();
  return {
    materialId: uploaded.materialId,
    contentVersionId: uploaded.contentVersionId,
    originalFilename,
    purpose: 'CASE_CLOSURE_DOCUMENT',
    mimeType: declaredMimeType,
    sizeBytes: file.size,
    sha256,
    caseId,
    settlementUpdateTarget,
  };
}
