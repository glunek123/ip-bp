import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  runClosedAcceptance,
  emptyDatabaseProbe,
  guardCatalogProbe,
  closedPaymentProbe,
} from './closure-acceptance-executor.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
function setup() {
  const project = 'dev-cor-closure-acceptance-mock';
  const containerId = 'a'.repeat(64),
    networkId = 'b'.repeat(64);
  const image =
    'sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0';
  const source = Buffer.from('BEGIN; SELECT 1; COMMIT;');
  const migrations = [{ name: '20261029000000_mock', sha256: digest(source) }];
  const catalog = [{ enabled: 'O', definition: 'mock guard definition' }];
  const input = {
    project,
    port: 15447,
    candidate: {
      treeHash: 'c'.repeat(40),
      manifest: { migrations, sha256: digest(JSON.stringify(migrations)) },
      guardCatalogHash: digest(JSON.stringify(catalog)),
    },
  };
  const events = [];
  let runId;
  const secretPath = resolve('synthetic-secret-file');
  let snapshot;
  const emptyInventory = () => ({
    projects: [],
    ports: [],
    containerIds: [],
    volumeNames: [],
    networkIds: [],
  });
  const adapter = {
    reviewedSecretFileLifecycle: true,
    async acquireSharedLock() {
      events.push('lock');
      return { release: async () => events.push('unlock') };
    },
    async captureCandidate() {
      events.push('candidate');
      return globalThis.structuredClone(input.candidate);
    },
    async inventory() {
      events.push('inventory');
      return emptyInventory();
    },
    async createSecretFile(options) {
      events.push('secret');
      runId = options.runId;
      assert.match(options.password.toString(), /^[A-Za-z0-9_-]{43}$/u);
      return { path: secretPath, permissionVerified: true };
    },
    async createVolume() {
      events.push('create-volume');
      return `${project}-pgdata`;
    },
    async createNetwork() {
      events.push('create-network');
      return networkId;
    },
    async createContainer(options) {
      events.push('create-container');
      assert.equal(options.host, '127.0.0.1');
      assert.equal(options.passwordFile, secretPath);
      const labels = {
        'com.docker.compose.project': project,
        'com.docker.compose.service': 'postgres-test',
        'com.docker.compose.container-number': '1',
        'dev-cor.closure-acceptance.run': runId,
      };
      const ports = {
        '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '15447' }],
      };
      snapshot = {
        containers: [
          {
            Id: containerId,
            Name: `/${project}-postgres-test-1`,
            Image: image,
            Config: {
              Labels: labels,
              Image: `postgres:17.11-bookworm@${image}`,
              Env: [
                'POSTGRES_USER=dev_cor_test',
                'POSTGRES_DB=dev_cor_test',
                'POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password',
              ],
            },
            State: { Running: true, Health: { Status: 'healthy' } },
            HostConfig: { PortBindings: ports },
            Mounts: [
              {
                Type: 'volume',
                Name: `${project}-pgdata`,
                Destination: '/var/lib/postgresql/data',
                RW: true,
              },
              {
                Type: 'bind',
                Source: secretPath,
                Destination: '/run/secrets/postgres-password',
                RW: false,
              },
            ],
            NetworkSettings: {
              Ports: ports,
              Networks: { default: { NetworkID: networkId } },
            },
          },
        ],
        volumes: [{ Name: `${project}-pgdata`, Labels: labels }],
        networks: [
          { Id: networkId, Name: `${project}_default`, Labels: labels },
        ],
      };
      return containerId;
    },
    async waitHealthy(value) {
      assert.equal(value, containerId);
      events.push('healthy');
    },
    async inspectCreated() {
      events.push('inspect');
      return snapshot;
    },
    async query(value, sql) {
      assert.equal(value, containerId);
      events.push('query');
      if (sql === emptyDatabaseProbe)
        return {
          database: 'dev_cor_test',
          username: 'dev_cor_test',
          replication_role: 'origin',
          application_objects: 0,
        };
      assert.equal(sql, guardCatalogProbe);
      return catalog;
    },
    async readMigration(name) {
      assert.equal(name, migrations[0].name);
      events.push('read');
      return source;
    },
    async executeSql(value, sql) {
      assert.equal(value, containerId);
      events.push(sql === closedPaymentProbe ? 'negative-probe' : 'migration');
    },
    async removeContainer(value) {
      assert.equal(value, containerId);
      events.push('remove-container');
    },
    async removeVolume(value) {
      assert.equal(value, `${project}-pgdata`);
      events.push('remove-volume');
    },
    async removeNetwork(value) {
      assert.equal(value, networkId);
      events.push('remove-network');
    },
    async removeSecretFile() {
      events.push('remove-secret');
    },
  };
  return { input, adapter, events, snapshot: () => snapshot };
}

test('no reviewed adapter means no action', async () => {
  assert.equal(
    (await runClosedAcceptance({}, undefined)).status,
    'BLOCKED_ADAPTER_NOT_REVIEWED',
  );
});

test('secret write followed by adapter failure reports possible residual file', async () => {
  const x = setup();
  let syntheticFileWritten = false;
  let passwordBuffer;
  x.adapter.createSecretFile = async ({ password }) => {
    syntheticFileWritten = true;
    passwordBuffer = password;
    throw Error('private file path and password must not escape');
  };
  const report = await runClosedAcceptance(x.input, x.adapter);
  assert.equal(syntheticFileWritten, true);
  assert.equal(report.status, 'STOPPED');
  assert.equal(report.cleanup, 'RETAINED_UNCONFIRMED_RESOURCES');
  assert.deepEqual(report.unconfirmedCreations, ['secret']);
  assert.deepEqual(report.resources, {});
  assert.ok(passwordBuffer.every((byte) => byte === 0));
  assert.ok(!x.events.includes('create-volume'));
  assert.ok(!x.events.includes('remove-secret'));
  assert.equal(x.events.at(-1), 'unlock');
  assert.doesNotMatch(JSON.stringify(report), /private file path|password/u);
});

test('unknown container creation outcome preserves secret and records unresolved ownership', async () => {
  const x = setup();
  x.adapter.createContainer = async () => {
    throw Error('private adapter error');
  };
  const report = await runClosedAcceptance(x.input, x.adapter);
  assert.equal(report.status, 'STOPPED');
  assert.equal(report.cleanup, 'RETAINED_UNCONFIRMED_RESOURCES');
  assert.deepEqual(report.unconfirmedCreations, ['container']);
  assert.ok(!x.events.includes('remove-secret'));
  assert.ok(!x.events.includes('remove-volume'));
});

test('manifest source mentioning trigger bypass stops before SQL execution', async () => {
  const x = setup();
  const source = Buffer.from('ALTER TABLE example DISABLE TRIGGER ALL;');
  x.input.candidate.manifest.migrations[0].sha256 = digest(source);
  x.input.candidate.manifest.sha256 = digest(
    JSON.stringify(x.input.candidate.manifest.migrations),
  );
  x.adapter.readMigration = async () => source;
  const report = await runClosedAcceptance(x.input, x.adapter);
  assert.equal(report.status, 'STOPPED');
  assert.ok(!x.events.includes('migration'));
  assert.ok(!x.events.includes('negative-probe'));
});

test('closed-only sequence locks, rechecks, probes, and removes exact created identities', async () => {
  const { input, adapter, events } = setup();
  const report = await runClosedAcceptance(input, adapter);
  assert.equal(report.status, 'CLOSED_MIGRATIONS_AND_GUARD_PROBES_PASSED');
  assert.equal(report.positiveWrites, 'BLOCKED');
  assert.equal(report.cleanup, 'EXACT_CREATED_IDENTITIES_REMOVED');
  assert.equal(events[0], 'lock');
  assert.equal(events.at(-1), 'unlock');
  assert.ok(events.indexOf('inspect') < events.indexOf('query'));
  assert.ok(events.indexOf('migration') < events.indexOf('negative-probe'));
  assert.deepEqual(events.slice(-6), [
    'remove-container',
    'remove-volume',
    'remove-network',
    'inventory',
    'remove-secret',
    'unlock',
  ]);
  assert.doesNotMatch(
    JSON.stringify(report),
    /password|synthetic-secret-file/u,
  );
});

for (const collision of ['project', 'port', 'volume']) {
  test(`preexisting ${collision} stops before secret or creation`, async () => {
    const { input, adapter, events } = setup();
    adapter.inventory = async () => ({
      projects: collision === 'project' ? [input.project] : [],
      ports: collision === 'port' ? [input.port] : [],
      volumeNames: collision === 'volume' ? [`${input.project}-pgdata`] : [],
      containerIds: [],
      networkIds: [],
    });
    assert.equal((await runClosedAcceptance(input, adapter)).status, 'STOPPED');
    assert.ok(!events.includes('secret'));
    assert.equal(events.at(-1), 'unlock');
  });
}

for (const failure of [
  'permissions',
  'identity',
  'mount',
  'nonempty',
  'source-drift',
  'catalog',
  'probe',
  'cleanup',
]) {
  test(`stops and reports safely on ${failure}`, async () => {
    const x = setup();
    if (failure === 'permissions')
      x.adapter.createSecretFile = async () => ({
        path: resolve('private'),
        permissionVerified: false,
      });
    if (failure === 'identity' || failure === 'mount') {
      const original = x.adapter.inspectCreated;
      x.adapter.inspectCreated = async () => {
        const value = await original();
        if (failure === 'identity') value.containers[0].Config.Labels = {};
        else
          value.containers[0].Mounts.push({ Type: 'bind', Source: '/other' });
        return value;
      };
    }
    if (failure === 'nonempty' || failure === 'catalog') {
      const original = x.adapter.query;
      x.adapter.query = async (binding, sql) => {
        if (failure === 'catalog' && sql === guardCatalogProbe)
          return [{ enabled: 'D' }];
        const result = await original(binding, sql);
        return failure === 'nonempty' && sql === emptyDatabaseProbe
          ? { ...result, application_objects: 1 }
          : result;
      };
    }
    if (failure === 'source-drift')
      x.adapter.readMigration = async () => Buffer.from('changed');
    if (failure === 'probe')
      x.adapter.executeSql = async (_, sql) => {
        if (sql === closedPaymentProbe) throw Error('SECRET sentinel');
      };
    if (failure === 'cleanup')
      x.adapter.removeContainer = async () => {
        throw Error('SECRET sentinel');
      };
    const report = await runClosedAcceptance(x.input, x.adapter);
    assert.equal(report.status, 'STOPPED');
    assert.equal(report.positiveWrites, 'BLOCKED');
    assert.doesNotMatch(
      JSON.stringify(report),
      /SECRET sentinel|private|password/u,
    );
    if (failure !== 'permissions')
      assert.equal(report.cleanup, 'RETAINED_FOR_REVIEW');
    assert.ok(!x.events.includes('remove-volume'));
    assert.equal(x.events.at(-1), 'unlock');
  });
}
