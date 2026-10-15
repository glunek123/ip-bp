import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  captureTestEnvironment,
  validateBrowserTestDatabaseUrl,
} from '../../scripts/test-environment.mjs';
const r2ContainerId =
  '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236';
function assertR2Target(value) {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error('The exact coordinated UI003 R2 target is required');
  }
  if (
    !['postgresql:', 'postgres:'].includes(target.protocol) ||
    target.hostname !== '127.0.0.1' ||
    target.port !== '15438' ||
    target.pathname !== '/dev_cor_test' ||
    target.search !== '' ||
    target.hash !== ''
  )
    throw new Error('The exact coordinated UI003 R2 target is required');
}
export async function assertNotaryWorkflowEnvironment() {
  // Recheck the full inherited tuple on every entry, before capture or loading
  // the database driver. A previous successful admission cannot authorize drift.
  if (
    process.env.NODE_ENV !== 'test' ||
    !process.env.DEV_COR_TEST_DATABASE_URL ||
    process.env.DEV_COR_TEST_DATABASE_PROJECT !== 'dev-cor-ui003-r2' ||
    process.env.DEV_COR_TEST_DATABASE_CONTAINER_ID !== r2ContainerId
  )
    throw new Error('The exact coordinated UI003 R2 instance is required');
  assertR2Target(process.env.DEV_COR_TEST_DATABASE_URL);
  if (process.env.DATABASE_URL !== undefined)
    assertR2Target(process.env.DATABASE_URL);
  const root = process.cwd();
  const environment = captureTestEnvironment(root, { pnpmVersion: '11.27.0' });
  const connectionString = environment.childEnvironment.DATABASE_URL;
  assertR2Target(connectionString);
  validateBrowserTestDatabaseUrl(connectionString, root);
  const requireBackend = createRequire(resolve(root, 'backend/package.json'));
  const { Client } = requireBackend('pg');
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const result = await client.query(
      'SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    );
    if (result.rows[0]?.count !== 155)
      throw new Error('The approved 155-migration UI003 baseline is required');
  } finally {
    await client.end();
  }
  return { connectionString, Client };
}
export async function notaryWorkflowActors() {
  await assertNotaryWorkflowEnvironment();
  // Existing coreLeadFixtures identities, verified against that source. Importing
  // its module would also construct legacy cleanup infrastructure. This support
  // neither loads that infrastructure nor creates/modifies these accounts.
  return {
    admittedCustomer: '50000000-0000-4000-8000-000000000002',
    holder: '60000000-0000-4000-8000-000000000001',
    tokenA: 'e2e-department-a',
    operatorUsername: 'core-lead-operator',
    operatorPassword: 'correct horse battery staple',
  };
}
export async function readNotaryWorkflowState(id) {
  const { connectionString, Client } = await assertNotaryWorkflowEnvironment();
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const result = await client.query(
      `SELECT m.stage, m.version,
      (SELECT count(*)::int FROM notary_matter_command_receipts r WHERE r.result_matter_id=m.id) AS commands,
      (SELECT count(*)::int FROM notary_matter_evidence e WHERE e.matter_id=m.id) AS evidence,
      (SELECT count(*)::int FROM notary_matter_opening o WHERE o.matter_id=m.id) AS opening,
      (SELECT count(*)::int FROM notary_opening_review_decisions d WHERE d.matter_id=m.id) AS reviews,
      (SELECT count(*)::int FROM notary_certificates c WHERE c.matter_id=m.id) AS certificates
      FROM notary_matters m WHERE m.id=$1`,
      [id],
    );
    if (result.rows.length !== 1)
      throw new Error('Expected the exact synthetic notary matter');
    return result.rows[0];
  } finally {
    await client.end();
  }
}
