import { BadRequestException, Injectable } from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { CaseCalendarSourceService, CaseCalendarFact } from '../cases';
import {
  CustomerCalendarSourceService,
  CustomerAgreementExpiryFact,
} from '../customers';
import {
  CalendarDateEvent,
  CalendarMetric,
  CalendarSnapshot,
  CalendarSummary,
} from './calendar.types';

function shanghaiToday(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function metric(events: CalendarDateEvent[], today: string): CalendarMetric {
  return {
    state: 'AVAILABLE',
    count: events.length,
    nearestDate:
      events
        .filter((event) => event.date >= today)
        .map((event) => event.date)
        .sort()[0] ?? null,
  };
}

function uniqueEvents(events: CalendarDateEvent[]): CalendarDateEvent[] {
  return [...new Map(events.map((event) => [event.eventKey, event])).values()];
}

function courtEvent(fact: CaseCalendarFact): CalendarDateEvent {
  return {
    eventKey: `${fact.sourceType}:${fact.sourceId}`,
    sourceType: fact.sourceType,
    sourceId: fact.sourceId,
    date: fact.date,
    type: 'court',
    title:
      fact.sourceType === 'FIRST_INSTANCE_HEARING' ? '一审开庭' : '二审开庭',
    sub: fact.businessNo,
    caseId: fact.caseId,
    customerId: null,
    courtDetails: {
      party: fact.party,
      defendant: fact.defendant,
      reason: null,
      time: null,
      place: fact.place,
      judge: fact.judge,
    },
    caseDetails: null,
  };
}

function contractEvent(fact: CustomerAgreementExpiryFact): CalendarDateEvent {
  return {
    eventKey: `CUSTOMER_AGREEMENT_EXPIRY:${fact.sourceId}`,
    sourceType: 'CUSTOMER_AGREEMENT_EXPIRY',
    sourceId: fact.sourceId,
    date: fact.date,
    type: 'contract',
    title: '当前协议到期',
    sub: fact.name,
    caseId: null,
    customerId: fact.customerId,
    courtDetails: null,
    caseDetails: null,
  };
}

const notConnected: CalendarMetric = {
  state: 'NOT_CONNECTED',
  count: null,
  nearestDate: null,
};
const forbidden: CalendarMetric = {
  state: 'FORBIDDEN',
  count: null,
  nearestDate: null,
};

export function summarizeCalendar(
  court: CalendarDateEvent[],
  contract: CalendarDateEvent[] | null,
  today: string,
): CalendarSummary {
  const through = addDays(today, 30);
  const visible = uniqueEvents([...court, ...(contract ?? [])]);
  const next30 = visible.filter(
    (event) => event.date >= today && event.date <= through,
  );
  return {
    today,
    timeZone: 'Asia/Shanghai',
    window: { from: today, through },
    metrics: {
      next30: metric(next30, today),
      court: metric(uniqueEvents(court), today),
      pay: notConnected,
      contract:
        contract === null ? forbidden : metric(uniqueEvents(contract), today),
      other: notConnected,
    },
  };
}

@Injectable()
export class CalendarService {
  constructor(
    private readonly caseSource: CaseCalendarSourceService,
    private readonly customerSource: CustomerCalendarSourceService,
  ) {}

  private async read(actor: ActorContext) {
    // Case authorization gates the whole calendar. The owner source performs
    // the same current principal checks as the case read endpoints.
    const courtFacts = await this.caseSource.list(actor);
    const contractFacts = await this.customerSource.list(actor);
    await this.caseSource.revalidate(actor, courtFacts);
    const court = courtFacts.map(courtEvent);
    const contract = contractFacts?.map(contractEvent) ?? null;
    const today = shanghaiToday(new Date());
    return { court, contract, today };
  }

  async summary(actor: ActorContext): Promise<CalendarSummary> {
    const { court, contract, today } = await this.read(actor);
    return summarizeCalendar(court, contract, today);
  }

  async snapshot(
    actor: ActorContext,
    month: string,
  ): Promise<CalendarSnapshot> {
    if (!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'month 必须为 YYYY-MM',
      });
    const { court, contract, today } = await this.read(actor);
    const events = uniqueEvents([...court, ...(contract ?? [])])
      .filter((event) => event.date.startsWith(`${month}-`))
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) || a.eventKey.localeCompare(b.eventKey),
      );
    return { ...summarizeCalendar(court, contract, today), month, events };
  }
}
