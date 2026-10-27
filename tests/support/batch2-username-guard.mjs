import { execFileSync } from 'node:child_process';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const project = 'dev-cor-ops-batch2-20261027';
const host = '127.0.0.1';
const port = '15440';
const database = 'dev_cor_test';
const user = 'dev_cor_test';

export function assertBatch2UsernameTarget() {
  const env = process.env;
  if (env.NODE_ENV !== 'test' || env.DEV_COR_OPS_BATCH2_READY !== '1')
    throw new Error('Batch2 username test environment is not READY');
  if (env.DEV_COR_TEST_DATABASE_PROJECT !== project)
    throw new Error('Batch2 username project identity differs');
  const id = env.DEV_COR_TEST_DATABASE_CONTAINER_ID;
  if (!/^[a-f0-9]{64}$/u.test(id ?? ''))
    throw new Error('Batch2 username requires the full container ID');
  const configured = env.DEV_COR_TEST_DATABASE_URL;
  const effective = env.DATABASE_URL;
  if (!configured || !effective || configured !== effective)
    throw new Error('Batch2 username requires the captured test URL');
  validateIsolatedTestDatabaseUrl(effective, { allowRandomPort: true });
  const target = new URL(effective);
  if (
    target.protocol !== 'postgresql:' ||
    target.hostname !== host ||
    target.port !== port ||
    target.pathname !== `/${database}` ||
    decodeURIComponent(target.username) !== user
  )
    throw new Error('Batch2 username database endpoint differs');

  const containers = JSON.parse(
    execFileSync('docker', ['inspect', id], { encoding: 'utf8' }),
  );
  const container = containers[0];
  const labels = container?.Config?.Labels ?? {};
  const binding = container?.NetworkSettings?.Ports?.['5432/tcp'];
  if (
    container?.Id !== id ||
    container?.State?.Running !== true ||
    labels['com.docker.compose.project'] !== project ||
    labels['com.docker.compose.service'] !== 'postgres-test' ||
    !container?.Config?.Env?.includes(`POSTGRES_DB=${database}`) ||
    !container?.Config?.Env?.includes(`POSTGRES_USER=${user}`) ||
    !Array.isArray(binding) ||
    binding.length !== 1 ||
    binding[0].HostIp !== host ||
    binding[0].HostPort !== port
  )
    throw new Error('Batch2 username running container identity differs');
  return effective;
}
