import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { configureApp } from '../../common/configure-app';
import { CalendarController } from './calendar.controller';
import { CalendarReminderService } from './calendar-reminder.service';
import { CalendarService } from './calendar.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const summary = {
  today: '2026-10-13',
  timeZone: 'Asia/Shanghai',
  window: { from: '2026-10-13', through: '2026-11-12' },
  metrics: {
    next30: { state: 'AVAILABLE', count: 1, nearestDate: '2026-10-13' },
    court: { state: 'AVAILABLE', count: 1, nearestDate: '2026-10-13' },
    pay: { state: 'NOT_CONNECTED', count: null, nearestDate: null },
    contract: { state: 'FORBIDDEN', count: null, nearestDate: null },
    other: { state: 'NOT_CONNECTED', count: null, nearestDate: null },
  },
};

describe('calendar HTTP and OpenAPI contract', () => {
  let app: INestApplication;
  const service = {
    summary: jest.fn().mockResolvedValue(summary),
    snapshot: jest
      .fn()
      .mockImplementation(async (_actor: unknown, month: string) => ({
        ...summary,
        month,
        events: [],
      })),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CalendarController],
      providers: [
        { provide: CalendarService, useValue: service },
        { provide: CalendarReminderService, useValue: {} },
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
  beforeEach(() => jest.clearAllMocks());

  it('accepts an empty summary query and rejects an extra parameter', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/calendar/summary')
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject(summary));
    await request(app.getHttpServer())
      .get('/api/v1/calendar/summary?extra=1')
      .expect(400);
    expect(service.summary).toHaveBeenCalledTimes(1);
  });

  it('requires exactly one valid month and rejects unknown parameters', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/calendar?month=2026-10')
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({ month: '2026-10', events: [] }),
      );
    for (const query of [
      '',
      '?month=2026-00',
      '?month=0000-01',
      '?month=2026-10&unknown=1',
      '?month=2026-10&month=2026-11',
    ])
      await request(app.getHttpServer())
        .get(`/api/v1/calendar${query}`)
        .expect(400);
    expect(service.snapshot).toHaveBeenCalledTimes(1);
  });

  it('publishes precise response shapes in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    const summaryResponse =
      document.paths['/api/v1/calendar/summary']?.get?.responses['200'];
    const snapshotResponse =
      document.paths['/api/v1/calendar']?.get?.responses['200'];
    if (
      !summaryResponse ||
      !('content' in summaryResponse) ||
      !snapshotResponse ||
      !('content' in snapshotResponse)
    )
      throw new Error('Calendar response schemas missing');
    expect(summaryResponse.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/CalendarSummaryResponseDto',
    });
    expect(snapshotResponse.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/CalendarSnapshotResponseDto',
    });
    const summarySchema =
      document.components?.schemas?.CalendarSummaryResponseDto;
    const snapshotSchema =
      document.components?.schemas?.CalendarSnapshotResponseDto;
    if (
      !summarySchema ||
      !('properties' in summarySchema) ||
      !snapshotSchema ||
      !('properties' in snapshotSchema)
    )
      throw new Error('Calendar component schemas missing');
    expect(Object.keys(summarySchema.properties ?? {})).toEqual(
      expect.arrayContaining(['today', 'timeZone', 'window', 'metrics']),
    );
    expect(Object.keys(snapshotSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['month', 'events']),
    );
  });
});
