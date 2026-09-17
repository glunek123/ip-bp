import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.loadEnvFile(resolve(root, 'backend/.env.test'));
if (process.env.NODE_ENV !== 'test')
  throw new Error('E2E requires NODE_ENV=test');
const database = new URL(process.env.DATABASE_URL);
if (
  database.hostname !== '127.0.0.1' ||
  database.port !== '55433' ||
  database.pathname !== '/dev_cor_test'
) {
  throw new Error('E2E requires the isolated local test database');
}
process.env.API_PROXY_TARGET = 'http://127.0.0.1:3101';
process.env.E2E_IDENTITY_FIXTURES = JSON.stringify({
  'e2e-department-a': {
    userId: '20000000-0000-4000-8000-000000000001',
    departmentId: '10000000-0000-4000-8000-000000000001',
    authorizationRevision: 1,
  },
  'e2e-department-b': {
    userId: '20000000-0000-4000-8000-000000000002',
    departmentId: '10000000-0000-4000-8000-000000000002',
    authorizationRevision: 1,
  },
});
const result = spawnSync(
  process.execPath,
  [
    resolve(root, 'node_modules/@playwright/test/cli.js'),
    'test',
    ...process.argv.slice(2),
  ],
  { cwd: root, stdio: 'inherit', env: process.env },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
