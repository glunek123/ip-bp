import { test } from 'vitest';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  admitStoppedTestContainer,
  planManagedTestRuntime,
  planStoppedTestContainerStart,
} from './managed-test-runtime.mjs';

const root = resolve('C:/repo');
const backend = 'http://127.0.0.1:3101';
const frontend = 'http://127.0.0.1:5174';
const webServer = [
  { cwd: root, url: `${backend}/api/v1/health`, reuseExistingServer: false },
  { cwd: root, url: frontend, reuseExistingServer: false },
];
const ui = {
  root,
  cwd: root,
  mode: 'ui',
  origin: frontend,
  baseURL: frontend,
  apiProxyTarget: backend,
  webServer,
};

test('makes API and UI origins, absolute cwd, and explicit server ownership checkable', () => {
  assert.deepEqual(planManagedTestRuntime(ui), {
    cwd: root,
    mode: 'ui',
    origin: frontend,
    baseURL: frontend,
  });
  assert.deepEqual(
    planManagedTestRuntime({
      root,
      cwd: root,
      mode: 'api',
      origin: backend,
      baseURL: backend,
      webServer: [webServer[0]],
    }),
    { cwd: root, mode: 'api', origin: backend, baseURL: backend },
  );
  for (const change of [
    { cwd: '.' },
    { origin: backend },
    { baseURL: backend },
    { apiProxyTarget: frontend },
    {
      webServer: [{ ...webServer[0], reuseExistingServer: true }, webServer[1]],
    },
    {
      webServer: [webServer[0], { ...webServer[1], cwd: resolve('C:/other') }],
    },
  ]) {
    assert.throws(() => planManagedTestRuntime({ ...ui, ...change }));
  }
});

const containerId =
  '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236';
const binding = { project: 'dev-cor-ui003-r2', containerId };
const target = {
  hostname: '127.0.0.1',
  username: 'dev_cor_test',
  database: 'dev_cor_test',
  port: 15438,
};
const container = {
  Id: containerId,
  Name: '/dev-cor-ui003-r2-postgres-test-1',
  Image:
    'sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0',
  Config: {
    Image:
      'postgres:17.11-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0',
    Labels: {
      'com.docker.compose.project': binding.project,
      'com.docker.compose.service': 'postgres-test',
      'com.docker.compose.container-number': '1',
    },
    Env: ['POSTGRES_USER=dev_cor_test', 'POSTGRES_DB=dev_cor_test'],
  },
  HostConfig: {
    PortBindings: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '15438' }] },
    Tmpfs: {},
  },
  NetworkSettings: { Ports: { '5432/tcp': null } },
  Mounts: [
    {
      Destination: '/var/lib/postgresql/data',
      Type: 'volume',
      Name: 'dev-cor-ui003-r2-pgdata',
      RW: true,
    },
  ],
  State: { Running: false, Health: { Status: 'unhealthy' } },
};

test('stopped admission uses retained host binding and returns only a start intent', () => {
  assert.deepEqual(admitStoppedTestContainer({ target, binding, container }), {
    containerId,
    project: binding.project,
    port: 15438,
    volume: 'dev-cor-ui003-r2-pgdata',
  });
  assert.deepEqual(
    planStoppedTestContainerStart({ target, binding, container }),
    {
      command: 'docker',
      args: ['start', containerId],
      containerId,
      requiresE2eResourceLock: true,
      requiresHealthyCapture: true,
    },
  );
});

test('stopped admission rejects mismatched identity, unsafe binding, image, and ephemeral data', () => {
  const mutate = (fn) => {
    const changed = globalThis.structuredClone(container);
    fn(changed);
    assert.throws(() =>
      planStoppedTestContainerStart({ target, binding, container: changed }),
    );
  };
  mutate((value) => {
    value.Id = 'e'.repeat(64);
  });
  mutate((value) => {
    value.Config.Labels['com.docker.compose.project'] = 'dev-cor-other';
  });
  mutate((value) => {
    value.HostConfig.PortBindings['5432/tcp'][0].HostIp = '0.0.0.0';
  });
  mutate((value) => {
    value.HostConfig.PortBindings['5432/tcp'].push({
      HostIp: '127.0.0.1',
      HostPort: '15437',
    });
  });
  mutate((value) => {
    value.Image = 'sha256:' + 'e'.repeat(64);
  });
  mutate((value) => {
    value.Config.Image = 'postgres:latest';
  });
  mutate((value) => {
    value.Mounts[0].Type = 'tmpfs';
  });
  mutate((value) => {
    value.Mounts[0].Name = 'other-data';
  });
  mutate((value) => {
    value.HostConfig.Tmpfs['/var/lib/postgresql/data'] = 'rw';
  });
  mutate((value) => {
    value.State.Running = true;
  });
  assert.throws(() =>
    admitStoppedTestContainer({
      target: { ...target, port: 15437 },
      binding,
      container,
    }),
  );
  assert.throws(() =>
    admitStoppedTestContainer({
      target,
      binding: {
        project: 'dev-cor-ui003',
        containerId:
          'dbb1cbd29c6d65b5aa4fd85317c96167fbd94310c34946edc033fc4f2f9d3695',
      },
      container,
    }),
  );
});
