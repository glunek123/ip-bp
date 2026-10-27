import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';
import { coreLeadFixtures } from './core-lead-database.mjs';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const project = 'dev-cor-v6-followups-20261026';
const containerId =
  '1f4f7afdca4226d5e93cb546c1618751d27f5a7792744ed90708e287165e2a09';
const finalMigration = '20261026150000_v6_fee_cancellation';

function insist(condition, message) {
  if (!condition) throw new Error(message);
}

function assertBoundEnvironment() {
  insist(
    process.env.NODE_ENV === 'test',
    'Customer permissions UI requires test mode',
  );
  validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL, {
    allowRandomPort: true,
  });
  const url = new URL(process.env.DATABASE_URL);
  insist(
    url.hostname === '127.0.0.1' &&
      url.port === '15440' &&
      url.pathname === '/dev_cor_test' &&
      process.env.DEV_COR_TEST_DATABASE_PROJECT === project &&
      process.env.DEV_COR_TEST_DATABASE_CONTAINER_ID === containerId,
    'Customer permissions UI is outside the exact approved container',
  );
  insist(
    root
      .replaceAll('\\', '/')
      .endsWith('/.local/v6-followups-20261026/candidate') &&
      resolve(process.env.PRIVATE_FILE_ROOT ?? '') ===
        resolve(root, '.local/private-files/test'),
    'Customer permissions UI is outside the isolated candidate',
  );
}

async function withBoundClient(operation) {
  assertBoundEnvironment();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const identity = (
      await client.query(`SELECT current_database() AS db,
        current_schema() AS schema, inet_server_port() AS port`)
    ).rows[0];
    insist(
      identity.db === 'dev_cor_test' &&
        identity.schema === 'public' &&
        identity.port === 5432,
      'Customer permissions UI public database identity changed',
    );
    const expected = readdirSync(resolve(root, 'backend/prisma/migrations'), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const ledger = (
      await client.query(`SELECT migration_name, finished_at, rolled_back_at
        FROM _prisma_migrations ORDER BY migration_name`)
    ).rows;
    insist(
      expected.length === 184 &&
        expected.at(-1) === finalMigration &&
        ledger.length === expected.length &&
        ledger.every(
          (entry, index) =>
            entry.migration_name === expected[index] &&
            entry.finished_at !== null &&
            entry.rolled_back_at === null,
        ),
      'Customer permissions UI requires exact public 184 migrations',
    );
    const counter = (
      await client.query(`SELECT last_value FROM customer_business_number_counters
        WHERE singleton_id=1`)
    ).rows;
    insist(
      counter.length === 1 && Number(counter[0].last_value) >= 4,
      'Customer permissions UI requires completed synthetic numbering cutover',
    );
    return await operation(client);
  } finally {
    await client.end();
  }
}

export async function prepareV6CustomerPermissionsUi() {
  return withBoundClient(async (client) => {
    const people = (
      await client.query(
        `SELECT id, account_type FROM user_accounts
        WHERE id=ANY($1::uuid[])`,
        [[coreLeadFixtures.userA, coreLeadFixtures.userSelf]],
      )
    ).rows;
    insist(
      people.length === 2 &&
        people.every((row) => row.account_type === 'INTERNAL'),
      'Expected core synthetic operators are absent',
    );
    const roles = (
      await client.query(
        `SELECT id FROM role_templates WHERE id=ANY($1::uuid[])`,
        [[coreLeadFixtures.roleA, coreLeadFixtures.roleSelf]],
      )
    ).rows;
    insist(roles.length === 2, 'Expected core synthetic roles are absent');
    const customers = (
      await client.query(
        `SELECT id, department_id, responsible_user_id,
        profile_status FROM customers WHERE id=ANY($1::uuid[])`,
        [[coreLeadFixtures.selfCustomer, coreLeadFixtures.foreignCustomer]],
      )
    ).rows;
    const self = customers.find(
      (row) => row.id === coreLeadFixtures.selfCustomer,
    );
    const foreign = customers.find(
      (row) => row.id === coreLeadFixtures.foreignCustomer,
    );
    insist(
      self?.department_id === coreLeadFixtures.departmentA &&
        self.responsible_user_id === coreLeadFixtures.userSelf &&
        self.profile_status === 'ADMITTED' &&
        foreign?.department_id === coreLeadFixtures.departmentB,
      'Expected core synthetic customer ownership changed',
    );
    const selfManage = (
      await client.query(
        `SELECT count(*)::integer AS count FROM role_grants
        WHERE role_template_id=$1 AND action='user.manage'::permission_action`,
        [coreLeadFixtures.roleSelf],
      )
    ).rows[0].count;
    insist(selfManage === 0, 'Synthetic Self role unexpectedly manages users');
    const grants = [
      [coreLeadFixtures.roleA, 'customer.create-draft', 'DEPARTMENT'],
      [coreLeadFixtures.roleA, 'customer.responsible.transfer', 'DEPARTMENT'],
      [coreLeadFixtures.roleA, 'customer.read', 'DEPARTMENT'],
      [coreLeadFixtures.roleA, 'customer.admit', 'DEPARTMENT'],
      [coreLeadFixtures.roleA, 'evidence.read', 'DEPARTMENT'],
      [coreLeadFixtures.roleA, 'settlement.terms.update', 'DEPARTMENT'],
      [coreLeadFixtures.roleA, 'settlement.launch', 'DEPARTMENT'],
      [coreLeadFixtures.roleSelf, 'customer.account.create', 'DEPARTMENT'],
    ];
    await client.query('BEGIN');
    try {
      for (const [roleId, action, scope] of grants) {
        await client.query(
          `INSERT INTO role_grants(id, role_template_id, action, scope)
          VALUES($1,$2,$3::permission_action,$4::permission_scope)
          ON CONFLICT (role_template_id, action, scope) DO NOTHING`,
          [randomUUID(), roleId, action, scope],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    return {
      operatorUsername: coreLeadFixtures.operatorUsername,
      operatorPassword: coreLeadFixtures.operatorPassword,
      selfUsername: coreLeadFixtures.selfUsername,
      selfPassword: coreLeadFixtures.selfPassword,
      operatorUserId: coreLeadFixtures.userA,
      selfUserId: coreLeadFixtures.userSelf,
      departmentId: coreLeadFixtures.departmentA,
      foreignCustomerId: coreLeadFixtures.foreignCustomer,
      selfCustomerId: coreLeadFixtures.selfCustomer,
    };
  });
}

export async function readV6CustomerPermissionFacts(
  customerId,
  accountUserId,
  contentVersionId,
) {
  return withBoundClient(async (client) => {
    const customer = (
      await client.query(
        `SELECT department_id, responsible_user_id, profile_status,
        version FROM customers WHERE id=$1`,
        [customerId],
      )
    ).rows[0];
    const reference = (
      await client.query(
        `SELECT material_id, content_version_id, purpose
        FROM material_references WHERE department_id=$1 AND resource_type='customer'
        AND resource_id=$2 AND content_version_id=$3`,
        [coreLeadFixtures.departmentA, customerId, contentVersionId],
      )
    ).rows;
    const account = (
      await client.query(
        `SELECT b.active AS binding_active, b.version AS binding_version,
        u.active AS account_active FROM customer_account_bindings b
        JOIN user_accounts u ON u.id=b.user_id
        WHERE b.department_id=$1 AND b.customer_id=$2 AND b.user_id=$3`,
        [
          coreLeadFixtures.departmentA,
          coreLeadFixtures.selfCustomer,
          accountUserId,
        ],
      )
    ).rows;
    return { customer, reference, account };
  });
}

export async function selectV6ArchivedSettlementCase() {
  return withBoundClient(async (client) => {
    const rows = (
      await client.query(
        `SELECT c.id, c.business_no, c.stage, c.version,
          a.id AS archive_id, a.from_version, a.to_version
        FROM cases c JOIN case_early_archives a
          ON a.case_id=c.id AND a.department_id=c.department_id
        WHERE c.department_id=$1 AND c.responsible_user_id=$2
          AND c.customer_id=$3 AND c.source_lead_id IS NULL
          AND c.source_notary_matter_id IS NULL
          AND c.stage='ARCHIVED' AND c.version=2
          AND a.recorded_by_user_id=$2
          AND a.reason='V6 合成单案提前归档'
          AND a.from_version=1 AND a.to_version=2
          AND NOT EXISTS (SELECT 1 FROM case_closures h WHERE h.case_id=c.id)
          AND NOT EXISTS (SELECT 1 FROM case_settlement_terms t WHERE t.case_id=c.id)
          AND NOT EXISTS (SELECT 1 FROM case_settlement_launches l WHERE l.case_id=c.id)`,
        [
          coreLeadFixtures.departmentA,
          coreLeadFixtures.userA,
          coreLeadFixtures.admittedCustomer,
        ],
      )
    ).rows;
    insist(
      rows.length === 1,
      'Expected one untouched synthetic single early archive',
    );
    return rows[0];
  });
}

export async function readV6ArchivedSettlementFacts(caseId) {
  return withBoundClient(async (client) => {
    const archive = (
      await client.query(
        `SELECT c.id AS case_id, c.business_no, c.stage, c.version,
          a.id AS archive_id, a.from_version, a.to_version
        FROM cases c JOIN case_early_archives a
          ON a.case_id=c.id AND a.department_id=c.department_id
        WHERE c.id=$1 AND c.department_id=$2
          AND c.responsible_user_id=$3 AND a.reason='V6 合成单案提前归档'`,
        [caseId, coreLeadFixtures.departmentA, coreLeadFixtures.userA],
      )
    ).rows;
    insist(archive.length === 1, 'Synthetic early archive identity changed');
    const closureCount = (
      await client.query(
        `SELECT count(*)::integer AS count FROM case_closures
        WHERE case_id=$1 AND department_id=$2`,
        [caseId, coreLeadFixtures.departmentA],
      )
    ).rows[0].count;
    const terms = (
      await client.query(
        `SELECT version, customer_formula,
          customer_manual_amount::text AS customer_manual_amount,
          lawyer_manual_amount::text AS lawyer_manual_amount
        FROM case_settlement_terms WHERE case_id=$1 AND department_id=$2`,
        [caseId, coreLeadFixtures.departmentA],
      )
    ).rows;
    const launches = (
      await client.query(
        `SELECT id, side, nth, amount::text AS amount, bill_id, actor_user_id
        FROM case_settlement_launches WHERE case_id=$1 AND department_id=$2
        ORDER BY nth, id`,
        [caseId, coreLeadFixtures.departmentA],
      )
    ).rows;
    const audits = (
      await client.query(
        `SELECT action, count(*)::integer AS count FROM audit_events
        WHERE department_id=$1 AND resource_type='CASE' AND resource_id=$2
          AND action IN ('settlement.terms.updated', 'settlement.launch.created')
        GROUP BY action ORDER BY action`,
        [coreLeadFixtures.departmentA, caseId],
      )
    ).rows;
    return { archive: archive[0], closureCount, terms, launches, audits };
  });
}
