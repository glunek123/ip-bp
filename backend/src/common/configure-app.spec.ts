import 'reflect-metadata';
import { Controller, Get, INestApplication, Post, Body } from '@nestjs/common';
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

  @Get('unexpected')
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
      .get('/api/v1/contract-test/unexpected')
      .expect(500);
    expect(response.body).toEqual({
      code: 'INTERNAL_ERROR',
      message: '服务内部错误',
      requestId: expect.any(String),
    });
    expect(response.text).not.toContain('private-database-password');
  });
});
