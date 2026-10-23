import { validateEnvironment } from './environment';
import { resolve } from 'node:path';

const repositoryRoot = resolve(__dirname, '../../..');

const valid = {
  NODE_ENV: 'test',
  PORT: '3101',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:55433/dev_cor_test',
  AUTH_THROTTLE_SECRET: 'a'.repeat(64),
  PRIVATE_FILE_ROOT: resolve(
    repositoryRoot,
    '.local/private-files/environment-spec',
  ),
};

describe('environment validation', () => {
  it('parses a valid explicit configuration', () => {
    expect(validateEnvironment(valid)).toEqual({
      ...valid,
      PORT: 3101,
      TRUST_PROXY_HOPS: 0,
    });
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
  it('requires a high-entropy throttle digest secret', () => {
    expect(() =>
      validateEnvironment({ ...valid, AUTH_THROTTLE_SECRET: 'too-short' }),
    ).toThrow('AUTH_THROTTLE_SECRET');
  });
  it.each(['-1', '11', 'one'])('rejects invalid proxy hops %s', (value) => {
    expect(() =>
      validateEnvironment({ ...valid, TRUST_PROXY_HOPS: value }),
    ).toThrow('TRUST_PROXY_HOPS');
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
  it.each([
    ['relative/private-files'],
    [resolve(repositoryRoot, 'frontend', 'private-files')],
    [resolve(repositoryRoot, 'backend', 'src', 'private-files')],
    [resolve(repositoryRoot, 'backend')],
    [resolve(repositoryRoot, '.local/runner-temp/dev-cor-private-test')],
  ])('rejects unsafe private file root %s', (PRIVATE_FILE_ROOT) => {
    expect(() => validateEnvironment({ ...valid, PRIVATE_FILE_ROOT })).toThrow(
      'PRIVATE_FILE_ROOT',
    );
  });

  it('boots production without a local private file root', () => {
    const production = validateEnvironment({
      ...valid,
      NODE_ENV: 'production',
      PRIVATE_FILE_ROOT: undefined,
    });
    expect(production.PRIVATE_FILE_ROOT).toBeUndefined();
  });

  it('preserves an explicit local storage driver in production', () => {
    expect(
      validateEnvironment({
        ...valid,
        NODE_ENV: 'production',
        PRIVATE_BLOB_STORAGE_DRIVER: 'local',
      }),
    ).toMatchObject({ PRIVATE_BLOB_STORAGE_DRIVER: 'local' });
  });

  it('requires a private root when production explicitly selects local storage', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        NODE_ENV: 'production',
        PRIVATE_BLOB_STORAGE_DRIVER: 'local',
        PRIVATE_FILE_ROOT: undefined,
      }),
    ).toThrow('PRIVATE_FILE_ROOT');
  });

  it.each(['LOCAL', '', 's3', 'local ', false, 1])(
    'rejects unsupported storage driver %s',
    (PRIVATE_BLOB_STORAGE_DRIVER) => {
      expect(() =>
        validateEnvironment({ ...valid, PRIVATE_BLOB_STORAGE_DRIVER }),
      ).toThrow('PRIVATE_BLOB_STORAGE_DRIVER');
    },
  );

  it('does not echo an invalid storage driver value', () => {
    const rejected = 'invalid-driver-with-private-value';
    try {
      validateEnvironment({ ...valid, PRIVATE_BLOB_STORAGE_DRIVER: rejected });
      throw new Error('Expected storage driver validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('PRIVATE_BLOB_STORAGE_DRIVER');
      expect((error as Error).message).not.toContain(rejected);
    }
  });

  it.each([
    'relative/private-files',
    resolve(repositoryRoot, 'frontend', 'private-files'),
    resolve(repositoryRoot, 'backend', 'src', 'private-files'),
    resolve(repositoryRoot, '.local/runner-temp/uat-private'),
  ])(
    'retains the path checks for explicit production local storage: %s',
    (PRIVATE_FILE_ROOT) => {
      expect(() =>
        validateEnvironment({
          ...valid,
          NODE_ENV: 'production',
          PRIVATE_BLOB_STORAGE_DRIVER: 'local',
          PRIVATE_FILE_ROOT,
        }),
      ).toThrow('PRIVATE_FILE_ROOT');
    },
  );
});
