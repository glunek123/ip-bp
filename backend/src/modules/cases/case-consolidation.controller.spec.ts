import 'reflect-metadata';
import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { configureApp } from '../../common/configure-app';
import { CaseConsolidationController } from './case-consolidation.controller';
import { CaseConsolidationService } from './case-consolidation.service';

const caseId = '046e1324-a2d4-4d4c-87e1-f88979d46e55';
const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};

describe('case consolidation read endpoint', () => {
  let app: INestApplication;
  const service = { read: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CaseConsolidationController],
      providers: [{ provide: CaseConsolidationService, useValue: service }],
    })
      .overrideGuard(ActorContextGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().actor = actor;
          return true;
        },
      })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => app.close());
  afterEach(() => jest.resetAllMocks());

  it('returns JSON null for an ordinary case and JSON data for a merged case', async () => {
    service.read.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'f1021723-2369-4fda-8a38-01a840717dee',
      mainCaseId: caseId,
      caseCount: 2,
      cases: [],
    });
    const empty = await request(app.getHttpServer())
      .get(`/api/v1/cases/${caseId}/consolidation`)
      .expect('Content-Type', /json/)
      .expect(200);
    expect(empty.text).toBe('null');
    const merged = await request(app.getHttpServer())
      .get(`/api/v1/cases/${caseId}/consolidation`)
      .expect('Content-Type', /json/)
      .expect(200);
    expect(merged.body).toMatchObject({ mainCaseId: caseId, caseCount: 2 });
    expect(service.read).toHaveBeenCalledWith(actor, caseId);
  });

  it('keeps the service permission error and rejects malformed identifiers', async () => {
    service.read.mockRejectedValueOnce(new ForbiddenException());
    await request(app.getHttpServer())
      .get(`/api/v1/cases/${caseId}/consolidation`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/cases/not-a-uuid/consolidation')
      .expect(400);
  });
});
