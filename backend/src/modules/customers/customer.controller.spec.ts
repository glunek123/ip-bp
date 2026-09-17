import 'reflect-metadata';
import {
  ForbiddenException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../common/configure-app';
import {
  IDENTITY_ADAPTER,
  IdentityAdapter,
} from '../../access-control/identity.adapter';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
};

describe('CustomerController', () => {
  const createDraft = jest.fn();
  const list = jest.fn();
  const get = jest.fn();
  let app: INestApplication;

  beforeAll(async () => {
    const identity: IdentityAdapter = {
      resolve: jest.fn(async (token: string) =>
        token === 'allowed-token' ? actor : null,
      ),
    };
    const module = await Test.createTestingModule({
      controllers: [CustomerController],
      providers: [
        ActorContextGuard,
        { provide: IDENTITY_ADAPTER, useValue: identity },
        {
          provide: CustomerService,
          useValue: { createDraft, list, get },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 without a trusted identity', async () => {
    await request(app.getHttpServer()).get('/api/v1/customers').expect(401);
    expect(list).not.toHaveBeenCalled();
  });

  it('rejects a forged department field instead of trusting it', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', 'Bearer allowed-token')
      .send({ name: '客户甲', departmentId: 'forged-department' })
      .expect(400);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('trims and creates a name-only draft for the trusted actor', async () => {
    createDraft.mockResolvedValue({ id: 'customer-1', name: '客户甲' });
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', 'Bearer allowed-token')
      .send({ name: '  客户甲  ' })
      .expect(201)
      .expect({ id: 'customer-1', name: '客户甲' });
    expect(createDraft).toHaveBeenCalledWith(actor, { name: '客户甲' });
  });

  it('rejects a blank customer name', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', 'Bearer allowed-token')
      .send({ name: '   ' })
      .expect(400);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('returns 403 when the actor lacks the create action', async () => {
    createDraft.mockRejectedValueOnce(
      new ForbiddenException({
        code: 'CUSTOMER_ACTION_FORBIDDEN',
        message: '无权创建客户草稿',
      }),
    );

    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', 'Bearer allowed-token')
      .send({ name: '客户甲' })
      .expect(403)
      .expect((response) => {
        expect(response.body.code).toBe('CUSTOMER_ACTION_FORBIDDEN');
      });
  });

  it('returns the same 404 for missing and inaccessible customer ids', async () => {
    get.mockRejectedValueOnce(
      new NotFoundException({
        code: 'CUSTOMER_NOT_FOUND',
        message: '客户不存在或不可访问',
      }),
    );

    await request(app.getHttpServer())
      .get('/api/v1/customers/foreign-customer')
      .set('Authorization', 'Bearer allowed-token')
      .expect(404)
      .expect((response) => {
        expect(response.body.code).toBe('CUSTOMER_NOT_FOUND');
      });
  });
});
