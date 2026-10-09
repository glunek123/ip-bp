import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const migrationRoot = resolve(root, 'backend/prisma/migrations');
const names = readdirSync(migrationRoot)
  .filter((name) => /^\d{14}_/u.test(name))
  .sort();
const prior = '20261009040000_customer_contacts';
const enumName = '20261009050000_customer_agreement_invoice_enums';
const structure = '20261009051000_customer_agreement_invoice_facts';
const hardening = '20261009052000_harden_customer_agreement_invoice_guards';
const setFix = '20261009053000_fix_customer_agreement_reference_set';
const labelGuard = '20261009054000_close_customer_agreement_label_guards';
const expected = [enumName, structure, hardening, setFix, labelGuard];

export async function verifyCustomerAgreementMigration() {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('CU007 migration probe requires NODE_ENV=test');
  validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL, {
    allowRandomPort: true,
  });
  const schema = `cu007_probe_${randomUUID().replaceAll('-', '')}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const sql = (name) =>
    readFileSync(resolve(migrationRoot, name, 'migration.sql'), 'utf8');
  let created = false;
  const checks = [];
  async function rejects(label, query, params, code, deferred = false) {
    await client.query('BEGIN');
    try {
      await client.query(query, params);
      if (deferred) await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      throw new Error(`${label} unexpectedly succeeded`);
    } catch (error) {
      if (error.code !== code) throw error;
      checks.push(label);
    } finally {
      await client.query('ROLLBACK');
    }
  }
  try {
    await client.connect();
    const location = (
      await client.query(
        'SELECT current_database() AS db, current_schema() AS schema',
      )
    ).rows[0];
    if (location.db !== 'dev_cor_test' || location.schema !== 'public')
      throw new Error('CU007 probe requires isolated test public');
    const migrationRows = await client.query(
      'SELECT migration_name, checksum FROM _prisma_migrations WHERE migration_name=$1 AND finished_at IS NOT NULL',
      [prior],
    );
    if (
      migrationRows.rows.length !== 1 ||
      migrationRows.rows[0].checksum !==
        createHash('sha256').update(sql(prior)).digest('hex')
    )
      throw new Error('102 migration checksum changed');
    checks.push('102 checksum');
    if (
      expected.some((name) => !names.includes(name)) ||
      names.indexOf(labelGuard) !== names.length - 1
    )
      throw new Error('CU007 migration suffix changed');
    await client.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await client.query(`SET search_path TO "${schema}"`);
    for (const name of names.filter((name) => name <= prior))
      await client.query(sql(name));
    const dept = randomUUID(),
      actor = randomUUID(),
      customer = randomUUID(),
      receipt = randomUUID();
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
      [dept, 'CU007 probe'],
    );
    await client.query(
      'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
      [actor, 'cu007-probe-actor', 'CU007 actor'],
    );
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [randomUUID(), actor, dept],
    );
    await client.query(
      'INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at) VALUES ($1,$2,$3,$4,$5,now())',
      [customer, 'CU007 customer', 'cu007 customer', dept, actor],
    );
    await client.query(
      `INSERT INTO customer_contact_command_receipts(id,department_id,actor_user_id,idempotency_key,customer_id,action,request_fingerprint,result_snapshot,result_customer_version)
      VALUES ($1,$2,$3,'original-receipt',$4,'CREATE',repeat('a',64),'{}'::jsonb,1)`,
      [receipt, dept, actor, customer],
    );
    const originalReceipt = (
      await client.query(
        'SELECT result_snapshot,request_fingerprint FROM customer_contact_command_receipts WHERE id=$1',
        [receipt],
      )
    ).rows[0];
    await client.query(sql(enumName));
    const middle =
      await client.query(`SELECT count(*)::int AS n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
      JOIN pg_namespace ns ON ns.oid=t.typnamespace
      WHERE ns.nspname=current_schema() AND t.typname='permission_action'
        AND e.enumlabel IN ('customer.agreement.read','customer.agreement.edit','customer.invoice.read','customer.invoice.edit')`);
    if (
      middle.rows[0].n !== 4 ||
      (await client.query("SELECT to_regclass('customer_agreements') AS rel"))
        .rows[0].rel !== null ||
      Number(
        (
          await client.query(
            "SELECT count(*) FROM role_grants WHERE action::text LIKE 'customer.agreement.%' OR action::text LIKE 'customer.invoice.%'",
          )
        ).rows[0].count,
      ) !== 0
    )
      throw new Error(
        'enum intermediate state leaked business structure or grants',
      );
    checks.push('103 enum intermediate');
    try {
      await client.query(
        sql(structure).replace(/COMMIT;\s*$/u, 'SELECT 1/0; COMMIT;'),
      );
      throw new Error('104 injected failure unexpectedly succeeded');
    } catch (error) {
      if (error.code !== '22012') throw error;
      await client.query('ROLLBACK');
    }
    if (
      (await client.query("SELECT to_regclass('customer_agreements') AS rel"))
        .rows[0].rel !== null
    )
      throw new Error('failed 104 structure was not rolled back');
    checks.push('104 failure atomic');
    for (const name of [structure, hardening, setFix])
      await client.query(sql(name));
    const invalidOldMaterial = randomUUID();
    await client.query(
      `INSERT INTO materials(id,department_id,owner_type,owner_id,category,purpose,updated_at)
      VALUES ($1,$2,'CUSTOMER',$3,'CUSTOMER_IDENTITY','CUSTOMER_AGREEMENT',now())`,
      [invalidOldMaterial, dept, customer],
    );
    checks.push('106 reverse-label gap reproduced');
    try {
      await client.query(sql(labelGuard));
      throw new Error('107 accepted invalid historical label combination');
    } catch (error) {
      if (error.code !== '23514') throw error;
      await client.query('ROLLBACK');
    }
    if (
      Number(
        (
          await client.query('SELECT count(*) FROM materials WHERE id=$1', [
            invalidOldMaterial,
          ])
        ).rows[0].count,
      ) !== 1
    )
      throw new Error('107 failure did not preserve pre-existing data');
    await client.query('DELETE FROM materials WHERE id=$1', [
      invalidOldMaterial,
    ]);
    checks.push('107 invalid historical data fails atomically');
    await client.query(sql(labelGuard));
    const afterReceipt = (
      await client.query(
        'SELECT result_snapshot,request_fingerprint FROM customer_contact_command_receipts WHERE id=$1',
        [receipt],
      )
    ).rows[0];
    if (JSON.stringify(afterReceipt) !== JSON.stringify(originalReceipt))
      throw new Error('old receipt changed');
    const empty = await client.query(
      'SELECT (SELECT count(*) FROM customer_agreements)::int AS agreements,(SELECT count(*) FROM customer_invoice_profiles)::int AS invoices',
    );
    if (empty.rows[0].agreements !== 0 || empty.rows[0].invoices !== 0)
      throw new Error('old customer backfilled documents');
    checks.push('old customer and receipt preserved');
    const agreement = randomUUID(),
      version = randomUUID(),
      audit = randomUUID();
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO customer_agreements(id,customer_id,department_id) VALUES ($1,$2,$3)',
      [agreement, customer, dept],
    );
    await client.query(
      `INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action,details,created_at)
      VALUES ($1,$2,$3,'customer_agreement',$4,'customer.agreement.created','{}'::jsonb,now())`,
      [audit, dept, actor, agreement],
    );
    await client.query(
      `INSERT INTO customer_agreement_versions(id,agreement_id,customer_id,department_id,version,title,validity_mode,content_version_ids,recorded_by_user_id,audit_event_id)
      VALUES ($1,$2,$3,$4,1,'真实协议','UNKNOWN','{}'::uuid[],$5,$6)`,
      [version, agreement, customer, dept, actor, audit],
    );
    await client.query(
      'UPDATE customer_agreements SET current_version_id=$1 WHERE id=$2',
      [version, agreement],
    );
    await client.query('COMMIT');
    checks.push('no-file version and current pointer');
    await rejects(
      'immutable version',
      'UPDATE customer_agreement_versions SET title=$1 WHERE id=$2',
      ['changed', version],
      '23514',
    );
    await rejects(
      'customer delete with agreement',
      'UPDATE customers SET deleted_at=now() WHERE id=$1',
      [customer],
      '23514',
    );
    await rejects(
      'wrong agreement purpose',
      `INSERT INTO materials(id,department_id,owner_type,owner_id,category,purpose,updated_at)
      VALUES ($1,$2,'CUSTOMER',$3,'CUSTOMER_AGREEMENT','OTHER',now())`,
      [randomUUID(), dept, customer],
      '23514',
    );
    await rejects(
      'wrong agreement category',
      `INSERT INTO materials(id,department_id,owner_type,owner_id,category,purpose,updated_at)
      VALUES ($1,$2,'CUSTOMER',$3,'CUSTOMER_IDENTITY','CUSTOMER_AGREEMENT',now())`,
      [randomUUID(), dept, customer],
      '23514',
    );
    await rejects(
      'wrong draft purpose',
      `INSERT INTO upload_drafts(id,department_id,actor_user_id,internal_actor_user_id,owner_type,owner_id,category,purpose,original_filename,declared_mime_type,expires_at,updated_at)
      VALUES ($1,$2,$3,$3,'CUSTOMER',$4,'CUSTOMER_AGREEMENT','OTHER','test.pdf','application/pdf',now() + interval '1 hour',now())`,
      [randomUUID(), dept, actor, customer],
      '23514',
    );
    await rejects(
      'wrong draft category',
      `INSERT INTO upload_drafts(id,department_id,actor_user_id,internal_actor_user_id,owner_type,owner_id,category,purpose,original_filename,declared_mime_type,expires_at,updated_at)
      VALUES ($1,$2,$3,$3,'CUSTOMER',$4,'CUSTOMER_IDENTITY','CUSTOMER_AGREEMENT','test.pdf','application/pdf',now() + interval '1 hour',now())`,
      [randomUUID(), dept, actor, customer],
      '23514',
    );
    await rejects(
      'wrong reference purpose',
      `INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,material_id,content_version_id)
      VALUES ($1,$2,'customer_agreement_version',$3,'OTHER',$4,$5)`,
      [randomUUID(), dept, version, randomUUID(), randomUUID()],
      '23514',
    );
    await rejects(
      'wrong reference type',
      `INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,material_id,content_version_id,action_event_id)
      VALUES ($1,$2,'OTHER',$3,'CUSTOMER_AGREEMENT',$4,$5,$6)`,
      [randomUUID(), dept, version, randomUUID(), randomUUID(), audit],
      '23514',
    );
    await rejects(
      'invalid current pointer',
      'UPDATE customer_agreements SET current_version_id=NULL WHERE id=$1',
      [agreement],
      '23514',
      true,
    );
    return {
      checks,
      migrationCount: names.filter((name) => name <= labelGuard).length,
    };
  } finally {
    if (created) {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.query('RESET search_path').catch(() => undefined);
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
    await client.end();
  }
}
