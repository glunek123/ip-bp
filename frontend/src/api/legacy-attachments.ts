import { getJson, requestJson, type RequestOptions } from './http';

export type LegacyAttachmentOwnerType =
  | 'CASE'
  | 'NOTARY_MATTER'
  | 'LEAD'
  | 'CUSTOMER';

export type LegacyAttachmentItem = {
  id: string;
  legacyAttachmentId: string;
  ownerType: string;
  ownerId: string;
  categoryCode: string;
  categoryLabel: string;
  title: string;
  filename: string;
  extname: string | null;
  sizeBytes: number | null;
  mimeType: string | null;
  ossUrl: string;
  createdAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validLegacyAttachmentItem(
  value: unknown,
): value is LegacyAttachmentItem {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.legacyAttachmentId === 'string' &&
    typeof value.ownerType === 'string' &&
    typeof value.ownerId === 'string' &&
    typeof value.categoryCode === 'string' &&
    typeof value.categoryLabel === 'string' &&
    typeof value.title === 'string' &&
    typeof value.filename === 'string' &&
    (value.extname === null || typeof value.extname === 'string') &&
    (value.sizeBytes === null || typeof value.sizeBytes === 'number') &&
    (value.mimeType === null || typeof value.mimeType === 'string') &&
    typeof value.ossUrl === 'string' &&
    typeof value.createdAt === 'string'
  );
}

export function legacyAttachmentContentUrl(
  id: string,
  download = false,
): string {
  return `/api/v1/legacy-attachments/${encodeURIComponent(id)}/content${download ? '?download=1' : ''}`;
}

export async function listLegacyAttachments(
  ownerType: LegacyAttachmentOwnerType,
  ownerId: string,
  options: RequestOptions = {},
): Promise<{ items: LegacyAttachmentItem[] }> {
  const params = new globalThis.URLSearchParams({ ownerType, ownerId });
  const response = await getJson(
    `/legacy-attachments?${params.toString()}`,
    options,
  );
  if (
    !isRecord(response) ||
    !Array.isArray(response.items) ||
    !response.items.every(validLegacyAttachmentItem)
  ) {
    throw new Error('历史附件响应格式无效');
  }
  return { items: response.items };
}

export async function deleteLegacyAttachment(
  id: string,
  reason: string,
  options: RequestOptions = {},
): Promise<{ id: string }> {
  const response = await requestJson(
    `/legacy-attachments/${encodeURIComponent(id)}`,
    {
      ...options,
      method: 'DELETE',
      body: { reason },
    },
  );
  if (!isRecord(response) || typeof response.id !== 'string') {
    throw new Error('删除历史附件响应格式无效');
  }
  return { id: response.id };
}
