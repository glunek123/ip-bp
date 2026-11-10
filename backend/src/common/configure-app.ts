import {
  BadRequestException,
  INestApplication,
  Logger,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import { HttpExceptionFilter, RequestContext } from './http-exception.filter';
import { requestDiagnostics } from './request-diagnostics';

// 只回字段名（不含用户输入），让前端/运营知道缺哪一项；最多 10 条。
function invalidFields(errors: readonly ValidationError[]): string[] {
  const names: string[] = [];
  const walk = (list: readonly ValidationError[], prefix: string): void => {
    for (const error of list) {
      const path = prefix ? `${prefix}.${error.property}` : error.property;
      if (error.constraints) names.push(path);
      if (error.children?.length) walk(error.children, path);
      if (names.length >= 10) return;
    }
  };
  walk(errors, '');
  return [...new Set(names)]
    .filter((name) => /^[A-Za-z0-9_.]{1,64}$/u.test(name))
    .slice(0, 10);
}

export function configureApp(app: INestApplication): void {
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? '0');
  if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);
  }
  app.setGlobalPrefix('api/v1');
  const logger = new Logger('HTTP');
  app.use((request: RequestContext, response: Response, next: NextFunction) => {
    const started = Date.now();
    request.requestId = randomUUID();
    response.setHeader('X-Request-Id', request.requestId);
    response.once('finish', () => {
      logger.log({
        event: 'request_completed',
        requestId: request.requestId,
        ...requestDiagnostics(request),
        status: response.statusCode,
        durationMs: Date.now() - started,
      });
    });
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: (errors: ValidationError[]) => {
        const fields = invalidFields(errors);
        return new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: '请求字段不符合接口要求',
          ...(fields.length > 0 ? { details: { fields } } : {}),
        });
      },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
}
