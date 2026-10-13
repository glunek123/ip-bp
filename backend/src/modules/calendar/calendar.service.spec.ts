import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CaseCalendarSourceService } from '../cases';
import { CustomerCalendarSourceService } from '../customers';
import { CalendarController } from './calendar.controller';
import { CalendarMonthQueryDto } from './calendar.dto';
import { CalendarService, summarizeCalendar } from './calendar.service';
import { CalendarDateEvent } from './calendar.types';

const court: CalendarDateEvent = {
  eventKey: 'FIRST_INSTANCE_HEARING:1',
  sourceType: 'FIRST_INSTANCE_HEARING',
  sourceId: '1',
  date: '2026-10-13',
  type: 'court',
  title: '一审开庭',
  sub: null,
  caseId: 'case-1',
  customerId: null,
  courtDetails: {
    party: null,
    defendant: null,
    reason: null,
    time: null,
    place: null,
    judge: null,
  },
  caseDetails: null,
};

describe('CalendarService', () => {
  it('counts visible court events in next30 when agreements are forbidden', () => {
    const summary = summarizeCalendar([court], null, '2026-10-13');
    expect(summary.window).toEqual({
      from: '2026-10-13',
      through: '2026-11-12',
    });
    expect(summary.metrics.next30).toEqual({
      state: 'AVAILABLE',
      count: 1,
      nearestDate: '2026-10-13',
    });
    expect(summary.metrics.contract).toEqual({
      state: 'FORBIDDEN',
      count: null,
      nearestDate: null,
    });
    expect(summary.metrics.court.count).toBe(1);
    expect(summary.metrics.pay).toEqual({
      state: 'NOT_CONNECTED',
      count: null,
      nearestDate: null,
    });
  });

  it('includes both window boundaries and excludes past and day 31', () => {
    const dated = (date: string): CalendarDateEvent => ({
      ...court,
      date,
      eventKey: date,
    });
    const summary = summarizeCalendar(
      [
        dated('2026-10-12'),
        dated('2026-10-13'),
        dated('2026-11-12'),
        dated('2026-11-13'),
      ],
      [],
      '2026-10-13',
    );
    expect(summary.metrics.next30.count).toBe(2);
    expect(summary.metrics.court.count).toBe(4);
  });

  it('rejects malformed months before reading sources', async () => {
    const cases = { list: jest.fn() };
    const customers = { list: jest.fn() };
    const service = new CalendarService(
      cases as unknown as CaseCalendarSourceService,
      customers as unknown as CustomerCalendarSourceService,
    );
    await expect(
      service.snapshot(
        { userId: 'u', departmentId: 'd', authorizationRevision: 1 },
        '0000-01',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.snapshot(
        { userId: 'u', departmentId: 'd', authorizationRevision: 1 },
        '2026-13',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(cases.list).not.toHaveBeenCalled();
  });

  it('maps owner facts and rechecks case authority after the customer read', async () => {
    const calls: string[] = [];
    const cases = {
      list: jest.fn().mockImplementation(async () => {
        calls.push('case.list');
        return [
          {
            sourceType: 'SECOND_INSTANCE_HEARING',
            sourceId: 'hearing-1',
            date: '2026-10-13',
            caseId: 'case-1',
            businessNo: 'BUS-1',
            party: '权利人',
            defendant: '被告',
            place: null,
            judge: null,
          },
        ];
      }),
      revalidate: jest.fn().mockImplementation(async () => {
        calls.push('case.revalidate');
      }),
    };
    const customers = {
      list: jest.fn().mockImplementation(async () => {
        calls.push('customer.list');
        return null;
      }),
    };
    const service = new CalendarService(
      cases as unknown as CaseCalendarSourceService,
      customers as unknown as CustomerCalendarSourceService,
    );
    const result = await service.snapshot(
      { userId: 'u', departmentId: 'd', authorizationRevision: 1 },
      '2026-10',
    );
    expect(calls).toEqual(['case.list', 'customer.list', 'case.revalidate']);
    expect(result.events).toMatchObject([
      {
        eventKey: 'SECOND_INSTANCE_HEARING:hearing-1',
        type: 'court',
        caseId: 'case-1',
        customerId: null,
      },
    ]);
    expect(result.metrics.contract.count).toBeNull();
  });

  it('rejects extra query parameters on both routes', () => {
    const service = { summary: jest.fn(), snapshot: jest.fn() };
    const controller = new CalendarController(
      service as unknown as CalendarService,
    );
    const actor = { userId: 'u', departmentId: 'd', authorizationRevision: 1 };
    expect(() => controller.summary(actor, { extra: 'x' })).toThrow(
      BadRequestException,
    );
    expect(() =>
      controller.snapshot(
        actor,
        Object.assign(new CalendarMonthQueryDto(), {
          month: '2026-10',
          extra: 'x',
        }),
      ),
    ).toThrow(BadRequestException);
    expect(service.summary).not.toHaveBeenCalled();
    expect(service.snapshot).not.toHaveBeenCalled();
  });

  it('validates the complete month DTO with the global whitelist policy', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    });
    const metadata = {
      type: 'query' as const,
      metatype: CalendarMonthQueryDto,
      data: undefined,
    };
    await expect(
      pipe.transform({ month: '2026-10' }, metadata),
    ).resolves.toMatchObject({ month: '2026-10' });
    await expect(
      pipe.transform({ month: '2026-00' }, metadata),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform({ month: '2026-10', extra: 'x' }, metadata),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
