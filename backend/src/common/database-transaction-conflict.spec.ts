import { isDatabaseTransactionConflict } from './database-transaction-conflict';

describe('database transaction conflict classification', () => {
  it.each(['VERSION_CONFLICT', 'P2025'])(
    'does not override explicit root %s with a nested database conflict',
    (code) => {
      const error = { code, cause: { originalCode: '40001' } };
      expect(isDatabaseTransactionConflict(error)).toBe(false);
      expect(isDatabaseTransactionConflict(error, { retryUnique: true })).toBe(
        false,
      );
    },
  );
  it.each(['P2034', '40001', '40P01', '55P03'])(
    'recognizes explicit top-level conflict %s',
    (code) => expect(isDatabaseTransactionConflict({ code })).toBe(true),
  );
  it.each(['40001', '40P01', '55P03'])(
    'recognizes the actual Prisma adapter originalCode %s',
    (originalCode) => {
      expect(
        isDatabaseTransactionConflict({
          code: 'P2010',
          meta: {
            driverAdapterError: {
              cause: { originalCode, kind: 'TransactionWriteConflict' },
            },
          },
        }),
      ).toBe(true);
    },
  );
  it('recognizes raw-query metadata and nested SQLSTATE without parsing messages', () => {
    expect(
      isDatabaseTransactionConflict({ code: 'P2010', meta: { code: '40001' } }),
    ).toBe(true);
    expect(
      isDatabaseTransactionConflict({ cause: { sqlState: '40P01' } }),
    ).toBe(true);
    expect(
      isDatabaseTransactionConflict({ originalError: { sqlstate: '55P03' } }),
    ).toBe(true);
    expect(
      isDatabaseTransactionConflict(new Error('40001 serialization failure')),
    ).toBe(false);
  });
  it.each(['P2002', '23505'])('keeps unique conflicts opt-in: %s', (code) => {
    expect(isDatabaseTransactionConflict({ code })).toBe(false);
    expect(isDatabaseTransactionConflict({ code }, { retryUnique: true })).toBe(
      true,
    );
  });
  it('recognizes adapter unique violations only on the pre-existing opt-in paths', () => {
    const error = {
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '23505' } } },
    };
    expect(isDatabaseTransactionConflict(error)).toBe(false);
    expect(isDatabaseTransactionConflict(error, { retryUnique: true })).toBe(
      true,
    );
  });
  it.each(['23514', '23503', 'P2025', 'VOID', 'VERSION_CONFLICT'])(
    'does not retry %s even when unique retries are enabled',
    (code) =>
      expect(
        isDatabaseTransactionConflict({ code }, { retryUnique: true }),
      ).toBe(false),
  );
  it('keeps an explicit constraint error authoritative over nested unrelated data', () => {
    expect(
      isDatabaseTransactionConflict({
        code: '23514',
        cause: { originalCode: '40001' },
      }),
    ).toBe(false);
  });
  it('does not infer a conflict from an adapter kind, arbitrary payload or a cycle', () => {
    const error: { code: string; cause?: unknown } = { code: 'P2010' };
    error.cause = error;
    expect(isDatabaseTransactionConflict(error)).toBe(false);
    expect(
      isDatabaseTransactionConflict({
        meta: {
          driverAdapterError: { cause: { kind: 'TransactionWriteConflict' } },
        },
      }),
    ).toBe(false);
    expect(isDatabaseTransactionConflict({ details: { code: '40001' } })).toBe(
      false,
    );
    expect(isDatabaseTransactionConflict(null)).toBe(false);
  });
});
