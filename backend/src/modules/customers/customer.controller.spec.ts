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
import { CustomerAdmissionService } from './customer-admission.service';
import { CustomerService } from './customer.service';
import { AuthService } from '../../auth/auth.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
};
const customerId = '33333333-3333-4333-8333-333333333333';

describe('CustomerController', () => {
  const createDraft = jest.fn();
  const list = jest.fn();
  const get = jest.fn();
  const findDuplicates = jest.fn();
  const updateDraft = jest.fn();
  const admit = jest.fn();
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
        { provide: AuthService, useValue: { resolveSession: jest.fn() } },
        { provide: IDENTITY_ADAPTER, useValue: identity },
        {
          provide: CustomerService,
          useValue: { createDraft, list, get, findDuplicates, updateDraft },
        },
        { provide: CustomerAdmissionService, useValue: { admit } },
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

  it('accepts one admission contact with a phone or email', async () => {
    createDraft.mockResolvedValue({ id: 'customer-1', name: '客户甲' });
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', 'Bearer allowed-token')
      .send({
        name: '客户甲',
        admissionContactName: ' 张三 ',
        admissionContactPhone: ' +86 138-0013-8000 ',
      })
      .expect(201);
    expect(createDraft).toHaveBeenCalledWith(actor, {
      name: '客户甲',
      admissionContactName: '张三',
      admissionContactPhone: '+86 138-0013-8000',
    });

    createDraft.mockClear();
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', 'Bearer allowed-token')
      .send({
        name: '客户乙',
        admissionContactName: '李四',
        admissionContactEmail: 'contact@example.com',
      })
      .expect(201);
    expect(createDraft).toHaveBeenCalledWith(actor, {
      name: '客户乙',
      admissionContactName: '李四',
      admissionContactEmail: 'contact@example.com',
    });
  });

  it.each([
    { admissionContactName: '' },
    { admissionContactPhone: 'abc' },
    { admissionContactEmail: 'not-an-email' },
  ])('rejects malformed admission contact input %#', async (contact) => {
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', 'Bearer allowed-token')
      .send({ name: '客户甲', ...contact })
      .expect(400);
    expect(createDraft).not.toHaveBeenCalled();
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
      .get(`/api/v1/customers/${customerId}`)
      .set('Authorization', 'Bearer allowed-token')
      .expect(404)
      .expect((response) => {
        expect(response.body.code).toBe('CUSTOMER_NOT_FOUND');
      });
  });

  it('queries duplicate candidates without accepting a forged department', async () => {
    findDuplicates.mockResolvedValue({ exactIdentity: [], sameName: [] });

    await request(app.getHttpServer())
      .get('/api/v1/customers/duplicates')
      .query({ name: '客户甲', departmentId: 'forged-department' })
      .set('Authorization', 'Bearer allowed-token')
      .expect(400);
    expect(findDuplicates).not.toHaveBeenCalled();
  });

  it('patches a draft with the trusted actor and expected version', async () => {
    updateDraft.mockResolvedValue({
      id: customerId,
      name: '客户甲（更新）',
      version: 2,
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', 'Bearer allowed-token')
      .send({
        expectedVersion: 1,
        name: '  客户甲（更新）  ',
        customerType: 'enterprise',
        identityType: 'credit-code',
        identityNumber: '91310000abc123',
      })
      .expect(200)
      .expect({
        id: customerId,
        name: '客户甲（更新）',
        version: 2,
      });
    expect(updateDraft).toHaveBeenCalledWith(actor, customerId, {
      expectedVersion: 1,
      name: '客户甲（更新）',
      customerType: 'enterprise',
      identityType: 'credit-code',
      identityNumber: '91310000abc123',
    });
  });

  it('accepts a partial patch and rejects explicit null before the service', async () => {
    updateDraft.mockResolvedValue({
      id: customerId,
      name: '客户甲（更新）',
      version: 2,
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', 'Bearer allowed-token')
      .send({ expectedVersion: 1, name: '客户甲（更新）' })
      .expect(200);
    expect(updateDraft).toHaveBeenLastCalledWith(actor, customerId, {
      expectedVersion: 1,
      name: '客户甲（更新）',
    });

    updateDraft.mockClear();
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', 'Bearer allowed-token')
      .send({ expectedVersion: 1, category: null })
      .expect(400);
    expect(updateDraft).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', 'Bearer allowed-token')
      .send({ expectedVersion: 1, admissionContactEmail: null })
      .expect(400);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('validates the duplicate-query exclusion id', async () => {
    findDuplicates.mockResolvedValue({ exactIdentity: [], sameName: [] });
    await request(app.getHttpServer())
      .get('/api/v1/customers/duplicates')
      .query({ name: '客户甲', excludeCustomerId: customerId })
      .set('Authorization', 'Bearer allowed-token')
      .expect(200);
    expect(findDuplicates).toHaveBeenCalledWith(actor, {
      name: '客户甲',
      excludeCustomerId: customerId,
    });

    findDuplicates.mockClear();
    await request(app.getHttpServer())
      .get('/api/v1/customers/duplicates')
      .query({ name: '客户甲', excludeCustomerId: 'not-a-uuid' })
      .set('Authorization', 'Bearer allowed-token')
      .expect(400);
    expect(findDuplicates).not.toHaveBeenCalled();
  });

  it('rejects server-controlled fields on edit', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', 'Bearer allowed-token')
      .send({
        expectedVersion: 1,
        name: '客户甲',
        departmentId: 'forged-department',
      })
      .expect(400);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('admits a customer with a required 1..128 character Idempotency-Key', async () => {
    admit.mockResolvedValue({
      id: customerId,
      profileStatus: 'admitted',
      version: 2,
    });
    const body = {
      expectedVersion: 1,
      customerType: 'ENTERPRISE',
      name: ' 客户甲 ',
      identityType: 'BUSINESS_LICENSE',
      identityNumber: ' 91310000ABC123 ',
      identityValidityMode: 'LONG_TERM',
      admissionContactName: ' 张三 ',
      admissionContactPhone: ' 13800138000 ',
      identityDocumentContentVersionIds: [
        '44444444-4444-4444-8444-444444444444',
      ],
    };
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/admission`)
      .set('Authorization', 'Bearer allowed-token')
      .set('Idempotency-Key', ' command-1 ')
      .send(body)
      .expect(201)
      .expect({ id: customerId, profileStatus: 'admitted', version: 2 });
    expect(admit).toHaveBeenCalledWith(actor, customerId, 'command-1', {
      ...body,
      name: '客户甲',
      identityNumber: '91310000ABC123',
      admissionContactName: '张三',
      admissionContactPhone: '13800138000',
    });
  });

  it.each([undefined, '   ', 'x'.repeat(129)])(
    'rejects an invalid admission Idempotency-Key %#',
    async (key) => {
      const pending = request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/admission`)
        .set('Authorization', 'Bearer allowed-token');
      if (key !== undefined) pending.set('Idempotency-Key', key);
      await pending
        .send({
          expectedVersion: 1,
          customerType: 'ENTERPRISE',
          name: '客户甲',
          identityType: 'BUSINESS_LICENSE',
          identityNumber: '91310000ABC123',
          identityValidityMode: 'LONG_TERM',
          admissionContactName: '张三',
          admissionContactPhone: '13800138000',
          identityDocumentContentVersionIds: [
            '44444444-4444-4444-8444-444444444444',
          ],
        })
        .expect(400);
      expect(admit).not.toHaveBeenCalled();
    },
  );

  it('strictly rejects unknown or free-text admission fields', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/admission`)
      .set('Authorization', 'Bearer allowed-token')
      .set('Idempotency-Key', 'command-2')
      .send({
        expectedVersion: 1,
        customerType: '企业',
        name: '客户甲',
        identityType: 'credit-code',
        identityNumber: '91310000ABC123',
        identityValidityMode: 'LONG_TERM',
        admissionContactName: '张三',
        admissionContactPhone: '13800138000',
        identityDocumentContentVersionIds: [
          '44444444-4444-4444-8444-444444444444',
        ],
        departmentId: actor.departmentId,
      })
      .expect(400);
    expect(admit).not.toHaveBeenCalled();
  });

  it('rejects a malformed customer id without reaching the service', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/customers/not-a-uuid')
      .set('Authorization', 'Bearer allowed-token')
      .expect(400);
    expect(get).not.toHaveBeenCalled();
  });
});
