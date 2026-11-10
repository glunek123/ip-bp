import { ArgumentsHost, ConflictException, Logger } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function render(details: unknown, code = 'CSV_IMPORT_REJECTED') {
  const json = jest.fn();
  const response = {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnValue({ json }),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        requestId: 'request-1',
        method: 'POST',
        url: '/api/v1/leads/csv-import',
      }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  new HttpExceptionFilter().catch(
    new ConflictException({
      code,
      message: '导入失败',
      details,
    }),
    host,
  );
  expect(response.status).toHaveBeenCalledWith(409);
  return json.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe('HttpExceptionFilter CSV import details', () => {
  it.each([
    'OPERATOR_NOT_FOUND',
    'OPERATOR_AMBIGUOUS',
    'OPERATOR_NOT_AVAILABLE',
    'OPERATOR_NOT_AUTHORIZED',
    'OPERATOR_IMAGE_NOT_AUTHORIZED',
  ])(
    'preserves the fixed operator failure code %s without extra data',
    (code) => {
      const details = { failures: [{ index: 0, rowNumber: 2, code }] };
      expect(render(details)).toHaveProperty('details', details);
      expect(
        render({
          failures: [{ index: 0, rowNumber: 2, code, name: 'secret' }],
        }),
      ).not.toHaveProperty('details');
    },
  );

  it('preserves only safe row positions and stable codes', () => {
    const details = {
      failures: [
        { index: 0, rowNumber: 2, code: 'NOT_AVAILABLE' },
        { index: 19, rowNumber: 2_097_153, code: 'LEAD_NUMBER_EXHAUSTED' },
      ],
    };
    expect(render(details)).toEqual({
      code: 'CSV_IMPORT_REJECTED',
      message: '导入失败',
      requestId: 'request-1',
      details,
    });
  });

  it.each([
    { failures: [] },
    { failures: [{ index: 20, rowNumber: 2, code: 'NOT_AVAILABLE' }] },
    { failures: [{ index: 0, rowNumber: 1, code: 'NOT_AVAILABLE' }] },
    { failures: [{ index: 0, rowNumber: 2, code: 'RESOURCE_NOT_FOUND' }] },
    {
      failures: [
        { index: 0, rowNumber: 2, code: 'NOT_AVAILABLE', id: 'secret' },
      ],
    },
    {
      failures: [{ index: 0, rowNumber: 2, code: 'NOT_AVAILABLE' }],
      departments: [],
    },
    { departments: [{ id: 'secret', name: 'secret' }] },
  ])('does not expose malformed CSV failure details %#', (details) => {
    expect(render(details)).not.toHaveProperty('details');
  });

  it('leaves existing non-CSV safe detail handling intact', () => {
    expect(render({ retryAfterSeconds: 3 }, 'OTHER_CONFLICT')).toHaveProperty(
      'details',
      { retryAfterSeconds: 3 },
    );
  });
});
describe('HttpExceptionFilter complaint export failures', () => {
  const file = {
    caseId: '11111111-1111-4111-8111-111111111111',
    materialId: '22222222-2222-4222-8222-222222222222',
    contentVersionId: '33333333-3333-4333-8333-333333333333',
    filename: '诉状.pdf',
    reason: 'FILE_UNAVAILABLE',
  };
  it('keeps only the five approved fields per failed file', () => {
    expect(render({ files: [file] }, 'CASE_EXPORT_EMPTY')).toHaveProperty(
      'details',
      { files: [file] },
    );
    expect(
      render({ files: [{ ...file, secret: 'hidden' }] }, 'CASE_EXPORT_EMPTY'),
    ).not.toHaveProperty('details');
    expect(
      render(
        { files: [{ ...file, reason: 'RAW_EXCEPTION' }] },
        'CASE_EXPORT_EMPTY',
      ),
    ).not.toHaveProperty('details');
  });
});

describe('HttpExceptionFilter archive financial details', () => {
  const details = {
    checks: {
      payment: { state: 'PASSED', reason: 'CLOSURE_PAYMENT_REACHED' },
      refund: { state: 'UNKNOWN', reason: 'REFUND_INVENTORY_MISSING' },
      customer: { state: 'BLOCKED', reason: 'CUSTOMER_RECEIPTS_INSUFFICIENT' },
      lawyer: { state: 'EXEMPT', reason: 'EXPLICIT_ZERO_CLOSURE_AMOUNT' },
    },
  };
  it('serializes all four safe checks through the real filter', () => {
    expect(
      JSON.parse(
        JSON.stringify(render(details, 'ARCHIVE_FINANCIAL_NOT_READY')),
      ),
    ).toEqual({
      code: 'ARCHIVE_FINANCIAL_NOT_READY',
      message: '导入失败',
      requestId: 'request-1',
      details,
    });
  });
  it.each([
    undefined,
    null,
    {},
    { checks: {} },
    { checks: { ...details.checks, payment: undefined } },
    { checks: { ...details.checks, payment: { state: 'PASSED' } } },
    {
      checks: {
        ...details.checks,
        payment: { reason: 'CLOSURE_PAYMENT_REACHED' },
      },
    },
    {
      checks: {
        ...details.checks,
        payment: { state: 'READY', reason: 'CLOSURE_PAYMENT_REACHED' },
      },
    },
    {
      checks: {
        ...details.checks,
        payment: { state: 'UNKNOWN', reason: 'SECRET_SOURCE_ID_123' },
      },
    },
    {
      checks: {
        ...details.checks,
        payment: { state: 'UNKNOWN', reason: 'CUSTOMER_RECEIPTS_REACHED' },
      },
    },
    {
      checks: {
        ...details.checks,
        payment: { ...details.checks.payment, amount: '999.00' },
      },
    },
    {
      checks: {
        ...details.checks,
        refund: { ...details.checks.refund, sourceId: 'secret' },
      },
    },
    { checks: { ...details.checks, sourceIds: ['secret'] } },
    { ...details, amount: '999.00' },
    { ...details, retryAfterSeconds: 3 },
    { departments: [{ id: 'secret', name: 'secret' }] },
    ['secret'],
  ])('drops malformed or sensitive details without fallback %#', (value) => {
    expect(render(value, 'ARCHIVE_FINANCIAL_NOT_READY')).not.toHaveProperty(
      'details',
    );
  });
  it('does not enable archive details for other exceptions', () => {
    expect(render(details, 'OTHER_CONFLICT')).not.toHaveProperty('details');
  });
});

describe('HttpExceptionFilter operational timeout diagnostics', () => {
  const sentinel = 'PRIVATE_BODY_COOKIE_STACK_DO_NOT_LOG';
  function failure(error: Error) {
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const json = jest.fn();
    const response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnValue({ json }),
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          requestId: 'diagnostic-request',
          method: 'POST',
          route: { path: '/api/v1/cases/:id/complaint-mail' },
          url: `/api/v1/cases/private-id/complaint-mail?secret=${sentinel}`,
          body: { password: sentinel, businessDocument: sentinel },
          headers: { cookie: sentinel, authorization: sentinel },
        }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
    try {
      new HttpExceptionFilter().catch(error, host);
      expect(response.status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({
        code: 'INTERNAL_ERROR',
        message: '服务内部错误',
        requestId: 'diagnostic-request',
      });
      expect(logger).toHaveBeenCalledTimes(1);
      const log = logger.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(log.method).toBe('POST');
      expect(log.route).toBe('/api/v1/cases/:id/complaint-mail');
      expect(JSON.stringify({ log, response: json.mock.calls })).not.toContain(
        sentinel,
      );
      expect(log).not.toHaveProperty('message');
      expect(log).not.toHaveProperty('stack');
      expect(log).not.toHaveProperty('body');
      expect(log).not.toHaveProperty('headers');
      return log;
    } finally {
      logger.mockRestore();
    }
  }
  it('maps a prisma transaction timeout to a retryable 503 instead of an opaque 500', () => {
    const error = Object.assign(new Error('Transaction API error: timeout'), {
      code: 'P2028',
    });
    const json = jest.fn();
    const response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnValue({ json }),
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          requestId: 'busy-request',
          method: 'GET',
          route: { path: '/api/v1/cases/:id' },
          url: '/api/v1/cases/case-1',
          headers: {},
        }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    try {
      new HttpExceptionFilter().catch(error, host);
      expect(response.status).toHaveBeenCalledWith(503);
      expect(json).toHaveBeenCalledWith({
        code: 'SERVICE_BUSY',
        message: '服务繁忙，请稍后重试',
        requestId: 'busy-request',
      });
    } finally {
      logger.mockRestore();
    }
  });
  it('classifies exact client timeout and hides sensitive request body and cookies', () => {
    const log = failure(new Error('Query read timeout'));
    expect(log.errorReason).toBe('PG_CLIENT_QUERY_READ_TIMEOUT');
    expect(log.errorCode).toBeUndefined();
  });
  it('distinguishes server statement cancellation and retains its safe code', () => {
    const error = Object.assign(
      new Error('canceling statement due to statement timeout'),
      { code: '57014' },
    );
    const log = failure(error);
    expect(log.errorReason).toBe('PG_SERVER_STATEMENT_TIMEOUT');
    expect(log.errorCode).toBe('57014');
  });
  it('classifies the exact underlying timeout using the existing cause handling', () => {
    const log = failure(
      new Error('outer', { cause: new Error('Query read timeout') }),
    );
    expect(log.errorReason).toBe('PG_CLIENT_QUERY_READ_TIMEOUT');
  });
  it('does not log unknown sensitive messages or forged stack prose', () => {
    const error = new Error(sentinel);
    error.stack = `Error: ${sentinel}\n at C:/secret/${sentinel}.ts:1:2\n at ${__dirname}/http-exception.filter.ts:1:2 ${sentinel}`;
    const log = failure(error);
    expect(log.errorReason).toBeUndefined();
    expect(log.location).toBeUndefined();
  });
  it('does not classify message substrings with arbitrary sensitive suffixes', () => {
    const log = failure(new Error(`Query read timeout ${sentinel}`));
    expect(log.errorReason).toBeUndefined();
  });
});
