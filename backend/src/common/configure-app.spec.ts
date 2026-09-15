import 'reflect-metadata';
import {
  Controller,
  Get,
  INestApplication,
  Post,
  Body,
  Logger,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsInt, Min } from 'class-validator';
import request from 'supertest';
import { configureApp } from './configure-app';

class Input {
  @IsInt()
  @Min(1)
  count!: number;
}

@Controller('contract-test')
class ContractController {
  @Post()
  accept(@Body() input: Input): Input {
    return input;
  }

  @Get('unexpected/:id')
  fail(): never {
    throw new Error('private-database-password');
  }
}

describe('application boundary', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ContractController],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('accepts explicitly typed input', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/contract-test')
      .send({ count: 1 })
      .expect(201)
      .expect({ count: 1 });
  });
  it.each([{ count: 1, extra: true }, { count: '1' }, { count: 0 }, {}])(
    'rejects invalid input %j',
    async (body) => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/contract-test')
        .send(body)
        .expect(400);
      expect(response.body).toMatchObject({
        code: 'VALIDATION_ERROR',
        requestId: expect.any(String),
      });
    },
  );
  it('redacts unexpected failures', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/contract-test/unexpected/secret-id')
      .expect(500);
    expect(response.body).toEqual({
      code: 'INTERNAL_ERROR',
      message: '服务内部错误',
      requestId: expect.any(String),
    });
    expect(response.text).not.toContain('private-database-password');
  });
  it('logs registered routes and safe code locations without request secrets', async () => {
    const errors = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const logs = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    try {
      const response = await request(app.getHttpServer())
        .get('/api/v1/contract-test/unexpected/secret-id?token=secret-query')
        .set('Authorization', 'secret-header')
        .expect(500);
      expect(errors).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          route: '/api/v1/contract-test/unexpected/:id',
          requestId: response.headers['x-request-id'],
          location: expect.stringMatching(
            /^src\/common\/configure-app.spec.ts:\d+:\d+$/,
          ),
        }),
      );
      await request(app.getHttpServer())
        .post('/api/v1/contract-test')
        .send({ count: 1 })
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/contract-test')
        .send({ count: 1, secret: 'secret-body' })
        .expect(400);
      expect(logs).toHaveBeenCalledWith(
        expect.objectContaining({
          route: '/api/v1/contract-test',
          status: 201,
          durationMs: expect.any(Number),
        }),
      );
      await request(app.getHttpServer())
        .get('/private-path?token=secret-query')
        .expect(404);
      expect(logs).toHaveBeenCalledWith(
        expect.objectContaining({ route: 'UNMATCHED', status: 404 }),
      );
      const text = JSON.stringify([errors.mock.calls, logs.mock.calls]);
      for (const secret of [
        'private-database-password',
        'secret-id',
        'secret-query',
        'secret-header',
        'secret-body',
        'private-path',
      ])
        expect(text).not.toContain(secret);
    } finally {
      errors.mockRestore();
      logs.mockRestore();
    }
  });
});
