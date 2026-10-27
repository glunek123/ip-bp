import { randomUUID } from 'node:crypto';
import {
  v6MigrationSql,
  withV6FollowupSchema,
} from './v6-followup-fixture.mjs';

const m181 = '20261026120000_v6_early_archive';
const m182 = '20261026130000_v6_product_screenshots';
const m183 = '20261026140000_v6_case_csv_import';
const m184 = '20261026150000_v6_fee_cancellation';
const m180 = '20261026110000_v6_customer_account_create';

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function absent(client, table) {
  const result = await client.query('SELECT to_regclass($1) AS relation', [
    table,
  ]);
  assert(
    result.rows[0].relation === null,
    `${table} survived failed migration`,
  );
}

async function migrationFailsAtomically(client, name, expectedCode) {
  let error;
  try {
    await client.query(v6MigrationSql(name));
  } catch (failure) {
    error = failure;
  }
  if (!error) throw new Error(`${name} unexpectedly succeeded`);
  await client.query('ROLLBACK');
  assert(
    error.code === expectedCode,
    `${name} failed with unexpected SQLSTATE ${error.code ?? 'unknown'}`,
  );
}

export async function verifyV6FollowupMigrations() {
  const checks = [];
  await withV6FollowupSchema(async ({ client }) => {
    const expectedTables = [
      'case_early_archives',
      'lead_product_screenshots',
      'case_csv_import_receipts',
      'fee_cancellations',
      'fee_cancellation_payments',
      'fee_refund_reconciliations',
    ];
    for (const table of expectedTables) {
      const present = (
        await client.query('SELECT to_regclass($1) AS relation', [table])
      ).rows[0].relation;
      assert(present !== null, `Empty 184 chain is missing ${table}`);
    }
    checks.push('empty schema applies the exact 184 migration chain');
  });

  await withV6FollowupSchema(
    async ({ client }) => {
      const department = randomUUID();
      const actor = randomUUID();
      const customer = randomUUID();
      await client.query(
        'INSERT INTO departments(id,name,updated_at) VALUES($1,$2,now())',
        [department, 'v6 升级合成部门'],
      );
      await client.query(
        'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES($1,$2,$3,now())',
        [actor, `v6-followup-${actor}`, '合成运营'],
      );
      await client.query(
        'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES($1,$2,$3,now())',
        [randomUUID(), actor, department],
      );
      await client.query(
        'INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at) VALUES($1,$2,$3,$4,$5,now())',
        [customer, '升级前客户', '升级前客户', department, actor],
      );
      const oldRow = (
        await client.query(
          'SELECT to_jsonb(c) AS row FROM customers c WHERE id=$1',
          [customer],
        )
      ).rows[0].row;
      const oldCounter = (
        await client.query(
          'SELECT last_value FROM customer_business_number_counters WHERE singleton_id=1',
        )
      ).rows[0].last_value;
      assert(oldCounter === '-1', '180 upgrade fixture crossed number cutover');

      const beforeGuard = (
        await client.query(
          `SELECT pg_get_functiondef('check_case_trial_round_foundation()'::regprocedure) AS definition`,
        )
      ).rows[0].definition;
      await client.query(`CREATE FUNCTION v6_collision_trigger() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`);
      await client.query(`CREATE TRIGGER early_archive_stop_case_trial_rounds
        BEFORE INSERT OR UPDATE OR DELETE ON case_trial_rounds
        FOR EACH ROW EXECUTE FUNCTION v6_collision_trigger()`);
      await migrationFailsAtomically(client, m181, '42710');
      await absent(client, 'case_early_archives');
      const afterGuard = (
        await client.query(
          `SELECT pg_get_functiondef('check_case_trial_round_foundation()'::regprocedure) AS definition`,
        )
      ).rows[0].definition;
      assert(
        beforeGuard === afterGuard,
        '181 failure retained a changed case guard',
      );
      await client.query(
        'DROP TRIGGER early_archive_stop_case_trial_rounds ON case_trial_rounds',
      );
      await client.query('DROP FUNCTION v6_collision_trigger()');
      await client.query(v6MigrationSql(m181));
      checks.push(
        '181 late collision rolls back dynamic guard wrappers and retries',
      );

      await client.query(`CREATE FUNCTION guard_lead_product_screenshot()
        RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`);
      await migrationFailsAtomically(client, m182, '42723');
      await absent(client, 'lead_product_screenshots');
      await client.query('DROP FUNCTION guard_lead_product_screenshot()');
      await client.query(v6MigrationSql(m182));
      const screenshotGuard = (
        await client.query(
          `SELECT count(*)::int AS count FROM pg_trigger
           WHERE tgname='lead_product_screenshots_material_guard'
             AND tgrelid='lead_product_screenshots'::regclass`,
        )
      ).rows[0].count;
      assert(
        screenshotGuard === 1,
        '182 retry omitted the product material guard',
      );
      checks.push(
        '182 late function collision rolls back table and retries with material guard',
      );
      await client.query(
        'CREATE TABLE case_early_archive_batch_receipts(id uuid PRIMARY KEY)',
      );
      await migrationFailsAtomically(client, m183, '42P07');
      await absent(client, 'case_csv_import_receipts');
      await absent(client, 'case_csv_imported_rows');
      await client.query('DROP TABLE case_early_archive_batch_receipts');
      await client.query(v6MigrationSql(m183));
      checks.push(
        '183 late relation collision rolls back earlier tables and retries',
      );

      await client.query(
        'CREATE TABLE fee_cancellation_payments(id uuid PRIMARY KEY)',
      );
      await migrationFailsAtomically(client, m184, '42P07');
      await absent(client, 'fee_cancellations');
      await client.query('DROP TABLE fee_cancellation_payments');
      await client.query(v6MigrationSql(m184));
      checks.push(
        '184 late relation collision rolls back earlier tables and retries',
      );

      const newRow = (
        await client.query(
          'SELECT to_jsonb(c) AS row FROM customers c WHERE id=$1',
          [customer],
        )
      ).rows[0].row;
      assert(
        JSON.stringify(newRow) === JSON.stringify(oldRow),
        'Upgrade changed old customer',
      );
      const newCounter = (
        await client.query(
          'SELECT last_value FROM customer_business_number_counters WHERE singleton_id=1',
        )
      ).rows[0].last_value;
      assert(newCounter === '-1', 'Upgrade advanced historical number counter');
      checks.push(
        '180-era customer and unready number counter survive 181-184',
      );
    },
    { through: m180 },
  );
  return { migrationCount: 184, checks };
}
