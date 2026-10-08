import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { captureTestEnvironment } from '../../../../scripts/test-environment.mjs';

const root = resolve(import.meta.dirname, '../../../..');
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const environment = captureTestEnvironment(root, { pnpmVersion: '11.27.0' });
const client = new Client({
  connectionString: environment.childEnvironment.DATABASE_URL,
});
const migrationRoot = resolve(root, 'backend/prisma/migrations');
const target = '20260928030000_add_notary_accounts_and_opening_actor';
// Freeze the historical schema under test; do not apply later migrations here.
const migrations = readdirSync(migrationRoot)
  .filter((name) => /^\d{14}_/.test(name) && name <= target)
  .sort();
const emptySchema = `nt007_empty_${randomBytes(8).toString('hex')}`;
const upgradeSchema = `nt007_upgrade_${randomBytes(8).toString('hex')}`;
const id = {
  department: '11111111-1111-4111-8111-111111111111',
  otherDepartment: '11111111-1111-4111-8111-111111111112',
  operator: '22222222-2222-4222-8222-222222222222',
  notary: '33333333-3333-4333-8333-333333333333',
  otherNotary: '33333333-3333-4333-8333-333333333334',
  customer: '44444444-4444-4444-8444-444444444444',
  rights: '55555555-5555-4555-8555-555555555555',
  lead: '66666666-6666-4666-8666-666666666666',
  otherLead: '66666666-6666-4666-8666-666666666667',
  office: '77777777-7777-4777-8777-777777777777',
  otherOffice: '77777777-7777-4777-8777-777777777778',
  matter: '88888888-8888-4888-8888-888888888888',
  otherMatter: '88888888-8888-4888-8888-888888888889',
  binding: '99999999-9999-4999-8999-999999999999',
  draft: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  receipt: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  audit: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
};

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

async function rejects(sql, values, code) {
  await client.query('SAVEPOINT nt007_negative');
  try {
    await client.query(sql, values);
    throw new Error('negative SQL unexpectedly succeeded');
  } catch (error) {
    if (error.code !== code) throw error;
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT nt007_negative');
  }
}

async function count(sql, values = []) {
  return (await client.query(sql, values)).rows[0].count;
}

async function seedPreviousSchema() {
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO departments(id,name,updated_at) VALUES ($1,'Probe',now()),($2,'Other',now())`,
      [id.department, id.otherDepartment],
    );
    await client.query(
      `INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,'nt007-operator','Probe Operator',now())`,
      [id.operator],
    );
    await client.query(
      `INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES (gen_random_uuid(),$1,$2,now())`,
      [id.operator, id.department],
    );
    await client.query(
      `INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at) VALUES ($1,'Probe Customer','probe customer',$2,$3,now())`,
      [id.customer, id.department, id.operator],
    );
    await client.query(
      `INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,'Probe Rights',$2,now())`,
      [id.rights, id.department],
    );
    await client.query(
      `INSERT INTO leads(id,department_id,business_no,customer_id,rights_holder_id,responsible_user_id,status,case_type,source,platform,found_at,shop_name,need_disclose,version,pushed_at,pushed_by_user_id,updated_at) VALUES ($1,$3,'NT007-PROBE',$4,$5,$6,'WAITING_EVIDENCE_DECISION','CIVIL','ONLINE','TAOBAO',now(),'Probe Shop',false,3,now(),$6,now()),($2,$3,'NT007-PROBE-2',$4,$5,$6,'WAITING_EVIDENCE_DECISION','CIVIL','ONLINE','TAOBAO',now(),'Probe Shop',false,3,now(),$6,now())`,
      [
        id.lead,
        id.otherLead,
        id.department,
        id.customer,
        id.rights,
        id.operator,
      ],
    );
    await client.query(
      `INSERT INTO notary_offices(id,department_id,name,created_by_user_id) VALUES ($1,$2,'Probe Office',$3),($4,$5,'Other Office',$3)`,
      [
        id.office,
        id.department,
        id.operator,
        id.otherOffice,
        id.otherDepartment,
      ],
    );
    await client.query(
      `INSERT INTO notary_matters(id,business_no,department_id,source_lead_id,customer_id,rights_holder_id,responsible_user_id,notary_office_id,evidence_mode,batch_purpose,source_snapshot,created_by_user_id,from_lead_version,to_lead_version) VALUES ($1,'NT007-MATTER',$2,$3,$4,$5,$6,$7,'ONLINE_PURCHASE','Probe','{}',$6,3,4)`,
      [
        id.matter,
        id.department,
        id.lead,
        id.customer,
        id.rights,
        id.operator,
        id.office,
      ],
    );
    await client.query(
      `INSERT INTO notary_matters(id,business_no,department_id,source_lead_id,customer_id,rights_holder_id,responsible_user_id,notary_office_id,evidence_mode,batch_purpose,source_snapshot,created_by_user_id,from_lead_version,to_lead_version) VALUES ($1,'NT007-MATTER-2',$2,$3,$4,$5,$6,$7,'ONLINE_PURCHASE','Probe','{}',$6,3,4)`,
      [
        id.otherMatter,
        id.department,
        id.otherLead,
        id.customer,
        id.rights,
        id.operator,
        id.office,
      ],
    );
    await client.query(
      `INSERT INTO upload_drafts(id,department_id,actor_user_id,owner_type,owner_id,category,purpose,original_filename,declared_mime_type,expires_at,updated_at) VALUES ($1,$2,$3,'NOTARY_MATTER',$4,'NOTARY_OPENING_PHOTO','OPENING_PHOTO','probe.jpg','image/jpeg',now() + interval '1 day',now())`,
      [id.draft, id.department, id.operator, id.matter],
    );
    await client.query(
      `INSERT INTO notary_matter_opening(matter_id,department_id,sender_name,recorded_by_user_id) VALUES ($1,$2,'Probe Sender',$3)`,
      [id.matter, id.department, id.operator],
    );
    await client.query(
      `INSERT INTO notary_matter_command_receipts(id,department_id,actor_user_id,action,idempotency_key,request_fingerprint,result_matter_id,result_matter_version,result_snapshot) VALUES ($1,$2,$3,'notary.opening.record','legacy',repeat('a',64),$4,2,'{}')`,
      [id.receipt, id.department, id.operator, id.matter],
    );
    await client.query(
      `INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action,details) VALUES ($1,$2,$3,'notary_matter',$4,'probe.legacy','{}')`,
      [id.audit, id.department, id.operator, id.matter],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function assertLegacyActors(backfilled) {
  for (const [table, key] of [
    ['upload_drafts', 'id'],
    ['notary_matter_opening', 'matter_id'],
    ['notary_matter_command_receipts', 'id'],
    ['audit_events', 'id'],
  ]) {
    const rowId =
      table === 'upload_drafts'
        ? id.draft
        : table === 'notary_matter_opening'
          ? id.matter
          : table === 'notary_matter_command_receipts'
            ? id.receipt
            : id.audit;
    const actor =
      table === 'notary_matter_opening'
        ? 'recorded_by_user_id'
        : 'actor_user_id';
    const extra = backfilled
      ? ',internal_actor_user_id,notary_office_account_binding_id'
      : '';
    const result = await client.query(
      `SELECT ${actor}${extra} FROM ${table} WHERE ${key}=$1`,
      [rowId],
    );
    const row = result.rows[0];
    if (
      result.rowCount !== 1 ||
      row[actor] !== id.operator ||
      (backfilled &&
        (row.internal_actor_user_id !== id.operator ||
          row.notary_office_account_binding_id !== null))
    )
      throw new Error(
        `${table} legacy actor was lost or incorrectly backfilled`,
      );
  }
}

async function assertUpgrade() {
  await assertLegacyActors(true);
  await client.query('BEGIN');
  try {
    await rejects(
      `UPDATE notary_matter_opening SET sender_name='Changed' WHERE matter_id=$1`,
      [id.matter],
      '55000',
    );
    await rejects(
      `DELETE FROM notary_matter_opening WHERE matter_id=$1`,
      [id.matter],
      '55000',
    );
    await rejects(
      `INSERT INTO notary_office_account_bindings(id,user_id,department_id,notary_office_id,updated_at) VALUES ($1,$2,$3,$4,now())`,
      [id.binding, id.operator, id.department, id.office],
      '23514',
    );
    await client.query('SAVEPOINT nt007_unbound');
    await client.query(
      `INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES (gen_random_uuid(),'unbound-notary','Unbound','NOTARY',now())`,
    );
    await rejects(
      'SET CONSTRAINTS user_accounts_notary_binding_cardinality IMMEDIATE',
      [],
      '23514',
    );
    await client.query('ROLLBACK TO SAVEPOINT nt007_unbound');
    await client.query(
      `INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,'nt007-notary','Probe Notary','NOTARY',now()),($2,'nt007-other-notary','Other Notary','NOTARY',now())`,
      [id.notary, id.otherNotary],
    );
    await rejects(
      `INSERT INTO notary_office_account_bindings(id,user_id,department_id,notary_office_id,updated_at) VALUES ($1,$2,$3,$4,now())`,
      [id.binding, id.notary, id.department, id.otherOffice],
      '23503',
    );
    await client.query(
      `INSERT INTO notary_office_account_bindings(id,user_id,department_id,notary_office_id,updated_at) VALUES ($1,$2,$3,$4,now()),(gen_random_uuid(),$5,$6,$7,now())`,
      [
        id.binding,
        id.notary,
        id.department,
        id.office,
        id.otherNotary,
        id.otherDepartment,
        id.otherOffice,
      ],
    );
    await rejects(
      `UPDATE notary_office_account_bindings SET notary_office_id=$1 WHERE id=$2`,
      [id.otherOffice, id.binding],
      '23514',
    );
    await rejects(
      `INSERT INTO notary_office_account_bindings(id,user_id,department_id,notary_office_id,updated_at) VALUES (gen_random_uuid(),$1,$2,$3,now())`,
      [id.otherNotary, id.department, id.office],
      '23505',
    );
    await rejects(
      `INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES (gen_random_uuid(),$1,$2,now())`,
      [id.notary, id.department],
      '23514',
    );
    await rejects(
      `INSERT INTO upload_drafts(id,department_id,actor_user_id,owner_type,owner_id,category,purpose,original_filename,declared_mime_type,expires_at,updated_at,notary_office_account_binding_id) VALUES (gen_random_uuid(),$1,$2,'NOTARY_MATTER',$3,'NOTARY_OPENING_PHOTO','OPENING_PHOTO','probe.jpg','image/jpeg',now() + interval '1 day',now(),$4)`,
      [id.department, id.operator, id.matter, id.binding],
      '23503',
    );
    await client.query(
      `INSERT INTO upload_drafts(id,department_id,actor_user_id,owner_type,owner_id,category,purpose,original_filename,declared_mime_type,expires_at,updated_at,notary_office_account_binding_id) VALUES (gen_random_uuid(),$1,$2,'NOTARY_MATTER',$3,'NOTARY_OPENING_PHOTO','OPENING_PHOTO','probe.jpg','image/jpeg',now() + interval '1 day',now(),$4)`,
      [id.department, id.notary, id.matter, id.binding],
    );
    await client.query(
      `INSERT INTO notary_matter_opening(matter_id,department_id,sender_name,recorded_by_user_id,notary_office_account_binding_id) VALUES ($1,$2,'External Sender',$3,$4)`,
      [id.otherMatter, id.department, id.notary, id.binding],
    );
    await client.query(
      `INSERT INTO notary_matter_command_receipts(id,department_id,actor_user_id,action,idempotency_key,request_fingerprint,result_matter_id,result_matter_version,result_snapshot,notary_office_account_binding_id) VALUES (gen_random_uuid(),$1,$2,'notary.opening.record','external',repeat('b',64),$3,2,'{}',$4)`,
      [id.department, id.notary, id.matter, id.binding],
    );
    await client.query(
      `INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action,details,notary_office_account_binding_id) VALUES (gen_random_uuid(),$1,$2,'notary_matter',$3,'probe.external','{}',$4)`,
      [id.department, id.notary, id.matter, id.binding],
    );
    for (const table of [
      'upload_drafts',
      'notary_matter_command_receipts',
      'audit_events',
    ]) {
      if (
        (await count(
          `SELECT count(*)::int AS count FROM ${table} WHERE actor_user_id=$1 AND internal_actor_user_id IS NULL AND notary_office_account_binding_id=$2`,
          [id.notary, id.binding],
        )) !== 1
      )
        throw new Error(`${table} external actor path missing`);
    }
    if (
      (await count(
        `SELECT count(*)::int AS count FROM notary_matter_opening WHERE matter_id=$1 AND recorded_by_user_id=$2 AND internal_actor_user_id IS NULL AND notary_office_account_binding_id=$3`,
        [id.otherMatter, id.notary, id.binding],
      )) !== 1
    )
      throw new Error('notary_matter_opening external actor path missing');
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function run() {
  if (migrations.at(-1) !== target)
    throw new Error('target is not the latest migration');
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${emptySchema}"`);
    await client.query(`SET search_path TO "${emptySchema}"`);
    await apply(migrations);
    if (
      (await count(
        `SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema=$1 AND table_name IN ('notary_office_account_bindings','upload_drafts','notary_matter_opening','notary_matter_command_receipts','audit_events')`,
        [emptySchema],
      )) !== 5
    )
      throw new Error('empty migration chain lacks NT-007 actor tables');
    console.log('empty migration chain passed:', migrations.length);

    await client.query(`CREATE SCHEMA "${upgradeSchema}"`);
    await client.query(`SET search_path TO "${upgradeSchema}"`);
    await apply(migrations.filter((name) => name < target));
    await seedPreviousSchema();
    await client.query(
      `CREATE FUNCTION enforce_dual_actor_path() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`,
    );
    let failed = false;
    try {
      await apply([target]);
    } catch (error) {
      if (
        !error.message.includes('enforce_dual_actor_path') ||
        !error.message.includes('already exists')
      )
        throw error;
      failed = true;
      await client.query('ROLLBACK');
    }
    if (!failed) throw new Error('forced migration failure did not occur');
    if (
      (await count(
        `SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema=$1 AND table_name IN ('upload_drafts','notary_matter_opening','notary_matter_command_receipts','audit_events') AND column_name='internal_actor_user_id'`,
        [upgradeSchema],
      )) !== 0 ||
      (await count(
        `SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema=$1 AND table_name='notary_office_account_bindings'`,
        [upgradeSchema],
      )) !== 0
    )
      throw new Error('failed migration left partial schema writes');
    await assertLegacyActors(false);
    await client.query('DROP FUNCTION enforce_dual_actor_path()');
    await apply([target]);
    await assertUpgrade();
    console.log(
      'previous-schema upgrade, rollback, actor backfill and constraints passed',
    );
  } finally {
    await client.query('ROLLBACK');
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS "${emptySchema}" CASCADE`);
    await client.query(`DROP SCHEMA IF EXISTS "${upgradeSchema}" CASCADE`);
    await client.end();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
