import 'reflect-metadata';
import { INestApplication, Type } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { configureApp } from '../../common/configure-app';
import { LeadNotaryController } from './lead-notary.controller';
import { LeadNotaryService } from './lead-notary.service';
import { LeadModule } from './lead.module';
import { NotaryIssuanceDecisionService } from './notary-issuance-decision.service';
import { NotaryListController } from './notary-list.controller';
import { NotaryListPreferenceService } from './notary-list-preference.service';
import { NotaryListService } from './notary-list.service';
import { NotaryOpeningReviewService } from './notary-opening-review.service';
import { NotaryOpeningService } from './notary-opening.service';
import { NotaryReturnArchiveService } from './notary-return-archive.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const matterId = '33333333-3333-4333-8333-333333333333';
const preference = {
  order: ['businessNo', 'stage', 'sourceLead', 'notaryOffice', 'createdAt'],
  hidden: [],
};

describe('Notary list route precedence from LeadModule', () => {
  const getPreference = jest.fn();
  const putPreference = jest.fn();
  const getMatter = jest.fn();
  let app: INestApplication;

  beforeAll(async () => {
    const registeredControllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      LeadModule,
    ) as Type<unknown>[];
    const controllers = registeredControllers.filter(
      (controller) =>
        controller === LeadNotaryController ||
        controller === NotaryListController,
    );
    expect(controllers).toHaveLength(2);
    const module = await Test.createTestingModule({
      controllers,
      providers: [
        { provide: LeadNotaryService, useValue: { getMatter } },
        { provide: NotaryOpeningService, useValue: {} },
        { provide: NotaryOpeningReviewService, useValue: {} },
        { provide: NotaryIssuanceDecisionService, useValue: {} },
        { provide: NotaryReturnArchiveService, useValue: {} },
        { provide: NotaryListService, useValue: {} },
        {
          provide: NotaryListPreferenceService,
          useValue: { get: getPreference, put: putPreference },
        },
      ],
    })
      .overrideGuard(ActorContextGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => { actor?: typeof actor } };
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

  beforeEach(() => {
    jest.clearAllMocks();
    getPreference.mockResolvedValue(preference);
    putPreference.mockResolvedValue(preference);
    getMatter.mockResolvedValue({ id: matterId });
  });

  it('routes GET preference to the static endpoint', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/notary-matters/list-preference')
      .expect(200)
      .expect(preference);
    expect(getPreference).toHaveBeenCalledWith(actor);
    expect(getMatter).not.toHaveBeenCalled();
  });

  it('routes PUT preference to the static endpoint', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/notary-matters/list-preference')
      .send(preference)
      .expect(200)
      .expect(preference);
    expect(putPreference).toHaveBeenCalledWith(actor, preference);
    expect(getMatter).not.toHaveBeenCalled();
  });

  it('keeps the UUID matter detail route', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/notary-matters/${matterId}`)
      .expect(200)
      .expect({ id: matterId });
    expect(getMatter).toHaveBeenCalledWith(actor, matterId);
    expect(getPreference).not.toHaveBeenCalled();
  });
});
