import {
  assertSafeBootstrapDatabaseTarget,
  parseBootstrapOptions,
} from './bootstrap-local-account-target';

describe('local account bootstrap database target', () => {
  const expected = {
    expectedHost: '127.0.0.1',
    expectedPort: '55432',
    expectedDatabase: 'dev_cor',
  };

  it('requires the operator to state the expected host, port and database', () => {
    expect(() =>
      parseBootstrapOptions([
        '--department',
        '知产部',
        '--username',
        'admin',
        '--display-name',
        '系统管理员',
      ]),
    ).toThrow('expected-db-host');
  });

  it('accepts an exact non-production loopback database target', () => {
    expect(() =>
      assertSafeBootstrapDatabaseTarget({
        databaseUrl: 'postgresql://local:secret@127.0.0.1:55432/dev_cor',
        nodeEnv: 'development',
        ...expected,
      }),
    ).not.toThrow();
  });

  it.each([
    {
      label: 'production mode',
      databaseUrl: 'postgresql://local:secret@127.0.0.1:55432/dev_cor',
      nodeEnv: 'production',
      overrides: {},
    },
    {
      label: 'an unset environment mode',
      databaseUrl: 'postgresql://local:secret@127.0.0.1:55432/dev_cor',
      nodeEnv: undefined,
      overrides: {},
    },
    {
      label: 'a remote database host',
      databaseUrl: 'postgresql://local:secret@db.example.test:55432/dev_cor',
      nodeEnv: 'development',
      overrides: { expectedHost: 'db.example.test' },
    },
    {
      label: 'a host mismatch',
      databaseUrl: 'postgresql://local:secret@localhost:55432/dev_cor',
      nodeEnv: 'development',
      overrides: {},
    },
    {
      label: 'a port mismatch',
      databaseUrl: 'postgresql://local:secret@127.0.0.1:5432/dev_cor',
      nodeEnv: 'development',
      overrides: {},
    },
    {
      label: 'a database mismatch',
      databaseUrl: 'postgresql://local:secret@127.0.0.1:55432/dev_cor_other',
      nodeEnv: 'test',
      overrides: {},
    },
  ])('rejects $label', ({ databaseUrl, nodeEnv, overrides }) => {
    expect(() =>
      assertSafeBootstrapDatabaseTarget({
        databaseUrl,
        nodeEnv,
        ...expected,
        ...overrides,
      }),
    ).toThrow('BOOTSTRAP_DATABASE_TARGET_REJECTED');
  });

  it('parses every required bootstrap and database target option exactly once', () => {
    expect(
      parseBootstrapOptions([
        '--department',
        '知产部',
        '--username',
        'Admin',
        '--display-name',
        '系统管理员',
        '--expected-db-host',
        '127.0.0.1',
        '--expected-db-port',
        '55432',
        '--expected-db-name',
        'dev_cor',
      ]),
    ).toEqual({
      departmentName: '知产部',
      username: 'Admin',
      displayName: '系统管理员',
      expectedHost: '127.0.0.1',
      expectedPort: '55432',
      expectedDatabase: 'dev_cor',
    });
  });
});
