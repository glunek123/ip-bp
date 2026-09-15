export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(
    message: string,
    status: number,
    code: string,
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type RequestOptions = { timeoutMs?: number; signal?: AbortSignal };
export type JsonRequestOptions = RequestOptions &
  (
    | { method?: 'GET'; body?: never }
    | { method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: JsonValue }
  );

export function getJson(
  path: string,
  options: RequestOptions = {},
): Promise<unknown> {
  return requestJson(path, { ...options, method: 'GET' });
}

export async function requestJson(
  path: string,
  options: JsonRequestOptions = {},
): Promise<unknown> {
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? 30_000);
  try {
    const bodyText =
      options.body === undefined ? undefined : JSON.stringify(options.body);
    const response = await fetch(`/api/v1${path}`, {
      method: options.method ?? 'GET',
      signal,
      headers: {
        Accept: 'application/json',
        ...(bodyText === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
      },
      body: bodyText,
    });
    if (response.status === 204) return undefined;
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      if (signal.aborted) signal.throwIfAborted();
      if (response.ok)
        throw new ApiError(
          '服务返回了无效的数据',
          response.status,
          'INVALID_RESPONSE',
        );
    }
    if (!response.ok) {
      const error = isRecord(body) ? body : {};
      throw new ApiError(
        typeof error.message === 'string'
          ? error.message
          : '服务暂时不可用，请稍后重试',
        response.status,
        typeof error.code === 'string' ? error.code : 'HTTP_ERROR',
        typeof error.requestId === 'string' ? error.requestId : undefined,
      );
    }
    return body;
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    if (controller.signal.aborted)
      throw new ApiError('请求超时，请重试', 0, 'TIMEOUT');
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      '无法连接服务，请检查服务是否已启动',
      0,
      'NETWORK_ERROR',
    );
  } finally {
    clearTimeout(timer);
  }
}
