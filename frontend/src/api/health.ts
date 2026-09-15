import { ApiError, getJson, type RequestOptions } from './http';

export interface HealthStatus {
  status: 'ok';
  database: 'up';
}

export async function getHealth(
  options: RequestOptions = {},
): Promise<HealthStatus> {
  const data = await getJson('/health', options);
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    !('status' in data) ||
    data.status !== 'ok' ||
    !('database' in data) ||
    data.database !== 'up'
  ) {
    throw new ApiError('服务返回了无效的连接状态', 200, 'INVALID_RESPONSE');
  }
  return { status: 'ok', database: 'up' };
}
