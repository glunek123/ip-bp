import 'reflect-metadata';
import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import {
  IDENTITY_ADAPTER,
  IdentityAdapter,
} from '../../access-control/identity.adapter';
import { configureApp } from '../../common/configure-app';
import { RightsHolderController } from './rights-holder.controller';
import { RightsHolderService } from './rights-holder.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
};
const customerId = '33333333-3333-4333-8333-333333333333';
const holderId = '55555555-5555-4555-8555-555555555555';
const commandKey = 'command-key-1';

describe('RightsHolderController', () => {
  const createAndLink = jest.fn();
  const linkExisting = jest.fn();
  const list = jest.fn();
  const get = jest.fn();
  const findLinkable = jest.fn();
  let app: INestApplication;

  beforeAll(async () => {
    const identity: IdentityAdapter = {
      resolve: jest.fn(async (token: string) =>
        token === 'allowed-token' ? actor : null,
      ),
    };
    const module = await Test.createTestingModule({
      controllers: [RightsHolderController],
      providers: [
        ActorContextGuard,
        { provide: IDENTITY_ADAPTER, useValue: identity },
        {
          provide: RightsHolderService,
          useValue: {
            createAndLink,
            linkExisting,
            list,
            get,
            findLinkable,
          },
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
    list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    findLinkable.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  });

  it('lists customer holders with validated pagination and a trusted actor', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/rights-holders`)
      .query({ page: 2, pageSize: 10 })
      .set('Authorization', 'Bearer allowed-token')
      .expect(200);
    expect(list).toHaveBeenCalledWith(actor, customerId, 2, 10);

    list.mockClear();
    await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/rights-holders`)
      .query({ page: 0, pageSize: 101 })
      .set('Authorization', 'Bearer allowed-token')
      .expect(400);
    expect(list).not.toHaveBeenCalled();
  });

  it('creates and links a holder with a required idempotency key and DTO whitelist', async () => {
    createAndLink.mockResolvedValue({
      holder: { id: holderId, name: '主体甲' },
      linkId: '66666666-6666-4666-8666-666666666666',
      customerVersion: 2,
    });
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/rights-holders`)
      .set('Authorization', 'Bearer allowed-token')
      .set('Idempotency-Key', commandKey)
      .send({
        expectedCustomerVersion: 1,
        name: ' 主体甲 ',
        credit: ' 91310000RH001 ',
      })
      .expect(201);
    expect(createAndLink).toHaveBeenCalledWith(actor, customerId, commandKey, {
      expectedCustomerVersion: 1,
      name: '主体甲',
      credit: '91310000RH001',
    });

    createAndLink.mockClear();
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/rights-holders`)
      .set('Authorization', 'Bearer allowed-token')
      .set('Idempotency-Key', commandKey)
      .send({
        expectedCustomerVersion: 1,
        name: '主体甲',
        departmentId: 'forged',
      })
      .expect(400);
    expect(createAndLink).not.toHaveBeenCalled();
  });

  it('requires a non-blank idempotency key on both write routes', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/rights-holders`)
      .set('Authorization', 'Bearer allowed-token')
      .send({ expectedCustomerVersion: 1, name: '主体甲' })
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('VALIDATION_ERROR');
      });
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/rights-holder-links`)
      .set('Authorization', 'Bearer allowed-token')
      .set('Idempotency-Key', '   ')
      .send({ expectedCustomerVersion: 1, rightsHolderId: holderId })
      .expect(400);
    expect(createAndLink).not.toHaveBeenCalled();
    expect(linkExisting).not.toHaveBeenCalled();
  });

  it('gets a holder detail through both validated UUID path parameters', async () => {
    get.mockResolvedValue({ id: holderId, name: '主体甲' });
    await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/rights-holders/${holderId}`)
      .set('Authorization', 'Bearer allowed-token')
      .expect(200);
    expect(get).toHaveBeenCalledWith(actor, customerId, holderId);

    get.mockClear();
    await request(app.getHttpServer())
      .get(`/api/v1/customers/not-a-uuid/rights-holders/${holderId}`)
      .set('Authorization', 'Bearer allowed-token')
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/rights-holders/not-a-uuid`)
      .set('Authorization', 'Bearer allowed-token')
      .expect(400);
    expect(get).not.toHaveBeenCalled();
  });

  it('finds linkable holders with trimmed query and validated pagination', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/linkable-rights-holders`)
      .query({ query: ' 主体 ', page: 3, pageSize: 5 })
      .set('Authorization', 'Bearer allowed-token')
      .expect(200);
    expect(findLinkable).toHaveBeenCalledWith(actor, customerId, '主体', 3, 5);

    findLinkable.mockClear();
    await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/linkable-rights-holders`)
      .query({ query: '主体', extra: 'forged' })
      .set('Authorization', 'Bearer allowed-token')
      .expect(400);
    expect(findLinkable).not.toHaveBeenCalled();
  });

  it('links an existing holder with validated input', async () => {
    linkExisting.mockResolvedValue({
      holder: { id: holderId, name: '主体甲' },
      linkId: '66666666-6666-4666-8666-666666666666',
      customerVersion: 2,
    });
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/rights-holder-links`)
      .set('Authorization', 'Bearer allowed-token')
      .set('Idempotency-Key', commandKey)
      .send({ expectedCustomerVersion: 1, rightsHolderId: holderId })
      .expect(201);
    expect(linkExisting).toHaveBeenCalledWith(actor, customerId, commandKey, {
      expectedCustomerVersion: 1,
      rightsHolderId: holderId,
    });

    linkExisting.mockClear();
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/rights-holder-links`)
      .set('Authorization', 'Bearer allowed-token')
      .set('Idempotency-Key', commandKey)
      .send({ expectedCustomerVersion: 1, rightsHolderId: 'not-a-uuid' })
      .expect(400);
    expect(linkExisting).not.toHaveBeenCalled();
  });

  it('keeps stable service error codes in HTTP responses', async () => {
    get.mockRejectedValueOnce(
      new NotFoundException({
        code: 'RIGHTS_HOLDER_NOT_FOUND',
        message: '权利主体不存在或不可访问',
      }),
    );
    await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/rights-holders/${holderId}`)
      .set('Authorization', 'Bearer allowed-token')
      .expect(404)
      .expect((response) => {
        expect(response.body.code).toBe('RIGHTS_HOLDER_NOT_FOUND');
      });
  });

  it('requires a trusted actor on all rights-holder routes', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/rights-holders`)
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/rights-holders`)
      .set('Idempotency-Key', commandKey)
      .send({ expectedCustomerVersion: 1, name: '主体甲' })
      .expect(401);
    expect(list).not.toHaveBeenCalled();
    expect(createAndLink).not.toHaveBeenCalled();
  });
});
