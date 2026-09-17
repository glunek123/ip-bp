import { validateEnvironment } from './environment';

const valid = {
  NODE_ENV: 'test',
  PORT: '3101',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:55433/dev_cor_test',
};

describe('environment validation', () => {
  it('parses a valid explicit configuration', () => {
    expect(validateEnvironment(valid)).toEqual({ ...valid, PORT: 3101 });
  });
  it.each(['0', '65536', '3.5', '3000junk'])(
    'rejects invalid port %s',
    (PORT) => {
      expect(() => validateEnvironment({ ...valid, PORT })).toThrow();
    },
  );
  it('rejects missing database configuration without leaking it', () => {
    expect(() => validateEnvironment({ ...valid, DATABASE_URL: '' })).toThrow(
      'DATABASE_URL',
    );
    expect(() =>
      validateEnvironment({
        ...valid,
        DATABASE_URL: 'https://secret:password@host',
      }),
    ).toThrow('DATABASE_URL');
  });
  it('rejects an unrecognized environment', () => {
    expect(() =>
      validateEnvironment({ ...valid, NODE_ENV: 'prodution' }),
    ).toThrow('NODE_ENV');
  });
  it('rejects synthetic identity fixtures outside the test environment', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        NODE_ENV: 'production',
        E2E_IDENTITY_FIXTURES: '{}',
      }),
    ).toThrow('only in test');
  });
});
