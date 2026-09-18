import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { errorLocation, requestDiagnostics } from './request-diagnostics';

export type RequestContext = Request & { requestId?: string };

const errorCodes: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? { ...value } : {};
}

function safeCode(value: unknown): string | undefined {
  return typeof value === 'string' &&
    /^(?:P\d{4}|[0-9A-Z]{5}|E[A-Z0-9_]{2,30})$/.test(value)
    ? value
    : undefined;
}

function safeDetails(value: unknown): unknown {
  if (
    Array.isArray(value) &&
    value.every((item: unknown) => typeof item === 'string')
  )
    return value;
  const record = asRecord(value);
  const departments = record.departments;
  if (
    Array.isArray(departments) &&
    departments.every((item) => {
      const department = asRecord(item);
      return (
        typeof department.id === 'string' && typeof department.name === 'string'
      );
    })
  ) {
    return {
      departments: departments.map((item) => {
        const department = asRecord(item);
        return { id: department.id, name: department.name };
      }),
    };
  }
  if (
    typeof record.retryAfterSeconds === 'number' &&
    Number.isInteger(record.retryAfterSeconds) &&
    record.retryAfterSeconds > 0
  )
    return { retryAfterSeconds: record.retryAfterSeconds };
  return undefined;
}

function diagnosticFields(exception: unknown) {
  const cause =
    exception instanceof Error && exception.cause ? exception.cause : exception;
  const record = asRecord(cause);
  const meta = asRecord(record.meta);
  const adapterCause = asRecord(asRecord(meta.driverAdapterError).cause);
  const knownTypes = [
    'Error',
    'TypeError',
    'RangeError',
    'PrismaClientKnownRequestError',
    'PrismaClientUnknownRequestError',
    'PrismaClientInitializationError',
    'DriverAdapterError',
  ];
  return {
    errorType:
      cause instanceof Error && knownTypes.includes(cause.name)
        ? cause.name
        : 'UnknownError',
    errorCode: safeCode(record.code),
    databaseErrorCode:
      safeCode(meta.code) ?? safeCode(adapterCause.originalCode),
  };
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestContext>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const raw =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const payload: Record<string, unknown> =
      raw && typeof raw === 'object' ? { ...raw } : {};
    const requestId = request.requestId ?? randomUUID();
    const code =
      status !== 500 && typeof payload.code === 'string'
        ? payload.code
        : (errorCodes[status] ?? 'HTTP_ERROR');
    const message =
      status === 500
        ? '服务内部错误'
        : typeof payload.message === 'string'
          ? payload.message
          : '请求未能完成';
    const details = safeDetails(payload.details);
    if (status >= 500) {
      this.logger.error({
        event: 'request_failed',
        requestId,
        status,
        code,
        ...requestDiagnostics(request),
        location: errorLocation(exception),
        ...diagnosticFields(exception),
      });
    }
    response.setHeader('X-Request-Id', requestId);
    response.status(status).json({
      code,
      message,
      requestId,
      ...(status < 500 && details ? { details } : {}),
    });
  }
}
