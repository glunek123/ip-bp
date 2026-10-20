import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { ActorContext } from '../../access-control/actor-context';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { configureApp } from '../../common/configure-app';
import { LeadNoEvidenceBatchController } from './lead-no-evidence-batch.controller';
import { LeadService } from './lead.service';

const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
};
const input = {
  items: [
    {
      leadId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expectedVersion: 3,
      reason: ' 不再取证 ',
    },
  ],
};
const result = {
  items: [
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      leadId: input.items[0]!.leadId,
      status: 'ARCHIVED',
      version: 4,
      result: 'NO_EVIDENCE',
      reason: '不再取证',
      decidedByDisplayName: '运营',
      decidedAt: '2026-10-20T05:00:00.000Z',
      archiveType: 'NO_EVIDENCE',
      archivedAt: '2026-10-20T05:00:00.000Z',
    },
  ],
};

describe('lead no evidence batch HTTP contract', () => {
  const decide = jest.fn().mockResolvedValue(result);
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [LeadNoEvidenceBatchController],
      providers: [
        { provide: LeadService, useValue: { decideNoEvidenceBatch: decide } },
      ],
    })
      .overrideGuard(ActorContextGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => { actor?: ActorContext } };
        }) => {
          context.switchToHttp().getRequest().actor = actor;
          return true;
        },
      })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.init();
  });
  afterAll(async () => app?.close());
  beforeEach(() => jest.clearAllMocks());

  it('passes the header key and complete ordered DTO and documents the original single-result shape', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/leads/batch-no-evidence')
      .set('Idempotency-Key', '  key-1  ')
      .send(input)
      .expect(201);
    expect(response.body).toEqual(result);
    expect(decide).toHaveBeenCalledWith(actor, 'key-1', input);
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const operation = doc.paths['/api/v1/leads/batch-no-evidence']?.post;
    expect(operation?.responses['201']).toBeDefined();
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
        }),
      ]),
    );
    const schema = doc.components?.schemas?.LeadNoEvidenceBatchResponseDto;
    if (!schema || !('properties' in schema))
      throw new Error('response schema missing');
    expect(schema.properties?.items).toMatchObject({
      type: 'array',
      items: { $ref: '#/components/schemas/LeadEvidenceDecisionResponseDto' },
    });
    const single = doc.components?.schemas?.LeadEvidenceDecisionResponseDto;
    if (!single || !('properties' in single))
      throw new Error('single response schema missing');
    expect(Object.keys(single.properties ?? {})).toEqual(
      expect.arrayContaining([
        'id',
        'leadId',
        'status',
        'version',
        'result',
        'reason',
        'decidedByDisplayName',
        'decidedAt',
        'archiveType',
        'archivedAt',
      ]),
    );
  });

  it('rejects missing or overlong keys and undeclared anchors before service', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/leads/batch-no-evidence')
      .send(input)
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/leads/batch-no-evidence')
      .set('Idempotency-Key', 'x'.repeat(129))
      .send(input)
      .expect(400);
    for (const body of [
      { ...input, actor: 'x' },
      { items: [{ ...input.items[0], result: 'NO_EVIDENCE' }] },
      { items: [null] },
    ]) {
      await request(app.getHttpServer())
        .post('/api/v1/leads/batch-no-evidence')
        .set('Idempotency-Key', 'key')
        .send(body)
        .expect(400);
    }
    expect(decide).not.toHaveBeenCalled();
  });
});
