export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    status: number,
    code: string,
    requestId?: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type RequestOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: Readonly<Record<string, string>>;
  retryOnCsrfInvalid?: boolean;
};
export type JsonRequestOptions = RequestOptions &
  (
    | { method?: 'GET'; body?: never }
    | { method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: JsonValue }
  );

let csrfToken: string | null = null;
let sessionUserId: string | null = null;
const unauthorizedListeners = new Set<() => void>();

export function setCsrfToken(value: string | null): void {
  csrfToken = value;
}

export function setSessionIdentity(userId: string | null): void {
  sessionUserId = userId;
}

function notifyUnauthorized(): void {
  setCsrfToken(null);
  sessionUserId = null;
  for (const listener of unauthorizedListeners) listener();
}

let csrfRefreshInFlight: Promise<boolean> | null = null;

async function refreshCsrfFromSession(): Promise<boolean> {
  if (csrfRefreshInFlight) return csrfRefreshInFlight;
  csrfRefreshInFlight = (async () => {
    try {
      const response = await fetch('/api/v1/auth/session', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        if (response.status === 401) notifyUnauthorized();
        return false;
      }
      const body: unknown = await response.json();
      if (!isRecord(body) || typeof body.csrfToken !== 'string') return false;
      const userId =
        isRecord(body.user) && typeof body.user.id === 'string'
          ? body.user.id
          : null;
      if (
        sessionUserId !== null &&
        userId !== null &&
        userId !== sessionUserId
      ) {
        notifyUnauthorized();
        return false;
      }
      sessionUserId = userId;
      setCsrfToken(body.csrfToken);
      return true;
    } catch {
      return false;
    }
  })();
  try {
    return await csrfRefreshInFlight;
  } finally {
    csrfRefreshInFlight = null;
  }
}

export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

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
      credentials: 'same-origin',
      signal,
      headers: {
        Accept: 'application/json',
        ...(bodyText === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...(options.method !== undefined &&
        options.method !== 'GET' &&
        csrfToken
          ? { 'X-CSRF-Token': csrfToken }
          : {}),
        ...options.headers,
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
      const apiError = new ApiError(
        typeof error.message === 'string'
          ? error.message
          : '服务暂时不可用，请稍后重试',
        response.status,
        typeof error.code === 'string' ? error.code : 'HTTP_ERROR',
        typeof error.requestId === 'string' ? error.requestId : undefined,
        isRecord(error.details) ? error.details : error,
      );
      if (
        apiError.status === 401 &&
        apiError.code === 'UNAUTHORIZED' &&
        path !== '/auth/session' &&
        path !== '/auth/logout'
      ) {
        notifyUnauthorized();
      }
      if (
        apiError.status === 403 &&
        apiError.code === 'CSRF_INVALID' &&
        options.retryOnCsrfInvalid !== false &&
        path !== '/auth/session' &&
        (await refreshCsrfFromSession())
      ) {
        return await requestJson(path, {
          ...options,
          retryOnCsrfInvalid: false,
        });
      }
      throw apiError;
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
