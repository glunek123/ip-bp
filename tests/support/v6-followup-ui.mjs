import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';
import {
  coreLeadFixtures,
  seedCoreLeadE2eData,
  disconnectCoreLeadTestDatabase,
} from './core-lead-database.mjs';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const approvedProject = 'dev-cor-v6-followups-20261026';
const finalMigration = '20261026150000_v6_fee_cancellation';
const cutover = readFileSync(
  resolve(
    root,
    'docs/superpowers/plans/2026-10-26-v6-numbering-cutover.draft.sql',
  ),
  'utf8',
);

function assert(value, message) {
  if (!value) throw new Error(message);
}

function assertFreshTarget() {
  assert(process.env.NODE_ENV === 'test', 'Follow-up UI requires test mode');
  validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL, {
    allowRandomPort: true,
  });
  const url = new URL(process.env.DATABASE_URL);
  assert(
    url.hostname === '127.0.0.1' &&
      url.port === '15440' &&
      url.pathname === '/dev_cor_test',
    'Follow-up UI database URL is not approved',
  );
  assert(
    process.env.DEV_COR_TEST_DATABASE_PROJECT === approvedProject &&
      /^[a-f0-9]{64}$/u.test(
        process.env.DEV_COR_TEST_DATABASE_CONTAINER_ID ?? '',
      ),
    'Follow-up UI container identity is not bound',
  );
  assert(
    resolve(process.env.PRIVATE_FILE_ROOT ?? '') ===
      resolve(root, '.local/private-files/test'),
    'Follow-up UI private files are outside this candidate',
  );
  assert(
    root
      .replaceAll('\\', '/')
      .endsWith('/.local/v6-followups-20261026/candidate'),
    'Follow-up UI must run from the isolated candidate',
  );
}

async function assertEmptyApplication(client) {
  const names = (
    await client.query(`SELECT tablename FROM pg_tables
    WHERE schemaname='public' ORDER BY tablename`)
  ).rows.map((row) => row.tablename);
  for (const name of names) {
    if (
      name === '_prisma_migrations' ||
      name === 'customer_business_number_counters'
    )
      continue;
    assert(/^[a-z][a-z0-9_]*$/u.test(name), 'Unreviewed public table name');
    const count = (
      await client.query(`SELECT count(*)::int AS count
      FROM "public"."${name}"`)
    ).rows[0].count;
    assert(count === 0, `Fresh public database contains rows in ${name}`);
  }
}

export async function prepareV6FollowupUi() {
  assertFreshTarget();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let disconnectSeed = null;
  try {
    const identity = (
      await client.query(`SELECT current_database() AS db,
      current_schema() AS schema, inet_server_port() AS port`)
    ).rows[0];
    assert(
      identity.db === 'dev_cor_test' &&
        identity.schema === 'public' &&
        identity.port === 5432,
      'Connected public database identity changed',
    );
    const migrations = (
      await client.query(`SELECT migration_name, finished_at,
      rolled_back_at FROM _prisma_migrations ORDER BY migration_name`)
    ).rows;
    const expected = readdirSync(resolve(root, 'backend/prisma/migrations'), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert(
      expected.length === 184 &&
        expected.at(-1) === finalMigration &&
        migrations.length === expected.length &&
        migrations.every(
          (entry, index) =>
            entry.migration_name === expected[index] &&
            entry.finished_at !== null &&
            entry.rolled_back_at === null,
        ),
      'Follow-up UI requires the exact successful public 184 ledger',
    );
    const counter = (
      await client.query(`SELECT last_value FROM
      customer_business_number_counters WHERE singleton_id=1`)
    ).rows;
    assert(
      counter.length === 1 && counter[0].last_value === '-1',
      'Follow-up UI customer number cutover already occurred',
    );
    await assertEmptyApplication(client);
    disconnectSeed = disconnectCoreLeadTestDatabase;
    await seedCoreLeadE2eData();
    await client.query(cutover);
    const switched = (
      await client.query(`SELECT last_value FROM
      customer_business_number_counters WHERE singleton_id=1`)
    ).rows[0].last_value;
    assert(Number(switched) >= 4, 'Customer number cutover did not finish');
    const businessId = (
      await client.query(
        `SELECT business_id FROM customers
      WHERE id=$1`,
        [coreLeadFixtures.admittedCustomer],
      )
    ).rows[0]?.business_id;
    assert(
      typeof businessId === 'string' && businessId.length >= 3,
      'Admitted synthetic customer has no post-cutover business ID',
    );
    const courtId = randomUUID();
    const courtName = 'V6 合成测试法院';
    await client.query(
      `INSERT INTO filing_courts(id, department_id, name)
      VALUES($1,$2,$3)`,
      [courtId, coreLeadFixtures.departmentA, courtName],
    );
    const grants = [
      ['customer.account.create', 'DEPARTMENT'],
      ['customer.agreement.read', 'DEPARTMENT'],
      ['customer.agreement.edit', 'DEPARTMENT'],
      ['case.external-entry.create', 'TEAM'],
      ['case.external-entry.archive', 'TEAM'],
      ['case.archive', 'TEAM'],
      ['case.export', 'DEPARTMENT'],
      ['fee.read', 'DEPARTMENT'],
      ['fee.create', 'DEPARTMENT'],
      ['fee.update', 'DEPARTMENT'],
      ['fee.delete', 'DEPARTMENT'],
      ['settlement.read', 'DEPARTMENT'],
      ['report.amount.read', 'DEPARTMENT'],
    ];
    for (const [action, scope] of grants) {
      await client.query(
        `INSERT INTO role_grants(id,role_template_id,action,scope)
        VALUES($1,$2,$3::permission_action,$4::permission_scope)
        ON CONFLICT (role_template_id,action,scope) DO NOTHING`,
        [randomUUID(), coreLeadFixtures.roleA, action, scope],
      );
    }
    return {
      departmentId: coreLeadFixtures.departmentA,
      customerId: coreLeadFixtures.admittedCustomer,
      rightsHolderId: coreLeadFixtures.holder,
      customerBusinessId: businessId,
      courtId,
      courtName,
      username: coreLeadFixtures.operatorUsername,
      password: coreLeadFixtures.operatorPassword,
      disconnect: disconnectCoreLeadTestDatabase,
    };
  } catch (error) {
    await disconnectSeed?.();
    throw error;
  } finally {
    await client.end();
  }
}
