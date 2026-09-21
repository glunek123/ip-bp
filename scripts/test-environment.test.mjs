import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureTestEnvironment } from './test-environment.mjs';
import * as testEnvironment from './test-environment.mjs';

const secret = 'a'.repeat(64);
const databaseUrl =
  'postgresql://dev_cor_test:local-test-password@127.0.0.1:55433/dev_cor_test';

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
  }).trim();
}

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'dev-cor-test-environment-'));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test Environment');
  git(root, 'config', 'core.autocrlf', 'false');
  mkdirSync(join(root, 'backend'));
  writeFileSync(join(root, '.gitignore'), 'backend/.env.test\n');
  writeFileSync(join(root, 'tracked.txt'), 'candidate\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'baseline');
  writeTestEnvironment(root);
  return root;
}

function writeTestEnvironment(
  root,
  suffix = '',
  privateFileRoot = join(root, '.local/private-files/test'),
) {
  writeFileSync(
    join(root, 'backend', '.env.test'),
    [
      'NODE_ENV=test',
      'PORT=3101',
      `DATABASE_URL=${databaseUrl}`,
      `AUTH_THROTTLE_SECRET=${secret}`,
      `PRIVATE_FILE_ROOT=${privateFileRoot}`,
      suffix,
    ]
      .filter(Boolean)
      .join('\n') + '\n',
  );
}

function capture(root, inheritedEnvironment = {}) {
  return captureTestEnvironment(root, {
    inheritedEnvironment,
    nodeVersion: 'v24.21.0',
    pnpmVersion: '11.27.0',
    platform: 'win32',
    architecture: 'x64',
    externalConditions: {
      databaseImage: 'sha256:database-image',
      browserManifest: 'sha256:browser-manifest',
    },
  });
}

test('builds one validated effective environment without exposing secrets', (t) => {
  const root = repository(t);
  const result = capture(root, { TZ: 'Asia/Shanghai' });

  assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(result.metadata, {
    node: 'v24.21.0',
    pnpm: '11.27.0',
    platform: 'win32',
    architecture: 'x64',
  });
  assert.equal(result.childEnvironment.NODE_ENV, 'test');
  assert.equal(result.childEnvironment.PORT, '3101');
  assert.equal(result.childEnvironment.DATABASE_URL, databaseUrl);
  assert.equal(result.childEnvironment.AUTH_THROTTLE_SECRET, secret);
  assert.equal(result.childEnvironment.TRUST_PROXY_HOPS, '0');
  assert.equal(
    result.childEnvironment.PRIVATE_FILE_ROOT,
    join(root, '.local/private-files/test'),
  );
  assert.equal(
    result.childEnvironment.API_PROXY_TARGET,
    'http://127.0.0.1:3101',
  );
  assert.equal(result.childEnvironment.TZ, 'Asia/Shanghai');

  const serializable = JSON.stringify({
    fingerprint: result.fingerprint,
    metadata: result.metadata,
  });
  assert.doesNotMatch(serializable, /local-test-password/);
  assert.doesNotMatch(serializable, new RegExp(secret));
});

test('rejects inherited application overrides before execution', (t) => {
  const root = repository(t);
  const conflictingUrl =
    'postgresql://other:other@127.0.0.1:55433/dev_cor_test';

  assert.throws(
    () => capture(root, { DATABASE_URL: conflictingUrl }),
    /DATABASE_URL.*conflict/i,
  );
  try {
    capture(root, { DATABASE_URL: conflictingUrl });
    assert.fail('expected an environment conflict');
  } catch (error) {
    assert.doesNotMatch(String(error), /local-test-password|other:other/);
  }
});

test('fails for missing or invalid files and changes the fingerprint when inputs change', (t) => {
  const root = repository(t);
  const first = capture(root);
  writeTestEnvironment(root, '# changed input');
  const second = capture(root);
  assert.notEqual(second.fingerprint, first.fingerprint);

  rmSync(join(root, 'backend', '.env.test'));
  assert.throws(() => capture(root), /backend\/\.env\.test.*required/i);

  mkdirSync(join(root, 'backend', '.env.test'));
  assert.throws(() => capture(root), /backend\/\.env\.test.*read/i);
});

test('shares the HMAC key across worktrees without binding absolute paths', (t) => {
  const root = repository(t);
  const linked = mkdtempSync(
    join(tmpdir(), 'dev-cor-test-environment-linked-'),
  );
  rmSync(linked, { recursive: true, force: true });
  git(root, 'worktree', 'add', '--detach', linked, 'HEAD');

  try {
    mkdirSync(join(linked, 'backend'), { recursive: true });
    writeTestEnvironment(linked);
    const source = capture(root, { PLAYWRIGHT_BROWSERS_PATH: 'shared' });
    const reused = capture(linked, { PLAYWRIGHT_BROWSERS_PATH: 'shared' });
    assert.equal(reused.fingerprint, source.fingerprint);

    const changedControl = capture(linked, {
      PLAYWRIGHT_BROWSERS_PATH: 'different',
    });
    assert.notEqual(changedControl.fingerprint, source.fingerprint);

    const commonDirectory = git(root, 'rev-parse', '--git-common-dir');
    const key = readFileSync(
      join(
        root,
        commonDirectory,
        'dev-cor-validation-evidence',
        'fingerprint.key',
      ),
    );
    assert.equal(key.length, 32);
  } finally {
    git(root, 'worktree', 'remove', '--force', linked);
  }
});

test('binds actual external test conditions without serializing them', (t) => {
  const root = repository(t);
  const first = capture(root);
  const changed = captureTestEnvironment(root, {
    inheritedEnvironment: {},
    nodeVersion: 'v24.21.0',
    pnpmVersion: '11.27.0',
    platform: 'win32',
    architecture: 'x64',
    externalConditions: {
      databaseImage: 'sha256:different-database-image',
      browserManifest: 'sha256:browser-manifest',
    },
  });

  assert.notEqual(changed.fingerprint, first.fingerprint);
  assert.doesNotMatch(
    JSON.stringify({
      fingerprint: first.fingerprint,
      metadata: first.metadata,
    }),
    /database-image|browser-manifest/,
  );
});

test('accepts an explicit isolated local database override for unavailable fixed ports', (t) => {
  const root = repository(t);
  const override =
    'postgresql://dev_cor_test:local-test-password@127.0.0.1:49123/dev_cor_test';
  const result = capture(root, { DEV_COR_TEST_DATABASE_URL: override });

  assert.equal(result.childEnvironment.DATABASE_URL, override);
  assert.doesNotMatch(
    JSON.stringify({
      fingerprint: result.fingerprint,
      metadata: result.metadata,
    }),
    /local-test-password|49123/,
  );
  assert.throws(
    () =>
      capture(root, {
        DEV_COR_TEST_DATABASE_URL:
          'postgresql://dev_cor_test:local-test-password@example.com:49123/dev_cor_test',
      }),
    /isolated local test database/i,
  );
  assert.throws(
    () =>
      capture(root, {
        DEV_COR_TEST_DATABASE_URL:
          'postgresql://dev_cor_test:local-test-password@127.0.0.1:49123/dev_cor',
      }),
    /isolated local test database/i,
  );
  assert.throws(
    () =>
      capture(root, {
        DEV_COR_TEST_DATABASE_URL:
          'postgresql://dev_cor_test:other-password@127.0.0.1:49123/dev_cor_test',
      }),
    /isolated local test database/i,
  );
});

test('rejects every PostgreSQL query override before a connection can be attempted', (t) => {
  const root = repository(t);
  for (const query of [
    'host=remote.example&port=5432&user=other&password=other',
    'host=%2Ftmp&database=dev_cor_test',
    'sslmode=require',
    'sslrootcert=C%3A%5Csecrets%5Croot.crt',
    'options=-c%20search_path%3Dpublic',
  ]) {
    assert.throws(
      () =>
        capture(root, {
          DEV_COR_TEST_DATABASE_URL: `${databaseUrl}?${query}`,
        }),
      /query parameters|isolated local test database/i,
    );
  }
});

test('binds the effective target to one healthy pinned test container', () => {
  const imageId =
    'sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0';
  const target = {
    hostname: '127.0.0.1',
    port: 49123,
    username: 'dev_cor_test',
    database: 'dev_cor_test',
  };
  const expected = {
    Id: 'a'.repeat(64),
    Name: '/dev-cor-postgres-test-1',
    Image: imageId,
    Config: {
      Image: 'postgres:17.11-bookworm',
      Env: ['POSTGRES_USER=dev_cor_test', 'POSTGRES_DB=dev_cor_test'],
      Labels: {},
    },
    State: { Running: true, Health: { Status: 'healthy' } },
    NetworkSettings: {
      Ports: {
        '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '49123' }],
      },
    },
  };

  assert.deepEqual(
    testEnvironment.selectTestDatabaseContainer(target, [expected], imageId),
    {
      containerId: expected.Id,
      containerName: 'dev-cor-postgres-test-1',
      imageId,
      imageReference: 'postgres:17.11-bookworm',
      host: '127.0.0.1',
      port: 49123,
    },
  );

  assert.throws(
    () =>
      testEnvironment.selectTestDatabaseContainer(
        target,
        [{ ...expected, Name: '/unrelated-local-postgres' }],
        imageId,
      ),
    /test container/i,
  );
  assert.throws(
    () =>
      testEnvironment.selectTestDatabaseContainer(
        target,
        [{ ...expected, Image: `sha256:${'b'.repeat(64)}` }],
        imageId,
      ),
    /pinned PostgreSQL image/i,
  );
  assert.throws(
    () =>
      testEnvironment.selectTestDatabaseContainer(
        target,
        [
          {
            ...expected,
            NetworkSettings: {
              Ports: {
                '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '49124' }],
              },
            },
          },
        ],
        imageId,
      ),
    /published port/i,
  );
});
