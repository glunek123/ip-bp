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
import { CustomerCooperationController } from './customer-cooperation.controller';
import { CustomerCooperationService } from './customer-cooperation.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const customerId = '33333333-3333-4333-8333-333333333333';
const targetUserId = '44444444-4444-4444-8444-444444444444';

describe('CustomerCooperationController', () => {
  const eligibleOperators = jest.fn();
  const transferResponsible = jest.fn();
  const changeCooperation = jest.fn();
  let app: INestApplication;

  beforeAll(async () => {
    const identity: IdentityAdapter = {
      resolve: jest.fn(async (token: string) =>
        token === 'allowed-token' ? actor : null,
      ),
    };
    const module = await Test.createTestingModule({
      controllers: [CustomerCooperationController],
      providers: [
        ActorContextGuard,
        { provide: AuthService, useValue: { resolveSession: jest.fn() } },
        { provide: IDENTITY_ADAPTER, useValue: identity },
        {
          provide: CustomerCooperationService,
          useValue: {
            eligibleOperators,
            transferResponsible,
            changeCooperation,
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();
  });

  afterAll(async () => app?.close());
  beforeEach(() => jest.clearAllMocks());

  it('requires a trusted identity before listing candidates', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/eligible-operators`)
      .expect(401);
    expect(eligibleOperators).not.toHaveBeenCalled();
  });

  it('passes paged candidate queries to the authorized service', async () => {
    const result = {
      items: [{ id: targetUserId, displayName: '运营乙', teamName: '乙组' }],
      total: 1,
      page: 2,
      pageSize: 5,
    };
    eligibleOperators.mockResolvedValue(result);
    await request(app.getHttpServer())
      .get(
        `/api/v1/customers/${customerId}/eligible-operators?page=2&pageSize=5`,
      )
      .set('Authorization', 'Bearer allowed-token')
      .expect(200, result);
    expect(eligibleOperators).toHaveBeenCalledWith(actor, customerId, 2, 5);
  });

  it('requires an idempotency key and a valid transfer body', async () => {
    const endpoint = `/api/v1/customers/${customerId}/responsible-transfer`;
    const body = { expectedVersion: 1, targetUserId, reason: '调整分工' };
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer allowed-token')
      .send(body)
      .expect(400);
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer allowed-token')
      .set('Idempotency-Key', 'transfer-1')
      .send({ ...body, targetUserId: 'invalid' })
      .expect(400);
    expect(transferResponsible).not.toHaveBeenCalled();
  });

  it('trims the key and transfer reason before passing the command', async () => {
    const result = {
      customerId,
      action: 'responsible-transfer',
      resultVersion: 2,
      occurredAt: '2026-10-09T00:00:00.000Z',
      canReadAfter: false,
    };
    transferResponsible.mockResolvedValue(result);
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/responsible-transfer`)
      .set('Authorization', 'Bearer allowed-token')
      .set('Idempotency-Key', ' transfer-1 ')
      .send({ expectedVersion: 1, targetUserId, reason: ' 调整分工 ' })
      .expect(201, result);
    expect(transferResponsible).toHaveBeenCalledWith(
      actor,
      customerId,
      'transfer-1',
      {
        expectedVersion: 1,
        targetUserId,
        reason: '调整分工',
      },
    );
  });

  it('rejects an invalid cooperation action without calling the service', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/cooperation`)
      .set('Authorization', 'Bearer allowed-token')
      .set('Idempotency-Key', 'cooperation-1')
      .send({ expectedVersion: 1, action: 'activate', reason: '原因' })
      .expect(400);
    expect(changeCooperation).not.toHaveBeenCalled();
  });
});
