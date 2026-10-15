import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureTestEnvironment } from './test-environment.mjs';
import * as testEnvironment from './test-environment.mjs';

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, execFileSync: vi.fn(original.execFileSync) };
});

const secret = 'a'.repeat(64);
const databaseUrl =
  'postgresql://dev_cor_test:local-test-password@127.0.0.1:15433/dev_cor_test';

test('requires the fixed isolated test port, not the old or development port', () => {
  assert.equal(
    testEnvironment.validateIsolatedTestDatabaseUrl(databaseUrl).port,
    15433,
  );
  for (const port of [55433, 55432]) {
    assert.throws(() =>
      testEnvironment.validateIsolatedTestDatabaseUrl(
        databaseUrl.replace(':15433/', `:${port}/`),
      ),
    );
  }
});

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
    'postgresql://other:other@127.0.0.1:15433/dev_cor_test';

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

function managedTestInstance() {
  const binding = {
    project: 'dev-cor-ui003',
    containerId: 'c'.repeat(64),
  };
  const target = {
    hostname: '127.0.0.1',
    port: 49123,
    username: 'dev_cor_test',
    database: 'dev_cor_test',
  };
  const container = {
    Id: binding.containerId,
    Name: `/${binding.project}-postgres-test-1`,
    Image:
      'sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0',
    Config: {
      Image: 'postgres:17.11-bookworm',
      Env: ['POSTGRES_USER=dev_cor_test', 'POSTGRES_DB=dev_cor_test'],
      Labels: {
        'com.docker.compose.project': binding.project,
        'com.docker.compose.service': 'postgres-test',
        'com.docker.compose.container-number': '1',
      },
    },
    State: { Running: true, Health: { Status: 'healthy' } },
    NetworkSettings: {
      Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '49123' }] },
    },
  };
  return { binding, target, container };
}

test('admits only the explicitly bound new managed test instance', () => {
  const { binding, target, container } = managedTestInstance();
  const selected = testEnvironment.selectTestDatabaseContainer(
    target,
    [container],
    container.Image,
    binding,
  );
  assert.equal(selected.containerId, binding.containerId);
  assert.equal(selected.containerName, 'dev-cor-ui003-postgres-test-1');
  assert.equal(selected.port, target.port);
  assert.throws(
    () => testEnvironment.selectTestDatabaseContainer(target, [container]),
    /test container/i,
  );
});

test('rejects mismatched managed instance identity and unsafe database metadata', () => {
  const { binding, target, container } = managedTestInstance();
  const cases = [
    [
      'wrong project',
      (c) => (c.Config.Labels['com.docker.compose.project'] = 'dev-cor-other'),
    ],
    [
      'wrong service',
      (c) => (c.Config.Labels['com.docker.compose.service'] = 'postgres'),
    ],
    [
      'wrong replica',
      (c) => (c.Config.Labels['com.docker.compose.container-number'] = '2'),
    ],
    ['missing labels', (c) => (c.Config.Labels = {})],
    ['wrong name', (c) => (c.Name = '/dev-cor-other-postgres-test-1')],
    ['wrong ID', (c) => (c.Id = 'd'.repeat(64))],
    [
      'wrong port',
      (c) => (c.NetworkSettings.Ports['5432/tcp'][0].HostPort = '49124'),
    ],
    [
      'wildcard port',
      (c) => (c.NetworkSettings.Ports['5432/tcp'][0].HostIp = '0.0.0.0'),
    ],
    [
      'additional wildcard',
      (c) =>
        c.NetworkSettings.Ports['5432/tcp'].push({
          HostIp: '0.0.0.0',
          HostPort: '49123',
        }),
    ],
    [
      'additional port',
      (c) =>
        c.NetworkSettings.Ports['5432/tcp'].push({
          HostIp: '127.0.0.1',
          HostPort: '49124',
        }),
    ],
    [
      'wrong DB user',
      (c) =>
        (c.Config.Env = ['POSTGRES_USER=dev_cor', 'POSTGRES_DB=dev_cor_test']),
    ],
    [
      'wrong DB name',
      (c) =>
        (c.Config.Env = ['POSTGRES_USER=dev_cor_test', 'POSTGRES_DB=dev_cor']),
    ],
    ['wrong image', (c) => (c.Image = `sha256:${'b'.repeat(64)}`)],
    ['stopped', (c) => (c.State.Running = false)],
    ['unhealthy', (c) => (c.State.Health.Status = 'unhealthy')],
    ['no health check', (c) => delete c.State.Health],
  ];
  for (const [label, change] of cases) {
    const changed = globalThis.structuredClone(container);
    change(changed);
    assert.throws(
      () =>
        testEnvironment.selectTestDatabaseContainer(
          target,
          [changed],
          container.Image,
          binding,
        ),
      undefined,
      label,
    );
  }
  assert.throws(
    () =>
      testEnvironment.selectTestDatabaseContainer(
        target,
        [container, container],
        container.Image,
        binding,
      ),
    /one running published port/i,
  );
  for (const changedTarget of [
    { ...target, hostname: 'remote.example' },
    { ...target, username: 'dev_cor' },
    { ...target, database: 'dev_cor' },
    ...[15436, 55432, 0, 65536, NaN].map((port) => ({ ...target, port })),
  ]) {
    assert.throws(
      () =>
        testEnvironment.selectTestDatabaseContainer(
          changedTarget,
          [container],
          container.Image,
          binding,
        ),
      /isolated local test database/i,
    );
  }
});

test('explicit binding cannot fall back to legacy admission', () => {
  const { binding, target, container } = managedTestInstance();
  const legacy = globalThis.structuredClone(container);
  legacy.Name = '/dev-cor-postgres-test-1';
  legacy.Config.Labels['com.docker.compose.project'] = 'dev-cor';
  assert.equal(
    testEnvironment.selectTestDatabaseContainer(target, [legacy]).containerId,
    legacy.Id,
  );
  assert.throws(
    () =>
      testEnvironment.selectTestDatabaseContainer(
        target,
        [legacy],
        container.Image,
        binding,
      ),
    /test container/i,
  );
  legacy.Name = '/custom-legacy-name';
  assert.equal(
    testEnvironment.selectTestDatabaseContainer(target, [legacy]).containerName,
    'custom-legacy-name',
  );
});

test('requires complete explicit binding and fingerprints project and container controls', (t) => {
  const root = repository(t);
  const { binding } = managedTestInstance();
  const environment = {
    DEV_COR_TEST_DATABASE_URL: databaseUrl.replace(':15433/', ':49123/'),
    DEV_COR_TEST_DATABASE_PROJECT: binding.project,
    DEV_COR_TEST_DATABASE_CONTAINER_ID: binding.containerId,
  };
  const first = capture(root, environment);
  for (const changed of [
    { ...environment, DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-other' },
    { ...environment, DEV_COR_TEST_DATABASE_CONTAINER_ID: 'd'.repeat(64) },
  ]) {
    assert.notEqual(capture(root, changed).fingerprint, first.fingerprint);
  }
  for (const changed of [
    { ...environment, DEV_COR_TEST_DATABASE_URL: undefined },
    { ...environment, DEV_COR_TEST_DATABASE_PROJECT: undefined },
    { ...environment, DEV_COR_TEST_DATABASE_CONTAINER_ID: undefined },
    ...['', 'other-project', 'dev-cor', 'dev-cor-ui003;ignored'].map(
      (project) => ({ ...environment, DEV_COR_TEST_DATABASE_PROJECT: project }),
    ),
    ...['', 'c'.repeat(12), 'z'.repeat(64)].map((containerId) => ({
      ...environment,
      DEV_COR_TEST_DATABASE_CONTAINER_ID: containerId,
    })),
  ]) {
    assert.throws(() => capture(root, changed), /managed test instance/i);
  }
  for (const port of [15436, 55432]) {
    assert.throws(
      () =>
        capture(root, {
          ...environment,
          DEV_COR_TEST_DATABASE_URL: databaseUrl.replace(
            ':15433/',
            `:${port}/`,
          ),
        }),
      /isolated local test database/i,
    );
  }
});

test('capture validates the explicit instance against Docker metadata before execution', async (t) => {
  const root = repository(t);
  const { binding, container } = managedTestInstance();
  const environment = {
    DEV_COR_TEST_DATABASE_URL: databaseUrl.replace(':15433/', ':49123/'),
    DEV_COR_TEST_DATABASE_PROJECT: binding.project,
    DEV_COR_TEST_DATABASE_CONTAINER_ID: binding.containerId,
  };
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(
    resolve('node_modules/@playwright'),
    join(root, 'node_modules/@playwright'),
    'junction',
  );
  const original = await vi.importActual('node:child_process');
  const dockerCalls = [];
  vi.mocked(execFileSync).mockImplementation((command, args, options) => {
    if (command !== 'docker')
      return original.execFileSync(command, args, options);
    dockerCalls.push(args);
    if (args[0] === 'ps') return `${container.Id}\n`;
    assert.deepEqual(args, ['inspect', container.Id]);
    return JSON.stringify([container]);
  });
  t.onTestFinished(() =>
    vi.mocked(execFileSync).mockImplementation(original.execFileSync),
  );
  const captureActual = (overrides = {}) =>
    captureTestEnvironment(root, {
      inheritedEnvironment: { ...environment, ...overrides },
      pnpmVersion: '11.27.0',
    });
  const result = captureActual();
  assert.equal(
    result.childEnvironment.DATABASE_URL,
    environment.DEV_COR_TEST_DATABASE_URL,
  );
  assert.equal(
    result.childEnvironment.DEV_COR_TEST_DATABASE_CONTAINER_ID,
    binding.containerId,
  );
  assert.equal(dockerCalls.length, 2);
  assert.throws(
    () => captureActual({ DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-other' }),
    /test container/i,
  );
  assert.throws(
    () => captureActual({ DEV_COR_TEST_DATABASE_CONTAINER_ID: 'd'.repeat(64) }),
    /test container/i,
  );
  assert.throws(
    () =>
      captureActual({
        DEV_COR_TEST_DATABASE_URL: databaseUrl.replace(':15433/', ':49124/'),
      }),
    /published port/i,
  );
  assert.doesNotMatch(
    JSON.stringify({
      fingerprint: result.fingerprint,
      metadata: result.metadata,
    }),
    /local-test-password|dev-cor-ui003|49123/,
  );
});
