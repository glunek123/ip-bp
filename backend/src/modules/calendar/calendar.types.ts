export type CalendarDateEvent = {
  eventKey: string;
  sourceType:
    | 'FIRST_INSTANCE_HEARING'
    | 'SECOND_INSTANCE_HEARING'
    | 'CUSTOMER_AGREEMENT_EXPIRY';
  sourceId: string;
  date: string;
  type: 'court' | 'contract';
  title: string;
  sub: string | null;
  caseId: string | null;
  customerId: string | null;
  courtDetails: null | {
    party: string | null;
    defendant: string | null;
    reason: string | null;
    time: string | null;
    place: string | null;
    judge: string | null;
  };
  caseDetails: null | {
    customer: string | null;
    rightsHolder: string | null;
    defendant: string | null;
    caseNumber: string | null;
    amount: string | null;
  };
};

export type CalendarMetric = {
  state: 'AVAILABLE' | 'NOT_CONNECTED' | 'FORBIDDEN';
  count: number | null;
  nearestDate: string | null;
};

export type CalendarSummary = {
  today: string;
  timeZone: 'Asia/Shanghai';
  window: { from: string; through: string };
  metrics: Record<
    'next30' | 'court' | 'pay' | 'contract' | 'other',
    CalendarMetric
  >;
};

export type CalendarSnapshot = CalendarSummary & {
  month: string;
  events: CalendarDateEvent[];
};
