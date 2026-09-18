import {
  BadRequestException,
  INestApplication,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import { HttpExceptionFilter, RequestContext } from './http-exception.filter';
import { requestDiagnostics } from './request-diagnostics';

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
      exceptionFactory: () =>
        new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: '请求字段不符合接口要求',
        }),
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
}
