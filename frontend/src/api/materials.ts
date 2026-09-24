import {
  ApiError,
  getBlob,
  getJson,
  requestBinary,
  requestJson,
  type RequestOptions,
} from './http';

export type MaterialOwnerType =
  'CUSTOMER' | 'LEAD_DRAFT' | 'LEAD' | 'NOTARY_MATTER';
export type MaterialCategory =
  'CUSTOMER_IDENTITY' | 'LEAD_SCREENSHOT' | 'NOTARY_OPENING';
export type MaterialPurpose =
  | 'IDENTITY_FULL'
  | 'IDENTITY_FRONT'
  | 'IDENTITY_BACK'
  | 'LEAD_SCREENSHOT'
  | 'NOTARY_OPENING_PHOTO';

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
    'CUSTOMER' | 'LEAD_DRAFT' | 'NOTARY_MATTER'
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
    'CUSTOMER' | 'LEAD_DRAFT' | 'NOTARY_MATTER'
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

function isOwnerType(value: unknown): value is MaterialOwnerType {
  return (
    value === 'CUSTOMER' ||
    value === 'LEAD_DRAFT' ||
    value === 'LEAD' ||
    value === 'NOTARY_MATTER'
  );
}

function isCategory(value: unknown): value is MaterialCategory {
  return (
    value === 'CUSTOMER_IDENTITY' ||
    value === 'LEAD_SCREENSHOT' ||
    value === 'NOTARY_OPENING'
  );
}

function isPurpose(value: unknown): value is MaterialPurpose {
  return (
    value === 'IDENTITY_FULL' ||
    value === 'IDENTITY_FRONT' ||
    value === 'IDENTITY_BACK' ||
    value === 'LEAD_SCREENSHOT' ||
    value === 'NOTARY_OPENING_PHOTO'
  );
}

function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的材料数据', 200, 'INVALID_RESPONSE');
}

function isUploadDraft(value: unknown): value is UploadDraftResponse {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.ownerType === 'CUSTOMER' ||
      value.ownerType === 'LEAD_DRAFT' ||
      value.ownerType === 'NOTARY_MATTER') &&
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

function isUploadedMaterial(value: unknown): value is UploadedMaterial {
  return (
    isRecord(value) &&
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
    !isUploadDraft(draft) ||
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
    !isUploadedMaterial(uploaded) ||
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
): Promise<void> {
  const download = await getBlob(
    `/materials/${encodeURIComponent(materialId)}/versions/${encodeURIComponent(contentVersionId)}/content`,
  );
  const objectUrl = URL.createObjectURL(download.blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = download.filename;
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
