import { isAbsolute, resolve } from 'node:path';

const pinnedPostgresImage =
  'sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0';
const pinnedPostgresReference = `postgres:17.11-bookworm@${pinnedPostgresImage}`;
const originalR2 = Object.freeze({
  project: 'dev-cor-ui003-r2',
  containerId:
    '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
  port: 15438,
  volume: 'dev-cor-ui003-r2-pgdata',
});
const backendOrigin = 'http://127.0.0.1:3101';
const frontendOrigin = 'http://127.0.0.1:5174';

// A layout describes one browser session. It does not start a server, connect to
// the database, or claim that authentication and authorization have passed.
export function planManagedTestRuntime({
  root,
  cwd,
  mode,
  origin,
  baseURL,
  apiProxyTarget,
  webServer,
}) {
  if (!isAbsolute(root) || !isAbsolute(cwd) || resolve(cwd) !== resolve(root)) {
    throw new Error(
      'The managed test runtime requires the absolute project cwd',
    );
  }
  if (mode !== 'api' && mode !== 'ui') {
    throw new Error('The managed test runtime mode must be api or ui');
  }
  const expectedOrigin = mode === 'api' ? backendOrigin : frontendOrigin;
  if (origin !== expectedOrigin || baseURL !== expectedOrigin) {
    throw new Error(
      `The ${mode} test must use ${expectedOrigin} for Origin and baseURL`,
    );
  }
  if (mode === 'ui' && apiProxyTarget !== backendOrigin) {
    throw new Error('The UI test must proxy /api to the isolated backend');
  }
  const expectedServers =
    mode === 'api'
      ? [{ url: `${backendOrigin}/api/v1/health`, cwd: resolve(root) }]
      : [
          { url: `${backendOrigin}/api/v1/health`, cwd: resolve(root) },
          { url: frontendOrigin, cwd: resolve(root) },
        ];
  if (
    !Array.isArray(webServer) ||
    webServer.length !== expectedServers.length
  ) {
    throw new Error(
      'The managed test runtime has an unexpected webServer layout',
    );
  }
  for (const [index, server] of webServer.entries()) {
    const expected = expectedServers[index];
    if (
      server?.url !== expected.url ||
      server?.cwd !== expected.cwd ||
      server?.reuseExistingServer !== false ||
      !isAbsolute(server.cwd)
    ) {
      throw new Error(
        'The managed test runtime has an unsafe webServer configuration',
      );
    }
  }
  return Object.freeze({
    cwd: resolve(root),
    mode,
    origin: expectedOrigin,
    baseURL: expectedOrigin,
  });
}

// The stopped-container case cannot pass captureTestEnvironment: that function
// correctly requires a running, healthy container. Verify the exact preexisting
// Compose instance before a controlled `docker start` of its full ID.
export function admitStoppedTestContainer({ target, binding, container }) {
  const project = binding?.project;
  const containerId = binding?.containerId;
  if (
    project !== originalR2.project ||
    containerId !== originalR2.containerId
  ) {
    throw new Error(
      'The original R2 project and full container ID are required',
    );
  }
  if (
    target?.hostname !== '127.0.0.1' ||
    target?.username !== 'dev_cor_test' ||
    target?.database !== 'dev_cor_test' ||
    target?.port !== originalR2.port
  ) {
    throw new Error('The target must be the isolated local test database');
  }
  const labels = container?.Config?.Labels ?? {};
  const published = container?.HostConfig?.PortBindings?.['5432/tcp'];
  const active = container?.NetworkSettings?.Ports?.['5432/tcp'];
  const dataMounts = (container?.Mounts ?? []).filter(
    (mount) => mount.Destination === '/var/lib/postgresql/data',
  );
  const environment = new Set(container?.Config?.Env ?? []);
  if (
    container?.Id !== containerId ||
    container?.Name !== `/${project}-postgres-test-1` ||
    labels['com.docker.compose.project'] !== project ||
    labels['com.docker.compose.service'] !== 'postgres-test' ||
    labels['com.docker.compose.container-number'] !== '1' ||
    container?.Image !== pinnedPostgresImage ||
    container?.Config?.Image !== pinnedPostgresReference ||
    !environment.has('POSTGRES_USER=dev_cor_test') ||
    !environment.has('POSTGRES_DB=dev_cor_test') ||
    !Array.isArray(published) ||
    published.length !== 1 ||
    published[0].HostIp !== '127.0.0.1' ||
    Number(published[0].HostPort) !== target.port ||
    (active !== null &&
      active !== undefined &&
      (!Array.isArray(active) || active.length !== 0)) ||
    dataMounts.length !== 1 ||
    dataMounts[0].Type !== 'volume' ||
    dataMounts[0].Name !== originalR2.volume ||
    dataMounts[0].RW !== true ||
    Object.keys(container?.HostConfig?.Tmpfs ?? {}).length !== 0 ||
    container?.State?.Running !== false
  ) {
    throw new Error(
      'The stopped container does not match the exact managed test instance',
    );
  }
  return Object.freeze({
    containerId,
    project,
    port: target.port,
    volume: dataMounts[0].Name,
  });
}

// A stopped container cannot produce formal environment evidence. The sole
// runner must acquire its existing shared lock, re-inspect/admit inside that
// lock, then execute this exact command and wait for a real healthy capture.
export function planStoppedTestContainerStart(input) {
  const admitted = admitStoppedTestContainer(input);
  return Object.freeze({
    command: 'docker',
    args: Object.freeze(['start', admitted.containerId]),
    requiresE2eResourceLock: true,
    requiresHealthyCapture: true,
    containerId: admitted.containerId,
  });
}
