import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  captureTestEnvironment,
  validateIsolatedTestDatabaseUrl,
} from '../../scripts/test-environment.mjs';
import { acquireE2eResourceLock } from '../../scripts/run-e2e.mjs';

const root = resolve(import.meta.dirname, '../..');
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const environment = captureTestEnvironment(root, { pnpmVersion: '11.27.0' });
validateIsolatedTestDatabaseUrl(environment.childEnvironment.DATABASE_URL);
const client = new Client({
  connectionString: environment.childEnvironment.DATABASE_URL,
});
const target = '20261009040000_customer_contacts';
const schema = `cu006_smoke_${randomBytes(8).toString('hex')}`;
const upgrade = `cu006_upgrade_${randomBytes(8).toString('hex')}`;
const conflict = `cu006_conflict_${randomBytes(8).toString('hex')}`;
const missing = `cu006_missing_${randomBytes(8).toString('hex')}`;
const migrationRoot = resolve(root, 'backend/prisma/migrations');
const migrations = readdirSync(migrationRoot)
  .filter((name) => /^\d{14}_/.test(name))
  .sort();
if (!migrations.includes(target)) throw new Error('CU006 migration is missing');
const previousMigrations = migrations.filter((name) => name < target);
const throughTargetMigrations = [...previousMigrations, target];
const createdSchemas = [];
const lock = acquireE2eResourceLock();
async function createProbeSchema(name) {
  if (!/^cu006_(?:smoke|upgrade|conflict|missing)_[0-9a-f]{16}$/.test(name))
    throw new Error('Unsafe CU006 probe schema name');
  await client.query(`CREATE SCHEMA "${name}"`);
  createdSchemas.push(name);
  await client.query(`SET search_path TO "${name}"`);
}
async function apply(names) {
  for (const name of names) {
    const sql = readFileSync(
      resolve(migrationRoot, name, 'migration.sql'),
      'utf8',
    );
    try {
      await client.query(sql);
    } catch (error) {
      throw new Error(`${name}: ${error.message}`);
    }
  }
}
try {
  await client.connect();
  const database = (
    await client.query(
      'SELECT current_database() AS name, current_schema() AS schema',
    )
  ).rows[0];
  if (database.name !== 'dev_cor_test' || database.schema !== 'public')
    throw new Error('CU006 migration probe requires test public search path');
  process.stdout.write(
    `CU006 migration input previous=${previousMigrations.length} through102=${throughTargetMigrations.length} target=${target}\n`,
  );
  await createProbeSchema(schema);
  await apply(throughTargetMigrations);
  const result = await client.query(
    `SELECT count(*)::int AS n FROM customer_contacts`,
  );
  if (result.rows[0].n !== 0) throw new Error('empty chain created contacts');
  process.stdout.write('CU006 empty migration chain passed\n');
  await createProbeSchema(upgrade);
  await apply(previousMigrations);
  const department = '11111111-1111-4111-8111-111111111111';
  const actor = '22222222-2222-4222-8222-222222222222';
  const admitted = '33333333-3333-4333-8333-333333333333';
  const draft = '44444444-4444-4444-8444-444444444444';
  const deleted = '55555555-5555-4555-8555-555555555555';
  const fallback = '66666666-6666-4666-8666-666666666666';
  await client.query(
    `INSERT INTO departments(id,name,updated_at) VALUES ($1,'CU006',now())`,
    [department],
  );
  await client.query(
    `INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,'cu006-synthetic','CU006',now())`,
    [actor],
  );
  await client.query(
    `INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES (gen_random_uuid(),$1,$2,now())`,
    [actor, department],
  );
  await client.query(
    `INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at,
    profile_status,admitted_at,customer_type,identity_type,identity_number,normalized_identity_number,
    admission_contact_name,admission_contact_phone,identity_validity_mode)
    VALUES ($1,'Synthetic admitted','synthetic admitted',$4,$5,now(),'ADMITTED',now(),'ENTERPRISE','BUSINESS_LICENSE',
      'SYNTHETIC-1','SYNTHETIC-1','Old contact','12345678','NOT_STATED'),
      ($2,'Synthetic draft','synthetic draft',$4,$5,now(),'DRAFT',NULL,NULL,NULL,NULL,NULL,'Draft contact','12345678',NULL),
      ($3,'Synthetic deleted','synthetic deleted',$4,$5,now(),'DRAFT',NULL,NULL,NULL,NULL,NULL,'Deleted contact','12345678',NULL)`,
    [admitted, draft, deleted, department, actor],
  );
  await client.query(
    `INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at,
    profile_status,admitted_at,customer_type,identity_type,identity_number,normalized_identity_number,
    admission_contact_name,admission_contact_phone,identity_validity_mode)
    VALUES ($1,'Synthetic fallback','synthetic fallback',$2,$3,now(),'ADMITTED',now(),'ENTERPRISE','BUSINESS_LICENSE',
      'SYNTHETIC-3','SYNTHETIC-3','Fallback contact','12345678','NOT_STATED')`,
    [fallback, department, actor],
  );
  await client.query(
    `UPDATE customers SET deleted_at=now(),deleted_by_user_id=$2 WHERE id=$1`,
    [deleted, actor],
  );
  const receiptSnapshot = {
    id: admitted,
    departmentId: department,
    version: 1,
    profileStatus: 'admitted',
    admissionContactName: 'Receipt contact',
    admissionContactPhone: '87654321',
    admissionContactEmail: null,
  };
  await client.query(
    `INSERT INTO customer_admission_receipts(id,department_id,actor_user_id,idempotency_key,request_fingerprint,
    result_customer_id,result_customer_version,result_snapshot) VALUES (gen_random_uuid(),$1,$2,'synthetic-a',repeat('a',64),$3,1,$4)`,
    [department, actor, admitted, receiptSnapshot],
  );
  await client.query(
    `INSERT INTO customer_admission_receipts(id,department_id,actor_user_id,idempotency_key,request_fingerprint,
    result_customer_id,result_customer_version,result_snapshot,created_at) VALUES
    (gen_random_uuid(),$1,$2,'synthetic-later',repeat('b',64),$3,2,$4,now()+interval '1 minute'),
    (gen_random_uuid(),$1,$2,'synthetic-invalid',repeat('c',64),$3,3,$5,now()-interval '1 minute')`,
    [
      department,
      actor,
      admitted,
      { ...receiptSnapshot, version: 2, admissionContactName: 'Later contact' },
      {
        ...receiptSnapshot,
        version: 3,
        id: draft,
        admissionContactName: 'Invalid source',
      },
    ],
  );
  const before = await client.query(
    `SELECT idempotency_key,request_fingerprint,result_snapshot FROM customer_admission_receipts WHERE result_customer_id=$1 ORDER BY idempotency_key`,
    [admitted],
  );
  await apply(['20261009040000_customer_contacts']);
  const migrated =
    await client.query(`SELECT c.id,c.admission_contact_snapshot_source AS source,c.admission_contact_snapshot_name AS snapshot,
    c.compatibility_contact_id AS pointer,c.legacy_contact_pending AS pending,count(p.id)::int AS contacts
    FROM customers c LEFT JOIN customer_contacts p ON p.customer_id=c.id GROUP BY c.id ORDER BY c.id`);
  const byId = Object.fromEntries(migrated.rows.map((row) => [row.id, row]));
  if (
    byId[admitted].source !== 'RECEIPT' ||
    byId[admitted].snapshot !== 'Receipt contact' ||
    byId[admitted].contacts !== 1 ||
    byId[draft].contacts !== 1 ||
    byId[deleted].contacts !== 0 ||
    !byId[deleted].pending ||
    byId[fallback].source !== 'FALLBACK_CURRENT' ||
    byId[fallback].contacts !== 1
  )
    throw new Error('CU006 historical upgrade assertion failed');
  const legacyVersions = await client.query(
    `SELECT p.origin,p.created_by_user_id,v.source,v.actor_user_id,
    p.created_at=v.occurred_at AS same_time FROM customer_contacts p
    JOIN customer_contact_versions v ON v.contact_id=p.id WHERE p.customer_id=$1`,
    [admitted],
  );
  if (
    legacyVersions.rows.length !== 1 ||
    legacyVersions.rows[0].origin !== 'LEGACY_BACKFILL' ||
    legacyVersions.rows[0].created_by_user_id !== null ||
    legacyVersions.rows[0].source !== 'LEGACY_MIGRATION' ||
    legacyVersions.rows[0].actor_user_id !== null ||
    !legacyVersions.rows[0].same_time
  )
    throw new Error('CU006 legacy provenance assertion failed');
  const after = await client.query(
    `SELECT idempotency_key,request_fingerprint,result_snapshot FROM customer_admission_receipts WHERE result_customer_id=$1 ORDER BY idempotency_key`,
    [admitted],
  );
  if (JSON.stringify(before.rows) !== JSON.stringify(after.rows))
    throw new Error('historical receipt changed');
  process.stdout.write(
    'CU006 synthetic 101->102 upgrade, earliest valid/invalid receipt selection and receipt preservation passed\n',
  );
  async function rejects(
    label,
    sql,
    parameters,
    expectedCode,
    deferred = false,
  ) {
    await client.query('BEGIN');
    try {
      await client.query(sql, parameters);
      if (deferred) await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      throw new Error(`${label}: unexpectedly succeeded`);
    } catch (error) {
      if (error.code !== expectedCode) throw error;
    } finally {
      await client.query('ROLLBACK');
    }
  }
  const active = byId[admitted].pointer;
  await rejects(
    'second primary',
    `INSERT INTO customer_contacts(id,customer_id,department_id,name,phone,is_primary,origin,updated_at)
    VALUES (gen_random_uuid(),$1,$2,'Second','12345678',true,'MANUAL',now()),
    (gen_random_uuid(),$1,$2,'Third','12345678',true,'MANUAL',now())`,
    [admitted, department],
    '23505',
  );
  await rejects(
    'cross-customer pointer',
    `UPDATE customers SET compatibility_contact_id=$1,
    admission_contact_name='Receipt contact',admission_contact_phone='87654321' WHERE id=$2`,
    [active, draft],
    '23503',
    true,
  );
  await rejects(
    'ended primary',
    `UPDATE customer_contacts SET ended_at=now(),ended_by_user_id=$1,is_primary=true WHERE id=$2`,
    [actor, active],
    '23514',
  );
  await rejects(
    'projection drift',
    `UPDATE customers SET admission_contact_name='Drift' WHERE id=$1`,
    [admitted],
    '23514',
    true,
  );
  await rejects(
    'snapshot mutation',
    `UPDATE customers SET admission_contact_snapshot_name='Drift' WHERE id=$1`,
    [admitted],
    '23514',
  );
  await rejects(
    'version update',
    `UPDATE customer_contact_versions SET action='UPDATED' WHERE contact_id=$1`,
    [active],
    '23514',
  );
  await rejects(
    'version delete',
    `DELETE FROM customer_contact_versions WHERE contact_id=$1`,
    [active],
    '23514',
  );
  await client.query(
    `INSERT INTO customer_contact_command_receipts(id,department_id,actor_user_id,idempotency_key,
    customer_id,action,request_fingerprint,result_snapshot,result_customer_version)
    VALUES (gen_random_uuid(),$1,$2,'probe-command',$3,'CREATE',repeat('c',64),'{}'::jsonb,2)`,
    [department, actor, admitted],
  );
  await rejects(
    'receipt update',
    `UPDATE customer_contact_command_receipts SET result_customer_version=3 WHERE idempotency_key='probe-command'`,
    [],
    '23514',
  );
  await rejects(
    'receipt delete',
    `DELETE FROM customer_contact_command_receipts WHERE idempotency_key='probe-command'`,
    [],
    '23514',
  );
  await client.query('BEGIN');
  await client.query(
    `UPDATE customer_contacts SET ended_at=now(),ended_by_user_id=$1,version=version+1 WHERE id=$2`,
    [actor, active],
  );
  await client.query(
    `UPDATE customers SET compatibility_contact_id=NULL,admission_contact_name=NULL,
    admission_contact_phone=NULL,admission_contact_email=NULL WHERE id=$1`,
    [admitted],
  );
  await client.query('COMMIT');
  await rejects(
    'ended revive',
    `UPDATE customer_contacts SET ended_at=NULL,ended_by_user_id=NULL,version=version+1 WHERE id=$1`,
    [active],
    '23514',
  );
  const admittedAfterEnd = await client.query(
    `SELECT profile_status,admission_contact_snapshot_name FROM customers WHERE id=$1`,
    [admitted],
  );
  if (
    admittedAfterEnd.rows[0].profile_status !== 'ADMITTED' ||
    admittedAfterEnd.rows[0].admission_contact_snapshot_name !==
      'Receipt contact'
  )
    throw new Error('ended final contact changed admitted snapshot');
  await rejects(
    'deleted parent contact',
    `INSERT INTO customer_contacts(id,customer_id,department_id,name,phone,origin,updated_at)
    VALUES (gen_random_uuid(),$1,$2,'Blocked','12345678','MANUAL',now())`,
    [deleted, department],
    '23514',
  );
  process.stdout.write('CU006 SQL guard negatives passed\n');
  await createProbeSchema(conflict);
  await apply(previousMigrations);
  await client.query(
    `INSERT INTO departments(id,name,updated_at) VALUES ($1,'CU006 bad',now())`,
    [department],
  );
  await client.query(
    `INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,'cu006-conflict','CU006',now())`,
    [actor],
  );
  await client.query(
    `INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES (gen_random_uuid(),$1,$2,now())`,
    [actor, department],
  );
  await client.query(
    `INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at,
    profile_status,admitted_at,customer_type,identity_type,identity_number,normalized_identity_number,
    admission_contact_name,admission_contact_phone,identity_validity_mode)
    VALUES ($1,'Synthetic admitted','synthetic admitted',$2,$3,now(),'ADMITTED',now(),'ENTERPRISE','BUSINESS_LICENSE',
      'SYNTHETIC-2','SYNTHETIC-2','Old contact','12345678','NOT_STATED')`,
    [admitted, department, actor],
  );
  const conflictingSnapshot = {
    ...receiptSnapshot,
    admissionContactName: 'Different receipt contact',
  };
  await client.query(
    `INSERT INTO customer_admission_receipts(id,department_id,actor_user_id,idempotency_key,request_fingerprint,
    result_customer_id,result_customer_version,result_snapshot) VALUES
    (gen_random_uuid(),$1,$2,'conflict-a',repeat('a',64),$3,1,$4),
    (gen_random_uuid(),$1,$2,'conflict-b',repeat('b',64),$3,1,$5)`,
    [department, actor, admitted, receiptSnapshot, conflictingSnapshot],
  );
  try {
    await apply(['20261009040000_customer_contacts']);
    throw new Error('contradictory receipt migration unexpectedly succeeded');
  } catch (error) {
    await client.query('ROLLBACK');
    if (
      !error.message.includes(
        'CU006 conflicting admission receipt customer IDs',
      )
    )
      throw error;
  }
  const rolledBack = await client.query(
    `SELECT to_regclass('customer_contacts') AS contact_table,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name='customers'
      AND column_name='compatibility_contact_id') AS contact_column`,
    [conflict],
  );
  if (
    rolledBack.rows[0].contact_table !== null ||
    rolledBack.rows[0].contact_column
  )
    throw new Error('failed CU006 migration left partial schema');
  await client.query(
    `DELETE FROM customer_admission_receipts WHERE idempotency_key='conflict-b'`,
  );
  await apply(['20261009040000_customer_contacts']);
  process.stdout.write(
    'CU006 conflicting receipt atomic rollback and retry passed\n',
  );
  await createProbeSchema(missing);
  await apply(previousMigrations);
  await client.query(
    `INSERT INTO departments(id,name,updated_at) VALUES ($1,'CU006 missing',now())`,
    [department],
  );
  await client.query(
    `INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,'cu006-missing','CU006',now())`,
    [actor],
  );
  await client.query(
    `INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES (gen_random_uuid(),$1,$2,now())`,
    [actor, department],
  );
  // Simulate anomalous legacy data that predates the old admitted CHECK.
  await client.query(
    'ALTER TABLE customers DROP CONSTRAINT customers_admitted_fields_compatible_check',
  );
  await client.query(
    'ALTER TABLE customers ADD CONSTRAINT customers_admitted_fields_compatible_check CHECK (true)',
  );
  await client.query(
    `INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at,
    profile_status,admitted_at,customer_type,identity_type,identity_number,normalized_identity_number,identity_validity_mode)
    VALUES ($1,'Synthetic missing','synthetic missing',$2,$3,now(),'ADMITTED',now(),'ENTERPRISE',
      'BUSINESS_LICENSE','SYNTHETIC-4','SYNTHETIC-4','NOT_STATED')`,
    [admitted, department, actor],
  );
  try {
    await apply(['20261009040000_customer_contacts']);
    throw new Error('missing minimum admission contact unexpectedly succeeded');
  } catch (error) {
    await client.query('ROLLBACK');
    if (!error.message.includes('CU006 admitted customers lack snapshot IDs'))
      throw error;
  }
  const missingRolledBack = await client.query(
    `SELECT to_regclass('customer_contacts') AS contact_table`,
  );
  if (missingRolledBack.rows[0].contact_table !== null)
    throw new Error('missing minimum rollback left contact table');
  await client.query(
    `UPDATE customers SET admission_contact_name='Recovered synthetic', admission_contact_phone='12345678' WHERE id=$1`,
    [admitted],
  );
  await apply(['20261009040000_customer_contacts']);
  process.stdout.write(
    'CU006 missing minimum atomic rollback and repair retry passed\n',
  );
} finally {
  const cleanupFailures = [];
  await client.query('ROLLBACK').catch(() => {});
  await client
    .query('SET search_path TO public')
    .catch(() => cleanupFailures.push('search_path'));
  for (const name of createdSchemas.reverse()) {
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
    } catch {
      cleanupFailures.push(name);
    }
  }
  await client.end().catch(() => {});
  lock.release();
  if (cleanupFailures.length > 0) {
    process.stderr.write(
      `CU006 probe cleanup failed: ${cleanupFailures.join(',')}\n`,
    );
    process.exitCode = 1;
  }
}
