import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import {
  admitFreshClosureInstance,
  assertMigrationManifest,
  migrationManifest,
} from './closure-acceptance-preflight.mjs';

test('manifest rejects linked directory entries before filtering them', () => {
  const temporaryRoot = resolve(tmpdir());
  const root = mkdtempSync(join(temporaryRoot, 'closure-acceptance-test-'));
  try {
    const directory = join(root, 'backend/prisma/migrations');
    const first = join(directory, '20261029000000_first');
    mkdirSync(first, { recursive: true });
    writeFileSync(join(first, 'migration.sql'), 'SELECT 1;');
    assert.equal(migrationManifest(root).migrations.length, 1);
    const target = join(root, 'linked-source');
    mkdirSync(target);
    writeFileSync(join(target, 'migration.sql'), 'SELECT 2;');
    symlinkSync(
      target,
      join(directory, '20261029000001_linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    assert.throws(() => migrationManifest(root), /preflight rejected/u);
  } finally {
    const withinTemporaryRoot = relative(temporaryRoot, root);
    assert.ok(
      withinTemporaryRoot &&
        !withinTemporaryRoot.startsWith('..') &&
        !isAbsolute(withinTemporaryRoot),
    );
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const project = 'dev-cor-closure-acceptance-unit';
  const containerId = 'a'.repeat(64);
  const networkId = 'b'.repeat(64);
  const image =
    'sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0';
  const labels = {
    'com.docker.compose.project': project,
    'com.docker.compose.service': 'postgres-test',
    'com.docker.compose.container-number': '1',
  };
  return {
    binding: { project, containerId, networkId, port: 15447 },
    before: { projects: [], containerIds: [], volumeNames: [], networkIds: [] },
    containers: [
      {
        Id: containerId,
        Name: `/${project}-postgres-test-1`,
        Image: image,
        Config: {
          Labels: labels,
          Image: `postgres:17.11-bookworm@${image}`,
          Env: ['POSTGRES_USER=dev_cor_test', 'POSTGRES_DB=dev_cor_test'],
        },
        State: { Running: true, Health: { Status: 'healthy' } },
        HostConfig: {},
        Mounts: [
          {
            Type: 'volume',
            Name: `${project}-pgdata`,
            Destination: '/var/lib/postgresql/data',
            RW: true,
          },
        ],
        NetworkSettings: {
          Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '15447' }] },
          Networks: { default: { NetworkID: networkId } },
        },
      },
    ],
    volumes: [{ Name: `${project}-pgdata`, Labels: labels }],
    networks: [{ Id: networkId, Name: `${project}_default`, Labels: labels }],
  };
}

test('offline admission returns only exact cleanup identities', () => {
  const input = fixture();
  assert.deepEqual(admitFreshClosureInstance(input), {
    containerId: input.binding.containerId,
    volumeName: `${input.binding.project}-pgdata`,
    networkId: input.binding.networkId,
  });
});

const failures = {
  'existing project': (x) => x.before.projects.push(x.binding.project),
  'existing container': (x) =>
    x.before.containerIds.push(x.binding.containerId),
  'existing volume': (x) =>
    x.before.volumeNames.push(`${x.binding.project}-pgdata`),
  'existing network': (x) => x.before.networkIds.push(x.binding.networkId),
  'shared project': (x) => {
    x.binding.project = 'dev-cor';
  },
  'shared port': (x) => {
    x.binding.port = 15433;
  },
  'wrong full container ID': (x) => {
    x.binding.containerId = 'c'.repeat(64);
  },
  'wrong compose labels': (x) => {
    x.containers[0].Config.Labels = {};
  },
  'public binding': (x) => {
    x.containers[0].NetworkSettings.Ports['5432/tcp'][0].HostIp = '0.0.0.0';
  },
  'extra binding': (x) =>
    x.containers[0].NetworkSettings.Ports['5432/tcp'].push({
      HostIp: '127.0.0.1',
      HostPort: '15448',
    }),
  'wrong database': (x) => {
    x.containers[0].Config.Env = [
      'POSTGRES_USER=dev_cor_test',
      'POSTGRES_DB=other',
    ];
  },
  'wrong account': (x) => {
    x.containers[0].Config.Env = [
      'POSTGRES_USER=other',
      'POSTGRES_DB=dev_cor_test',
    ];
  },
  'wrong image': (x) => {
    x.containers[0].Image = 'other';
  },
  'wrong image reference': (x) => {
    x.containers[0].Config.Image = 'postgres:latest';
  },
  unhealthy: (x) => {
    x.containers[0].State.Health.Status = 'starting';
  },
  'extra mount': (x) => x.containers[0].Mounts.push({ Type: 'bind' }),
  'wrong volume labels': (x) => {
    x.volumes[0].Labels = {};
  },
  'wrong network ID': (x) => {
    x.networks[0].Id = 'c'.repeat(64);
  },
};
for (const [name, mutate] of Object.entries(failures)) {
  test(`rejects ${name}`, () => {
    const input = fixture();
    mutate(input);
    assert.throws(() => admitFreshClosureInstance(input));
  });
}

test('manifest comparison rejects ordering, content, additions and removals', () => {
  assert.throws(() => assertMigrationManifest(undefined, undefined));
  assert.throws(() => assertMigrationManifest({}, {}));
  const expected = {
    migrations: [
      { name: 'a', sha256: 'one' },
      { name: 'b', sha256: 'two' },
    ],
    sha256: 'aggregate',
  };
  assert.doesNotThrow(() =>
    assertMigrationManifest(expected, globalThis.structuredClone(expected)),
  );
  for (const mutate of [
    (x) => x.migrations.reverse(),
    (x) => {
      x.migrations[0].sha256 = 'changed';
    },
    (x) => x.migrations.pop(),
    (x) => x.migrations.push({ name: 'c', sha256: 'three' }),
    (x) => {
      x.sha256 = 'changed';
    },
  ]) {
    const actual = globalThis.structuredClone(expected);
    mutate(actual);
    assert.throws(() => assertMigrationManifest(expected, actual));
  }
});
