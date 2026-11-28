import { ApiError, getJson, type RequestOptions } from './http';

export type DeletionAuditEntityType =
  | 'CASE'
  | 'LEAD'
  | 'NOTARY_MATTER'
  | 'CUSTOMER'
  | 'LEGACY_ATTACHMENT';

export type DeletionAuditLogItem = {
  id: string;
  entityType: string;
  entityId: string;
  businessNo: string | null;
  entityTitle: string | null;
  actorUserId: string;
  actorUsername: string;
  actorDisplayName: string;
  actorRoles: string[];
  deleteReason: string | null;
  snapshot: unknown;
  deletedAt: string;
};

export type DeletionAuditLogsResponse = {
  items: DeletionAuditLogItem[];
  total: number;
  page: number;
  pageSize: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validItem(value: unknown): value is DeletionAuditLogItem {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.entityType === 'string' &&
    typeof value.entityId === 'string' &&
    (value.businessNo === null || typeof value.businessNo === 'string') &&
    (value.entityTitle === null || typeof value.entityTitle === 'string') &&
    typeof value.actorUserId === 'string' &&
    typeof value.actorUsername === 'string' &&
    typeof value.actorDisplayName === 'string' &&
    Array.isArray(value.actorRoles) &&
    value.actorRoles.every((role) => typeof role === 'string') &&
    (value.deleteReason === null || typeof value.deleteReason === 'string') &&
    'snapshot' in value &&
    typeof value.deletedAt === 'string'
  );
}

export async function listDeletionAuditLogs(
  params: {
    entityType?: DeletionAuditEntityType | '';
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  } = {},
  options: RequestOptions = {},
): Promise<DeletionAuditLogsResponse> {
  const search = new globalThis.URLSearchParams();
  if (params.entityType) search.set('entityType', params.entityType);
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  const qs = search.toString();
  const response = await getJson(
    qs ? `/deletion-audit-logs?${qs}` : '/deletion-audit-logs',
    options,
  );
  if (
    !isRecord(response) ||
    !Array.isArray(response.items) ||
    !response.items.every(validItem) ||
    typeof response.total !== 'number' ||
    typeof response.page !== 'number' ||
    typeof response.pageSize !== 'number'
  ) {
    throw new ApiError('服务返回了无效的删除日志数据', 200, 'INVALID_RESPONSE');
  }
  return {
    items: response.items,
    total: response.total,
    page: response.page,
    pageSize: response.pageSize,
  };
}
