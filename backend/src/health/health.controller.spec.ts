import 'reflect-metadata';
import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthController } from './health.controller';
import { DatabaseService } from '../database/database.service';
import { configureApp } from '../common/configure-app';

describe('HTTP health contract', () => {
  let app: INestApplication;
  const ping = jest.fn<Promise<void>, []>();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DatabaseService, useValue: { ping } }],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('returns ready only after a successful database query', async () => {
    ping.mockResolvedValueOnce(undefined);
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect({ status: 'ok', database: 'up' });
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('returns 503 without exposing database error details', async () => {
    ping.mockRejectedValueOnce(
      new Error('postgresql://secret:password@private/database'),
    );
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(503);
    expect(response.body).toEqual({
      code: 'DATABASE_UNAVAILABLE',
      message: '数据库暂时不可用',
      requestId: expect.any(String),
    });
    expect(response.text).not.toContain('password');
    expect(response.headers['x-request-id']).toBe(response.body.requestId);
  });

  it('logs a safe database error code without logging credentials', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      ping.mockRejectedValueOnce(
        Object.assign(
          new Error('postgresql://secret:password@private/database'),
          { code: 'ECONNREFUSED' },
        ),
      );
      await request(app.getHttpServer()).get('/api/v1/health').expect(503);
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          errorType: 'Error',
          errorCode: 'ECONNREFUSED',
        }),
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain('password');
    } finally {
      log.mockRestore();
    }
  });

  it('generates a request id instead of trusting a caller-supplied id', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/missing')
      .set('X-Request-Id', 'untrusted-id')
      .expect(404);
    expect(response.body.code).toBe('NOT_FOUND');
    expect(response.headers['x-request-id']).toBe(response.body.requestId);
    expect(response.body.requestId).not.toBe('untrusted-id');
  });
});
