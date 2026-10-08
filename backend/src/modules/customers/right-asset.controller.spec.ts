import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import {
  IDENTITY_ADAPTER,
  IdentityAdapter,
} from '../../access-control/identity.adapter';
import { AuthService } from '../../auth/auth.service';
import { configureApp } from '../../common/configure-app';
import { RightAssetController } from './right-asset.controller';
import { RightAssetService } from './right-asset.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const customerId = '33333333-3333-4333-8333-333333333333';
const assetId = '44444444-4444-4444-8444-444444444444';
const holderId = '55555555-5555-4555-8555-555555555555';

describe('RightAssetController HTTP contract', () => {
  let app: INestApplication;
  const create = jest.fn();
  const revise = jest.fn();
  const withdraw = jest.fn();
  const list = jest.fn();
  const get = jest.fn();
  beforeAll(async () => {
    const identity: IdentityAdapter = {
      resolve: jest.fn(async (token: string) =>
        token === 'allowed' ? actor : null,
      ),
    };
    const module = await Test.createTestingModule({
      controllers: [RightAssetController],
      providers: [
        ActorContextGuard,
        { provide: AuthService, useValue: { resolveSession: jest.fn() } },
        { provide: IDENTITY_ADAPTER, useValue: identity },
        {
          provide: RightAssetService,
          useValue: { create, revise, withdraw, list, get },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    jest.clearAllMocks();
    create.mockResolvedValue({ assetId });
    revise.mockResolvedValue({ assetId });
    withdraw.mockResolvedValue({ assetId });
  });

  it('routes normalized manual fields and requires a key', async () => {
    const body = {
      expectedCustomerVersion: 1,
      type: 'TRADEMARK',
      name: ' 商标 ',
      number: null,
      category: ' 商标权 ',
      holderId,
      validityMode: 'UNKNOWN',
      validTo: null,
    };
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/right-assets`)
      .set('Authorization', 'Bearer allowed')
      .set('Idempotency-Key', ' asset-create ')
      .send(body)
      .expect(201);
    expect(create).toHaveBeenCalledWith(actor, customerId, 'asset-create', {
      ...body,
      name: '商标',
      category: '商标权',
    });
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/right-assets`)
      .set('Authorization', 'Bearer allowed')
      .send(body)
      .expect(400);
  });

  it('rejects unknown fields and invalid versions before service', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/right-assets/${assetId}/revisions`)
      .set('Authorization', 'Bearer allowed')
      .set('Idempotency-Key', 'revise')
      .send({
        expectedCustomerVersion: 1,
        expectedAssetVersion: 0,
        type: 'TRADEMARK',
        name: 'a',
        category: 'b',
        holderId,
        validityMode: 'UNKNOWN',
        forgedScope: 'DEPARTMENT',
      })
      .expect(400);
    expect(revise).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/right-assets/${assetId}/withdraw`)
      .set('Authorization', 'Bearer allowed')
      .set('Idempotency-Key', 'withdraw')
      .send({
        expectedCustomerVersion: 1,
        expectedAssetVersion: 1,
        reason: '   ',
      })
      .expect(400);
    expect(withdraw).not.toHaveBeenCalled();
  });
});
