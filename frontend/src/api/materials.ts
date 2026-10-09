import {
  ApiError,
  getBlob,
  getJson,
  requestBinary,
  requestJson,
  type RequestOptions,
} from './http';

export type MaterialOwnerType =
  'CUSTOMER' | 'LEAD_DRAFT' | 'LEAD' | 'NOTARY_MATTER' | 'CASE';
export type MaterialCategory =
  | 'CUSTOMER_IDENTITY'
  | 'CUSTOMER_RIGHT_EVIDENCE'
  | 'CUSTOMER_AGREEMENT'
  | 'LEAD_SCREENSHOT'
  | 'NOTARY_OPENING_PHOTO'
  | 'NOTARY_CERTIFICATE'
  | 'NOTARY_DISCLOSURE'
  | 'COMPLAINT'
  | 'AUTHORIZATION'
  | 'MAIL_RECEIPT'
  | 'FILING_EVIDENCE'
  | 'FILING_SCREENSHOT'
  | 'ACCEPTANCE_NOTICE'
  | 'PAYMENT_LIST'
  | 'SERVICE_DOCUMENT'
  | 'JUDGMENT';

export type MaterialPurpose =
  | 'IDENTITY_FULL'
  | 'IDENTITY_FRONT'
  | 'IDENTITY_BACK'
  | 'CUSTOMER_RIGHT_EVIDENCE'
  | 'CUSTOMER_AGREEMENT'
  | 'LEAD_SCREENSHOT'
  | 'NOTARY_OPENING_PHOTO'
  | 'NOTARY_CERTIFICATE'
  | 'NOTARY_DISCLOSURE'
  | 'COMPLAINT'
  | 'AUTHORIZATION'
  | 'MAIL_RECEIPT'
  | 'FILING_EVIDENCE'
  | 'FILING_SCREENSHOT'
  | 'ACCEPTANCE_NOTICE'
  | 'PAYMENT_LIST'
  | 'SERVICE_DOCUMENT'
  | 'JUDGMENT';

export type UploadedMaterial = {
  materialId: string;
  contentVersionId: string;
  reservedOwnerId?: string;
  originalFilename: string;
  purpose: MaterialPurpose;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
};

export type MaterialContentVersion = {
  id: string;
  materialId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  status: 'AVAILABLE';
  createdAt: string;
};

export type OwnerMaterial = {
  id: string;
  ownerType: MaterialOwnerType;
  ownerId: string;
  category: MaterialCategory;
  purpose: MaterialPurpose;
  currentVersionId: string | null;
  status: 'ACTIVE' | 'DELETED';
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  contentVersions: MaterialContentVersion[];
};

export type UploadMaterialFileInput = {
  ownerType: Extract<
    MaterialOwnerType,
    'CUSTOMER' | 'LEAD_DRAFT' | 'NOTARY_MATTER' | 'CASE'
  >;
  ownerId?: string;
  category: MaterialCategory;
  purpose: MaterialPurpose;
  file: File;
};

type UploadDraftResponse = {
  id: string;
  ownerType: Extract<
    MaterialOwnerType,
    'CUSTOMER' | 'LEAD_DRAFT' | 'NOTARY_MATTER' | 'CASE'
  >;
  ownerId: string;
  reservedOwnerId?: string;
  category: MaterialCategory;
  purpose: MaterialPurpose;
  originalFilename: string;
  declaredMimeType: string;
  expiresAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isOwnerType(value: unknown): value is MaterialOwnerType {
  return (
    value === 'CUSTOMER' ||
    value === 'LEAD_DRAFT' ||
    value === 'LEAD' ||
    value === 'NOTARY_MATTER' ||
    value === 'CASE'
  );
}

function isCategory(value: unknown): value is MaterialCategory {
  return (
    value === 'CUSTOMER_IDENTITY' ||
    value === 'CUSTOMER_RIGHT_EVIDENCE' ||
    value === 'CUSTOMER_AGREEMENT' ||
    value === 'LEAD_SCREENSHOT' ||
    value === 'NOTARY_OPENING_PHOTO' ||
    value === 'NOTARY_CERTIFICATE' ||
    value === 'NOTARY_DISCLOSURE' ||
    value === 'COMPLAINT' ||
    value === 'AUTHORIZATION' ||
    value === 'MAIL_RECEIPT' ||
    value === 'FILING_EVIDENCE' ||
    value === 'FILING_SCREENSHOT' ||
    value === 'ACCEPTANCE_NOTICE' ||
    value === 'PAYMENT_LIST' ||
    value === 'SERVICE_DOCUMENT' ||
    value === 'JUDGMENT'
  );
}

function isPurpose(value: unknown): value is MaterialPurpose {
  return (
    value === 'IDENTITY_FULL' ||
    value === 'IDENTITY_FRONT' ||
    value === 'IDENTITY_BACK' ||
    value === 'CUSTOMER_RIGHT_EVIDENCE' ||
    value === 'CUSTOMER_AGREEMENT' ||
    value === 'LEAD_SCREENSHOT' ||
    value === 'NOTARY_OPENING_PHOTO' ||
    value === 'NOTARY_CERTIFICATE' ||
    value === 'NOTARY_DISCLOSURE' ||
    value === 'COMPLAINT' ||
    value === 'AUTHORIZATION' ||
    value === 'MAIL_RECEIPT' ||
    value === 'FILING_EVIDENCE' ||
    value === 'FILING_SCREENSHOT' ||
    value === 'ACCEPTANCE_NOTICE' ||
    value === 'PAYMENT_LIST' ||
    value === 'SERVICE_DOCUMENT' ||
    value === 'JUDGMENT'
  );
}

function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的材料数据', 200, 'INVALID_RESPONSE');
}

function isUploadDraft(
  value: unknown,
  strictAgreement = false,
): value is UploadDraftResponse {
  return (
    isRecord(value) &&
    (!strictAgreement ||
      hasExactKeys(value, [
        'id',
        'ownerType',
        'ownerId',
        'category',
        'purpose',
        'originalFilename',
        'declaredMimeType',
        'expiresAt',
      ])) &&
    typeof value.id === 'string' &&
    (value.ownerType === 'CUSTOMER' ||
      value.ownerType === 'LEAD_DRAFT' ||
      value.ownerType === 'NOTARY_MATTER' ||
      value.ownerType === 'CASE') &&
    typeof value.ownerId === 'string' &&
    isCategory(value.category) &&
    isPurpose(value.purpose) &&
    typeof value.originalFilename === 'string' &&
    typeof value.declaredMimeType === 'string' &&
    typeof value.expiresAt === 'string' &&
    (value.reservedOwnerId === undefined ||
      typeof value.reservedOwnerId === 'string')
  );
}

function uploadDraftMatches(
  draft: UploadDraftResponse,
  input: UploadMaterialFileInput,
  originalFilename: string,
): boolean {
  return (
    draft.ownerType === input.ownerType &&
    draft.category === input.category &&
    draft.purpose === input.purpose &&
    draft.originalFilename === originalFilename &&
    draft.declaredMimeType === input.file.type &&
    (input.ownerId === undefined || draft.ownerId === input.ownerId) &&
    (input.ownerType === 'LEAD_DRAFT'
      ? draft.reservedOwnerId === draft.ownerId
      : draft.reservedOwnerId === undefined)
  );
}

function isUploadedMaterial(
  value: unknown,
  strictAgreement = false,
): value is UploadedMaterial {
  return (
    isRecord(value) &&
    (!strictAgreement ||
      hasExactKeys(value, [
        'materialId',
        'contentVersionId',
        'originalFilename',
        'purpose',
        'mimeType',
        'sizeBytes',
        'sha256',
      ])) &&
    typeof value.materialId === 'string' &&
    typeof value.contentVersionId === 'string' &&
    (value.reservedOwnerId === undefined ||
      typeof value.reservedOwnerId === 'string') &&
    typeof value.originalFilename === 'string' &&
    isPurpose(value.purpose) &&
    typeof value.mimeType === 'string' &&
    Number.isInteger(value.sizeBytes) &&
    (value.sizeBytes as number) >= 0 &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(value.sha256)
  );
}

function isContentVersion(value: unknown): value is MaterialContentVersion {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.materialId === 'string' &&
    typeof value.originalFilename === 'string' &&
    typeof value.mimeType === 'string' &&
    Number.isInteger(value.sizeBytes) &&
    (value.sizeBytes as number) >= 0 &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(value.sha256) &&
    value.status === 'AVAILABLE' &&
    typeof value.createdAt === 'string'
  );
}

function isOwnerMaterial(value: unknown): value is OwnerMaterial {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isOwnerType(value.ownerType) &&
    typeof value.ownerId === 'string' &&
    isCategory(value.category) &&
    isPurpose(value.purpose) &&
    (value.currentVersionId === null ||
      typeof value.currentVersionId === 'string') &&
    (value.status === 'ACTIVE' || value.status === 'DELETED') &&
    Number.isInteger(value.version) &&
    (value.version as number) >= 1 &&
    (value.deletedAt === null || typeof value.deletedAt === 'string') &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    Array.isArray(value.contentVersions) &&
    value.contentVersions.every(isContentVersion)
  );
}

export async function uploadMaterialFile(
  input: UploadMaterialFileInput,
): Promise<UploadedMaterial> {
  const originalFilename = input.file.name.trim();
  if (originalFilename.length === 0) {
    throw new ApiError('文件名不能为空', 400, 'VALIDATION_ERROR');
  }
  if (
    input.ownerType === 'CUSTOMER' &&
    input.category === 'CUSTOMER_RIGHT_EVIDENCE'
  ) {
    const types = new Map([
      ['.pdf', 'application/pdf'],
      ['.jpg', 'image/jpeg'],
      ['.jpeg', 'image/jpeg'],
      ['.png', 'image/png'],
    ]);
    const extension = originalFilename.toLowerCase().match(/\.[^.]+$/u)?.[0];
    if (
      !input.ownerId ||
      input.purpose !== 'CUSTOMER_RIGHT_EVIDENCE' ||
      types.get(extension ?? '') !== input.file.type ||
      input.file.size > 20 * 1024 * 1024
    )
      throw new ApiError(
        '权属证明仅支持不超过 20MB 的 PDF、JPG 或 PNG 文件',
        400,
        'VALIDATION_ERROR',
      );
  }
  if (input.category === 'CUSTOMER_AGREEMENT') {
    const allowedTypes = new Set([
      'application/pdf',
      'image/jpeg',
      'image/png',
    ]);
    if (
      input.ownerType !== 'CUSTOMER' ||
      !input.ownerId ||
      input.purpose !== 'CUSTOMER_AGREEMENT' ||
      !allowedTypes.has(input.file.type)
    ) {
      throw new ApiError('协议文件归属或类型无效', 400, 'VALIDATION_ERROR');
    }
  }
  if (input.ownerType === 'CASE') {
    if (
      input.category === 'ACCEPTANCE_NOTICE' ||
      input.category === 'PAYMENT_LIST' ||
      input.category === 'SERVICE_DOCUMENT' ||
      input.category === 'JUDGMENT'
    ) {
      const types = new Map([
        ['.pdf', 'application/pdf'],
        ['.jpg', 'image/jpeg'],
        ['.jpeg', 'image/jpeg'],
        ['.png', 'image/png'],
      ]);
      const extension = originalFilename.toLowerCase().match(/\.[^.]+$/u)?.[0];
      if (
        types.get(extension ?? '') !== input.file.type ||
        input.file.size > 50 * 1024 * 1024 ||
        input.purpose !== input.category ||
        !input.ownerId
      ) {
        throw new ApiError(
          '案件文书仅支持不超过 50MB 的 PDF、JPG 或 PNG 文件',
          400,
          'VALIDATION_ERROR',
        );
      }
    } else {
      const complaintTypes = new Map([
        ['.pdf', 'application/pdf'],
        ['.doc', 'application/msword'],
        [
          '.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ],
      ]);
      if (
        input.category === 'MAIL_RECEIPT' ||
        input.category === 'FILING_SCREENSHOT'
      ) {
        const receiptTypes = new Map([
          ['.pdf', 'application/pdf'],
          ['.jpg', 'image/jpeg'],
          ['.jpeg', 'image/jpeg'],
          ['.png', 'image/png'],
        ]);
        const extension = originalFilename
          .toLowerCase()
          .match(/\.[^.]+$/u)?.[0];
        if (
          receiptTypes.get(extension ?? '') !== input.file.type ||
          input.file.size > 20 * 1024 * 1024 ||
          input.purpose !== input.category ||
          !input.ownerId
        ) {
          throw new ApiError(
            '邮寄凭证或立案截图仅支持不超过 20MB 的 PDF、JPG 或 PNG 文件',
            400,
            'VALIDATION_ERROR',
          );
        }
      } else {
        const extension = originalFilename
          .toLowerCase()
          .match(/\.[^.]+$/u)?.[0];
        const evidenceTypes = new Map<string, string>([
          ...complaintTypes.entries(),
          ['.jpg', 'image/jpeg'],
          ['.jpeg', 'image/jpeg'],
          ['.png', 'image/png'],
        ]);
        const allowed =
          input.category === 'FILING_EVIDENCE' ? evidenceTypes : complaintTypes;
        if (
          extension === undefined ||
          allowed.get(extension) !== input.file.type ||
          input.file.size > 50 * 1024 * 1024
        ) {
          throw new ApiError(
            '起诉材料仅支持不超过 50MB 的 PDF、DOC、DOCX、JPG 或 PNG 文件',
            400,
            'VALIDATION_ERROR',
          );
        }
        if (
          (input.category !== 'COMPLAINT' &&
            input.category !== 'AUTHORIZATION' &&
            input.category !== 'FILING_EVIDENCE') ||
          input.purpose !== input.category ||
          !input.ownerId
        ) {
          throw new ApiError('起诉材料归属信息无效', 400, 'VALIDATION_ERROR');
        }
      }
    }
  }
  const draft = await requestJson('/materials/upload-drafts', {
    method: 'POST',
    body: {
      ownerType: input.ownerType,
      ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
      category: input.category,
      purpose: input.purpose,
      originalFilename,
      declaredMimeType: input.file.type,
    },
  });
  if (
    !isUploadDraft(draft, input.category === 'CUSTOMER_AGREEMENT') ||
    !uploadDraftMatches(draft, input, originalFilename)
  ) {
    throw invalidResponse();
  }

  const uploaded = await requestBinary(
    `/materials/upload-drafts/${encodeURIComponent(draft.id)}/content`,
    input.file,
    { method: 'PUT' },
  );
  if (
    !isUploadedMaterial(uploaded, input.category === 'CUSTOMER_AGREEMENT') ||
    uploaded.purpose !== input.purpose ||
    uploaded.originalFilename !== originalFilename ||
    uploaded.mimeType !== input.file.type ||
    uploaded.sizeBytes !== input.file.size ||
    (input.ownerType === 'LEAD_DRAFT'
      ? uploaded.reservedOwnerId !== draft.ownerId
      : uploaded.reservedOwnerId !== undefined)
  ) {
    throw invalidResponse();
  }
  return uploaded;
}

export async function listOwnerMaterials(
  ownerType: MaterialOwnerType,
  ownerId: string,
  options: RequestOptions = {},
): Promise<{ items: OwnerMaterial[]; total: number }> {
  const params = new URLSearchParams({ ownerType, ownerId });
  const response = await getJson(`/materials?${params}`, options);
  if (
    !isRecord(response) ||
    !Array.isArray(response.items) ||
    !response.items.every(isOwnerMaterial) ||
    !Number.isInteger(response.total) ||
    (response.total as number) < 0
  ) {
    throw invalidResponse();
  }
  return { items: response.items, total: response.total as number };
}

export async function downloadMaterialVersion(
  materialId: string,
  contentVersionId: string,
  signal?: AbortSignal,
): Promise<void> {
  const download = await getBlob(
    `/materials/${encodeURIComponent(materialId)}/versions/${encodeURIComponent(contentVersionId)}/content`,
    { signal },
  );
  signal?.throwIfAborted();
  const objectUrl = URL.createObjectURL(download.blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = download.filename;
    signal?.throwIfAborted();
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function decodeMutation<Status extends 'ACTIVE' | 'DELETED'>(
  value: unknown,
  expectedStatus: Status,
): { id: string; status: Status; version: number } {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.status !== expectedStatus ||
    !Number.isInteger(value.version) ||
    (value.version as number) < 1
  ) {
    throw invalidResponse();
  }
  return {
    id: value.id,
    status: expectedStatus,
    version: value.version as number,
  };
}

export async function deleteMaterial(
  materialId: string,
  expectedVersion: number,
): Promise<{ id: string; status: 'DELETED'; version: number }> {
  const response = await requestJson(
    `/materials/${encodeURIComponent(materialId)}?expectedVersion=${expectedVersion}`,
    { method: 'DELETE' },
  );
  return decodeMutation(response, 'DELETED');
}

export async function restoreMaterial(
  materialId: string,
  expectedVersion: number,
): Promise<{ id: string; status: 'ACTIVE'; version: number }> {
  const response = await requestJson(
    `/materials/${encodeURIComponent(materialId)}/restore`,
    { method: 'POST', body: { expectedVersion } },
  );
  return decodeMutation(response, 'ACTIVE');
}
