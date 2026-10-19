import { ArgumentsHost, ConflictException } from '@nestjs/common';
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
