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
  | 'JUDGMENT'
  | 'SECOND_INSTANCE_DOCUMENT'
  | 'SECOND_INSTANCE_SERVICE'
  | 'SECOND_INSTANCE_JUDGMENT'
  | 'EXECUTION_APPLICATION'
  | 'EXECUTION_FILING_PROOF'
  | 'EXECUTION_SUPPLEMENT'
  | 'EXECUTION_FINISH_BASIS'
  | 'CASE_CLOSURE_DOCUMENT';

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
  | 'JUDGMENT'
  | 'SECOND_INSTANCE_DOCUMENT'
  | 'SECOND_INSTANCE_SERVICE'
  | 'SECOND_INSTANCE_JUDGMENT'
  | 'EXECUTION_APPLICATION'
  | 'EXECUTION_FILING_PROOF'
  | 'EXECUTION_SUPPLEMENT'
  | 'EXECUTION_FINISH_BASIS'
  | 'CASE_CLOSURE_DOCUMENT';

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

export type CaseSectionRecordUploadTarget =
  | {
      kind: 'EXECUTION_MAILING' | 'EXECUTION_FILING' | 'EXECUTION_FINISH';
      targetId: string;
      expectedRevision: number;
    }
  | {
      kind: 'JUDGMENT';
      targetId: string;
      expectedRevision: number;
      trialRoundId: string;
    }
  | {
      kind: 'CLOSURE';
      targetId: string;
      expectedRevision: number;
      expectedClosureVersionId: string;
    };
type CaseSectionRecordMaterialPurpose = Extract<
  MaterialPurpose,
  | 'MAIL_RECEIPT'
  | 'EXECUTION_FILING_PROOF'
  | 'EXECUTION_FINISH_BASIS'
  | 'JUDGMENT'
  | 'CASE_CLOSURE_DOCUMENT'
>;
export type CaseSectionRecordUploadedMaterial = Omit<
  UploadedMaterial,
  'reservedOwnerId' | 'purpose'
> & {
  purpose: CaseSectionRecordMaterialPurpose;
  recordCorrection: CaseSectionRecordUploadTarget;
};

export type ExecutionFilingSupplementUploadTarget = {
  filingId: string;
  supplementId: string;
  expectedRevision: number;
};
export type ExecutionFilingSupplementUploadedMaterial = Omit<
  UploadedMaterial,
  'reservedOwnerId' | 'purpose'
> & {
  purpose: 'EXECUTION_SUPPLEMENT';
  executionSupplement: ExecutionFilingSupplementUploadTarget;
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
    value === 'JUDGMENT' ||
    value === 'SECOND_INSTANCE_DOCUMENT' ||
    value === 'SECOND_INSTANCE_SERVICE' ||
    value === 'SECOND_INSTANCE_JUDGMENT' ||
    value === 'EXECUTION_APPLICATION' ||
    value === 'EXECUTION_FILING_PROOF' ||
    value === 'EXECUTION_SUPPLEMENT' ||
    value === 'EXECUTION_FINISH_BASIS' ||
    value === 'CASE_CLOSURE_DOCUMENT'
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
    value === 'JUDGMENT' ||
    value === 'SECOND_INSTANCE_DOCUMENT' ||
    value === 'SECOND_INSTANCE_SERVICE' ||
    value === 'SECOND_INSTANCE_JUDGMENT' ||
    value === 'EXECUTION_APPLICATION' ||
    value === 'EXECUTION_FILING_PROOF' ||
    value === 'EXECUTION_SUPPLEMENT' ||
    value === 'EXECUTION_FINISH_BASIS' ||
    value === 'CASE_CLOSURE_DOCUMENT'
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
  if (
    input.category === 'EXECUTION_SUPPLEMENT' ||
    input.purpose === 'EXECUTION_SUPPLEMENT'
  )
    throw new ApiError(
      '补交材料必须使用精确申请的专用上传入口',
      400,
      'VALIDATION_ERROR',
    );
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
      input.category === 'JUDGMENT' ||
      input.category === 'SECOND_INSTANCE_DOCUMENT' ||
      input.category === 'SECOND_INSTANCE_SERVICE' ||
      input.category === 'SECOND_INSTANCE_JUDGMENT' ||
      input.category === 'EXECUTION_FINISH_BASIS' ||
      input.category === 'CASE_CLOSURE_DOCUMENT'
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
            input.category !== 'FILING_EVIDENCE' &&
            input.category !== 'EXECUTION_APPLICATION' &&
            input.category !== 'EXECUTION_FILING_PROOF') ||
          input.purpose !== input.category ||
          !input.ownerId
        ) {
          throw new ApiError(
            input.category === 'EXECUTION_APPLICATION'
              ? '执行申请材料归属信息无效'
              : '起诉材料归属信息无效',
            400,
            'VALIDATION_ERROR',
          );
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

function sectionUploadUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}
function sectionUploadTarget(
  value: unknown,
): value is CaseSectionRecordUploadTarget {
  if (
    !isRecord(value) ||
    !sectionUploadUuid(value.targetId) ||
    typeof value.expectedRevision !== 'number' ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 0
  )
    return false;
  const keys = ['kind', 'targetId', 'expectedRevision'];
  switch (value.kind) {
    case 'EXECUTION_MAILING':
    case 'EXECUTION_FILING':
    case 'EXECUTION_FINISH':
      return hasExactKeys(value, keys);
    case 'JUDGMENT':
      return (
        hasExactKeys(value, [...keys, 'trialRoundId']) &&
        sectionUploadUuid(value.trialRoundId)
      );
    case 'CLOSURE':
      return (
        hasExactKeys(value, [...keys, 'expectedClosureVersionId']) &&
        sectionUploadUuid(value.expectedClosureVersionId)
      );
    default:
      return false;
  }
}
function sameSectionUploadTarget(
  value: unknown,
  expected: CaseSectionRecordUploadTarget,
): value is CaseSectionRecordUploadTarget {
  return (
    sectionUploadTarget(value) &&
    value.kind === expected.kind &&
    value.targetId.toLowerCase() === expected.targetId.toLowerCase() &&
    value.expectedRevision === expected.expectedRevision &&
    (value.kind !== 'JUDGMENT' ||
      (expected.kind === 'JUDGMENT' &&
        value.trialRoundId.toLowerCase() ===
          expected.trialRoundId.toLowerCase())) &&
    (value.kind !== 'CLOSURE' ||
      (expected.kind === 'CLOSURE' &&
        value.expectedClosureVersionId.toLowerCase() ===
          expected.expectedClosureVersionId.toLowerCase()))
  );
}
type SectionUploadAnchors =
  | { mailingId: string; expectedMailingRevision: number }
  | { filingId: string; expectedFilingRevision: number }
  | { finishId: string; expectedFinishRevision: number }
  | {
      judgmentId: string;
      expectedJudgmentRevision: number;
      trialRoundId: string;
    }
  | {
      closureId: string;
      expectedClosureRevision: number;
      expectedClosureVersionId: string;
    };
function sectionUploadRequest(target: CaseSectionRecordUploadTarget): {
  route: string;
  purpose: CaseSectionRecordMaterialPurpose;
  anchors: SectionUploadAnchors;
} {
  switch (target.kind) {
    case 'EXECUTION_MAILING':
      return {
        route: 'execution-mailing-correction',
        purpose: 'MAIL_RECEIPT',
        anchors: {
          mailingId: target.targetId,
          expectedMailingRevision: target.expectedRevision,
        },
      } as const;
    case 'EXECUTION_FILING':
      return {
        route: 'execution-filing-correction',
        purpose: 'EXECUTION_FILING_PROOF',
        anchors: {
          filingId: target.targetId,
          expectedFilingRevision: target.expectedRevision,
        },
      } as const;
    case 'EXECUTION_FINISH':
      return {
        route: 'execution-finish-correction',
        purpose: 'EXECUTION_FINISH_BASIS',
        anchors: {
          finishId: target.targetId,
          expectedFinishRevision: target.expectedRevision,
        },
      } as const;
    case 'JUDGMENT':
      return {
        route: 'judgment-record-correction',
        purpose: 'JUDGMENT',
        anchors: {
          judgmentId: target.targetId,
          expectedJudgmentRevision: target.expectedRevision,
          trialRoundId: target.trialRoundId,
        },
      } as const;
    case 'CLOSURE':
      return {
        route: 'closure-record-correction',
        purpose: 'CASE_CLOSURE_DOCUMENT',
        anchors: {
          closureId: target.targetId,
          expectedClosureRevision: target.expectedRevision,
          expectedClosureVersionId: target.expectedClosureVersionId,
        },
      } as const;
  }
}
function sectionUploadTimestamp(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)
  );
}
async function sectionUploadHash(file: File): Promise<string> {
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

/** Upload preparation only: abort/unknown results never confirm a version or save a correction. */
export async function uploadCaseSectionRecordFile(
  caseId: string,
  target: CaseSectionRecordUploadTarget,
  file: File,
  options: RequestOptions = {},
): Promise<CaseSectionRecordUploadedMaterial> {
  if (
    !sectionUploadUuid(caseId) ||
    !sectionUploadTarget(target) ||
    !(file instanceof File)
  )
    throw new ApiError('资料更正上传目标无效', 400, 'VALIDATION_ERROR');
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
    originalFilename.length < 1 ||
    originalFilename.length > 200 ||
    types.get(extension ?? '') !== declaredMimeType ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    file.size > (target.kind === 'EXECUTION_MAILING' ? 20 : 50) * 1024 * 1024
  )
    throw new ApiError(
      '资料更正仅支持限额内的 PDF、JPG 或 PNG 文件',
      400,
      'VALIDATION_ERROR',
    );
  // Freeze the caller's original anchors before any async work, without inferring a newer head.
  const frozen = structuredClone(target);
  const request = sectionUploadRequest(frozen);
  options.signal?.throwIfAborted();
  const sha256 = await sectionUploadHash(file);
  options.signal?.throwIfAborted();
  const draft = await requestJson(
    `/cases/${encodeURIComponent(caseId)}/${request.route}/upload-drafts`,
    {
      ...options,
      method: 'POST',
      retryOnCsrfInvalid: false,
      body: { ...request.anchors, originalFilename, declaredMimeType },
    },
  );
  options.signal?.throwIfAborted();
  const draftCorrection = isRecord(draft) ? draft.recordCorrection : undefined;
  if (
    !isUploadDraft(draft) ||
    !isRecord(draft) ||
    !hasExactKeys(draft, [
      'id',
      'ownerType',
      'ownerId',
      'category',
      'purpose',
      'originalFilename',
      'declaredMimeType',
      'expiresAt',
      'recordCorrection',
    ]) ||
    !sectionUploadUuid(draft.id) ||
    draft.ownerType !== 'CASE' ||
    !sectionUploadUuid(draft.ownerId) ||
    draft.ownerId.toLowerCase() !== caseId.toLowerCase() ||
    draft.category !== request.purpose ||
    draft.purpose !== request.purpose ||
    draft.originalFilename !== originalFilename ||
    draft.declaredMimeType !== declaredMimeType ||
    !sectionUploadTimestamp(draft.expiresAt) ||
    !sameSectionUploadTarget(draftCorrection, frozen)
  )
    throw invalidResponse();
  const uploaded = await requestBinary(
    `/materials/upload-drafts/${encodeURIComponent(draft.id)}/content`,
    file,
    { ...options, method: 'PUT', retryOnCsrfInvalid: false },
  );
  options.signal?.throwIfAborted();
  const uploadedCorrection = isRecord(uploaded)
    ? uploaded.recordCorrection
    : undefined;
  if (
    !isUploadedMaterial(uploaded) ||
    !isRecord(uploaded) ||
    !hasExactKeys(uploaded, [
      'materialId',
      'contentVersionId',
      'originalFilename',
      'purpose',
      'mimeType',
      'sizeBytes',
      'sha256',
      'recordCorrection',
    ]) ||
    !sectionUploadUuid(uploaded.materialId) ||
    !sectionUploadUuid(uploaded.contentVersionId) ||
    uploaded.originalFilename !== originalFilename ||
    uploaded.purpose !== request.purpose ||
    uploaded.mimeType !== declaredMimeType ||
    uploaded.sizeBytes !== file.size ||
    uploaded.sha256 !== sha256 ||
    !sameSectionUploadTarget(uploadedCorrection, frozen)
  )
    throw invalidResponse();
  return {
    materialId: uploaded.materialId,
    contentVersionId: uploaded.contentVersionId,
    originalFilename: uploaded.originalFilename,
    purpose: request.purpose,
    mimeType: uploaded.mimeType,
    sizeBytes: uploaded.sizeBytes,
    sha256: uploaded.sha256,
    recordCorrection: uploadedCorrection,
  };
}

function executionSupplementUploadTarget(
  value: unknown,
): value is ExecutionFilingSupplementUploadTarget {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['filingId', 'supplementId', 'expectedRevision']) &&
    sectionUploadUuid(value.filingId) &&
    sectionUploadUuid(value.supplementId) &&
    typeof value.expectedRevision === 'number' &&
    Number.isSafeInteger(value.expectedRevision) &&
    value.expectedRevision >= 0
  );
}
function sameExecutionSupplementUploadTarget(
  value: unknown,
  expected: ExecutionFilingSupplementUploadTarget,
): value is ExecutionFilingSupplementUploadTarget {
  return (
    executionSupplementUploadTarget(value) &&
    value.filingId.toLowerCase() === expected.filingId.toLowerCase() &&
    value.supplementId.toLowerCase() === expected.supplementId.toLowerCase() &&
    value.expectedRevision === expected.expectedRevision
  );
}

/** Upload preparation only; abort/unknown outcomes never confirm or save a supplement. */
async function uploadExecutionFilingSupplementFile(
  prefix: 'cases' | 'lawyer/cases',
  caseId: string,
  target: ExecutionFilingSupplementUploadTarget,
  file: File,
  options: RequestOptions,
): Promise<ExecutionFilingSupplementUploadedMaterial> {
  if (
    !sectionUploadUuid(caseId) ||
    !executionSupplementUploadTarget(target) ||
    !(file instanceof File)
  )
    throw new ApiError('补交材料上传目标无效', 400, 'VALIDATION_ERROR');
  const originalFilename = file.name.trim();
  const declaredMimeType = file.type.trim();
  const sizeBytes = file.size;
  const types = new Map([
    ['.pdf', 'application/pdf'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png'],
  ]);
  const extension = originalFilename.toLowerCase().match(/\.[^.]+$/u)?.[0];
  if (
    originalFilename.length < 1 ||
    originalFilename.length > 200 ||
    Array.from(originalFilename).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    }) ||
    types.get(extension ?? '') !== declaredMimeType ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > 50 * 1024 * 1024
  )
    throw new ApiError(
      '补交材料仅支持不超过 50MB 的 PDF、JPG 或 PNG 文件',
      400,
      'VALIDATION_ERROR',
    );
  // Keep the original route/revision and lifecycle options throughout both phases.
  const frozen = structuredClone(target);
  const requestOptions = {
    ...options,
    headers: options.headers === undefined ? undefined : { ...options.headers },
    retryOnCsrfInvalid: false,
  };
  const signal = requestOptions.signal;
  signal?.throwIfAborted();
  const sha256 = await sectionUploadHash(file);
  signal?.throwIfAborted();
  const draft = await requestJson(
    `/${prefix}/${encodeURIComponent(caseId)}/execution-filings/${encodeURIComponent(frozen.filingId)}/supplements/${encodeURIComponent(frozen.supplementId)}/upload-drafts`,
    {
      ...requestOptions,
      method: 'POST',
      body: {
        expectedRevision: frozen.expectedRevision,
        originalFilename,
        declaredMimeType,
      },
    },
  );
  signal?.throwIfAborted();
  const draftContext = isRecord(draft) ? draft.executionSupplement : undefined;
  if (
    !isUploadDraft(draft) ||
    !isRecord(draft) ||
    !hasExactKeys(draft, [
      'id',
      'ownerType',
      'ownerId',
      'category',
      'purpose',
      'originalFilename',
      'declaredMimeType',
      'expiresAt',
      'executionSupplement',
    ]) ||
    !sectionUploadUuid(draft.id) ||
    draft.ownerType !== 'CASE' ||
    !sectionUploadUuid(draft.ownerId) ||
    draft.ownerId.toLowerCase() !== caseId.toLowerCase() ||
    draft.category !== 'EXECUTION_SUPPLEMENT' ||
    draft.purpose !== 'EXECUTION_SUPPLEMENT' ||
    draft.originalFilename !== originalFilename ||
    draft.declaredMimeType !== declaredMimeType ||
    !sectionUploadTimestamp(draft.expiresAt) ||
    !sameExecutionSupplementUploadTarget(draftContext, frozen)
  )
    throw invalidResponse();
  const uploaded = await requestBinary(
    `/materials/upload-drafts/${encodeURIComponent(draft.id)}/content`,
    file,
    { ...requestOptions, method: 'PUT' },
  );
  signal?.throwIfAborted();
  const context = isRecord(uploaded) ? uploaded.executionSupplement : undefined;
  if (
    !isUploadedMaterial(uploaded) ||
    !isRecord(uploaded) ||
    !hasExactKeys(uploaded, [
      'materialId',
      'contentVersionId',
      'originalFilename',
      'purpose',
      'mimeType',
      'sizeBytes',
      'sha256',
      'executionSupplement',
    ]) ||
    !sectionUploadUuid(uploaded.materialId) ||
    !sectionUploadUuid(uploaded.contentVersionId) ||
    uploaded.originalFilename !== originalFilename ||
    uploaded.purpose !== 'EXECUTION_SUPPLEMENT' ||
    uploaded.mimeType !== declaredMimeType ||
    uploaded.sizeBytes !== sizeBytes ||
    uploaded.sha256 !== sha256 ||
    !sameExecutionSupplementUploadTarget(context, frozen)
  )
    throw invalidResponse();
  return {
    materialId: uploaded.materialId,
    contentVersionId: uploaded.contentVersionId,
    originalFilename: uploaded.originalFilename,
    purpose: uploaded.purpose,
    mimeType: uploaded.mimeType,
    sizeBytes: uploaded.sizeBytes,
    sha256: uploaded.sha256,
    executionSupplement: context,
  };
}

export function uploadCaseExecutionFilingSupplementFile(
  caseId: string,
  target: ExecutionFilingSupplementUploadTarget,
  file: File,
  options: RequestOptions = {},
): Promise<ExecutionFilingSupplementUploadedMaterial> {
  return uploadExecutionFilingSupplementFile(
    'cases',
    caseId,
    target,
    file,
    options,
  );
}
export function uploadLawyerCaseExecutionFilingSupplementFile(
  caseId: string,
  target: ExecutionFilingSupplementUploadTarget,
  file: File,
  options: RequestOptions = {},
): Promise<ExecutionFilingSupplementUploadedMaterial> {
  return uploadExecutionFilingSupplementFile(
    'lawyer/cases',
    caseId,
    target,
    file,
    options,
  );
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
