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

type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type RequestExecutorOptions = RequestOptions & {
  method: RequestMethod;
  body?: BodyInit;
  headers: Readonly<Record<string, string>>;
};

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
  const body =
    options.body === undefined ? undefined : JSON.stringify(options.body);
  return executeRequest(
    path,
    {
      ...options,
      method: options.method ?? 'GET',
      body,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
    },
    parseJsonSuccess,
  );
}

export function requestBinary(
  path: string,
  body: Blob,
  options: RequestOptions & { method: 'PUT' },
): Promise<unknown> {
  return executeRequest(
    path,
    {
      ...options,
      body,
      headers: {
        Accept: 'application/json',
        ...options.headers,
        'Content-Type': 'application/octet-stream',
      },
    },
    parseJsonSuccess,
  );
}

export function getBlob(
  path: string,
  options: RequestOptions = {},
): Promise<{ blob: Blob; filename: string; mimeType: string }> {
  return executeRequest(
    path,
    {
      ...options,
      method: 'GET',
      headers: { Accept: 'application/octet-stream', ...options.headers },
    },
    async (response, signal) => {
      if (response.status === 204) {
        throw new ApiError(
          '服务返回了无效的文件数据',
          response.status,
          'INVALID_RESPONSE',
        );
      }
      const blob = await response.blob();
      if (signal.aborted) signal.throwIfAborted();
      const mimeType =
        response.headers.get('Content-Type')?.split(';', 1)[0]?.trim() ||
        blob.type ||
        'application/octet-stream';
      return {
        blob,
        filename: parseDownloadFilename(
          response.headers.get('Content-Disposition'),
        ),
        mimeType,
      };
    },
  );
}

async function executeRequest<T>(
  path: string,
  options: RequestExecutorOptions,
  parseSuccess: (response: Response, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? 30_000);
  try {
    const response = await fetch(`/api/v1${path}`, {
      method: options.method,
      credentials: 'same-origin',
      signal,
      headers: {
        ...(options.method !== 'GET' && csrfToken
          ? { 'X-CSRF-Token': csrfToken }
          : {}),
        ...options.headers,
      },
      body: options.body,
    });
    if (!response.ok) {
      const body = await parseErrorBody(response, signal);
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
        return await executeRequest(
          path,
          {
            ...options,
            retryOnCsrfInvalid: false,
          },
          parseSuccess,
        );
      }
      throw apiError;
    }
    return await parseSuccess(response, signal);
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

async function parseJsonSuccess(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  if (response.status === 204) return undefined;
  try {
    return await response.json();
  } catch {
    if (signal.aborted) signal.throwIfAborted();
    throw new ApiError(
      '服务返回了无效的数据',
      response.status,
      'INVALID_RESPONSE',
    );
  }
}

async function parseErrorBody(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    if (signal.aborted) signal.throwIfAborted();
    return undefined;
  }
}

function parseDownloadFilename(contentDisposition: string | null): string {
  if (contentDisposition === null) return 'download';
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/iu.exec(
    contentDisposition,
  )?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim());
    } catch {
      return 'download';
    }
  }
  const plain = /filename\s*=\s*(?:"([^"]+)"|([^;]+))/iu.exec(
    contentDisposition,
  );
  return (plain?.[1] ?? plain?.[2] ?? 'download').trim();
}
