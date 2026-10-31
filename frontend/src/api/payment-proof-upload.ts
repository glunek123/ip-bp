import { ApiError, requestBinary, requestJson } from './http';

export type PaymentProofContext = {
  actorKey: string;
  caseId: string;
  expectedVersion: number;
};
export type PaymentProofUpload = Readonly<
  PaymentProofContext & { draftId: string }
>;
type State = {
  file: File;
  sha256: string;
  result?: string;
  busy: boolean;
  unknown: boolean;
};
const states = new WeakMap<PaymentProofUpload, State>();
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function invalid() {
  return new ApiError('付款截图上传数据无效', 200, 'INVALID_RESPONSE');
}
function validate(context: PaymentProofContext) {
  if (
    !context.actorKey.trim() ||
    !uuid(context.caseId) ||
    !Number.isSafeInteger(context.expectedVersion) ||
    context.expectedVersion < 1
  )
    throw new ApiError('付款截图上传目标无效', 400, 'VALIDATION_ERROR');
}
async function hash(file: File): Promise<string> {
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () =>
      reader.result instanceof ArrayBuffer
        ? resolve(reader.result)
        : reject(invalid());
    reader.readAsArrayBuffer(file);
  });
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
/** Memory only: refresh loses this recovery handle. */
export async function preparePaymentProofUpload(
  context: PaymentProofContext,
  file: File,
): Promise<PaymentProofUpload> {
  context = Object.freeze({ ...context, caseId: context.caseId.toLowerCase() });
  validate(context);
  if (!(file instanceof File)) throw invalid();
  const name = file.name.trim();
  const types = new Map([
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
  ]);
  if (
    !name ||
    name.length > 200 ||
    Array.from(name).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    }) ||
    types.get(name.toLowerCase().match(/\.[^.]+$/u)?.[0] ?? '') !== file.type ||
    file.size <= 0 ||
    file.size > 20 * 1024 * 1024
  )
    throw new ApiError(
      '付款截图仅支持不超过 20MiB 的 PNG 或 JPEG 文件',
      400,
      'VALIDATION_ERROR',
    );
  const sha256 = await hash(file);
  const draft = await requestJson('/materials/upload-drafts', {
    method: 'POST',
    retryOnCsrfInvalid: false,
    body: {
      ownerType: 'CASE',
      ownerId: context.caseId,
      category: 'CASE_CLOSURE_PAYMENT_PROOF',
      purpose: 'CASE_CLOSURE_PAYMENT_PROOF',
      originalFilename: name,
      declaredMimeType: file.type,
    },
  });
  if (
    !record(draft) ||
    !uuid(draft.id) ||
    draft.ownerType !== 'CASE' ||
    !uuid(draft.ownerId) ||
    draft.ownerId.toLowerCase() !== context.caseId ||
    draft.category !== 'CASE_CLOSURE_PAYMENT_PROOF' ||
    draft.purpose !== 'CASE_CLOSURE_PAYMENT_PROOF' ||
    draft.originalFilename !== name ||
    draft.declaredMimeType !== file.type ||
    draft.reservedOwnerId !== undefined ||
    typeof draft.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(draft.expiresAt))
  )
    throw invalid();
  const handle = Object.freeze({ ...context, draftId: draft.id });
  states.set(handle, { file, sha256, busy: false, unknown: false });
  return handle;
}
/** Retrying always sends the original immutable File to the original draft. */
export async function finalizePaymentProofUpload(
  handle: PaymentProofUpload,
  context: PaymentProofContext,
): Promise<string> {
  validate(context);
  const state = states.get(handle);
  if (
    !state ||
    handle.actorKey !== context.actorKey ||
    handle.caseId !== context.caseId.toLowerCase() ||
    handle.expectedVersion !== context.expectedVersion ||
    state.busy
  )
    throw new ApiError(
      '上传会话或案件版本已变化，请核对原上传',
      409,
      'CONFLICT',
    );
  if (state.result) return state.result;
  state.busy = true;
  try {
    const value = await requestBinary(
      '/materials/upload-drafts/' +
        encodeURIComponent(handle.draftId) +
        '/content',
      state.file,
      { method: 'PUT', retryOnCsrfInvalid: false },
    );
    if (
      !record(value) ||
      !uuid(value.materialId) ||
      !uuid(value.contentVersionId) ||
      value.materialId.toLowerCase() === value.contentVersionId.toLowerCase() ||
      value.reservedOwnerId !== undefined ||
      value.originalFilename !== state.file.name.trim() ||
      value.purpose !== 'CASE_CLOSURE_PAYMENT_PROOF' ||
      value.mimeType !== state.file.type ||
      value.sizeBytes !== state.file.size ||
      value.sha256 !== state.sha256
    )
      throw invalid();
    state.result = value.contentVersionId;
    return state.result;
  } catch (cause) {
    const uncertain =
      !(cause instanceof ApiError) ||
      cause.status === 0 ||
      cause.status >= 500 ||
      cause.code === 'INVALID_RESPONSE';
    state.unknown ||= uncertain;
    if (state.unknown)
      throw new ApiError(
        '付款截图上传结果仍未确认，只能重试原上传',
        0,
        'UPLOAD_RESULT_UNKNOWN',
      );
    throw cause;
  } finally {
    state.busy = false;
  }
}
