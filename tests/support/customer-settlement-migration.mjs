import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const migrations = resolve(root, 'backend/prisma/migrations');
const names = readdirSync(migrations)
  .filter((name) => /^\d{14}_/u.test(name))
  .sort();
const prior = '20261009055000_seal_customer_document_audits_and_heads';
const enumMigration = '20261010010000_customer_settlement_enums';
const factsMigration = '20261010011000_customer_settlement_facts';
const receiptGuardMigration =
  '20261010012000_guard_customer_settlement_receipts';
const deletionGuardMigration = '20261010013000_restore_customer_deletion_guard';
const sql = (name) =>
  readFileSync(resolve(migrations, name, 'migration.sql'), 'utf8');

export async function verifyCustomerSettlementMigration() {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('CU008 migration probe requires NODE_ENV=test');
  validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL, {
    allowRandomPort: true,
  });
  if (
    names.at(-4) !== enumMigration ||
    names.at(-3) !== factsMigration ||
    names.at(-2) !== receiptGuardMigration ||
    names.at(-1) !== deletionGuardMigration
  )
    throw new Error('CU008 migration suffix changed');
  const schema = `cu008_settlement_${randomUUID().replaceAll('-', '')}`;
  if (!/^cu008_settlement_[0-9a-f]{32}$/u.test(schema))
    throw new Error('unsafe temporary schema');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  let created = false;
  const checks = [];
  async function rejects(
    label,
    query,
    params,
    expected = '23514',
    setup = null,
  ) {
    await client.query('BEGIN');
    try {
      if (setup) await setup();
      await client.query(query, params);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      throw new Error(`${label} unexpectedly succeeded`);
    } catch (error) {
      if (error.code !== expected) throw error;
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
      throw new Error('CU008 requires isolated test public');
    const previous = (
      await client.query(
        'SELECT checksum FROM _prisma_migrations WHERE migration_name=$1 AND finished_at IS NOT NULL',
        [prior],
      )
    ).rows;
    if (
      previous.length !== 1 ||
      previous[0].checksum !==
        createHash('sha256').update(sql(prior)).digest('hex')
    )
      throw new Error('108 checksum changed');
    checks.push('108 checksum');
    await client.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await client.query(`SET search_path TO "${schema}"`);
    for (const name of names.filter((name) => name <= prior))
      await client.query(sql(name));
    const dept = randomUUID(),
      actor = randomUUID(),
      customer = randomUUID();
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
      [dept, 'CU008 migration'],
    );
    await client.query(
      'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
      [actor, 'cu008-migration', 'CU008 actor'],
    );
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [randomUUID(), actor, dept],
    );
    await client.query(
      'INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at) VALUES ($1,$2,$3,$4,$5,now())',
      [customer, 'CU008 customer', 'cu008 customer', dept, actor],
    );
    const oldContact = randomUUID();
    await client.query(
      `INSERT INTO customer_contacts(id,customer_id,department_id,name,phone,origin,updated_at)
      VALUES ($1,$2,$3,'旧联系人','13800138000','MANUAL',now())`,
      [oldContact, customer, dept],
    );
    const oldAgreement = randomUUID(),
      oldAgreementVersion = randomUUID(),
      oldAgreementAudit = randomUUID();
    const oldInvoice = randomUUID(),
      oldInvoiceVersion = randomUUID(),
      oldInvoiceAudit = randomUUID();
    const oldReceipt = randomUUID();
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO customer_agreements(id,customer_id,department_id) VALUES ($1,$2,$3)',
      [oldAgreement, customer, dept],
    );
    await client.query(
      "INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action,details,created_at) VALUES ($1,$2,$3,'customer_agreement',$4,'customer.agreement.created','{}'::jsonb,now())",
      [oldAgreementAudit, dept, actor, oldAgreement],
    );
    await client.query(
      `INSERT INTO customer_agreement_versions(id,agreement_id,customer_id,department_id,version,title,validity_mode,content_version_ids,recorded_by_user_id,audit_event_id)
      VALUES ($1,$2,$3,$4,1,'旧协议','UNKNOWN','{}'::uuid[],$5,$6)`,
      [
        oldAgreementVersion,
        oldAgreement,
        customer,
        dept,
        actor,
        oldAgreementAudit,
      ],
    );
    await client.query(
      'UPDATE customer_agreements SET current_version_id=$1,updated_at=now() WHERE id=$2',
      [oldAgreementVersion, oldAgreement],
    );
    await client.query(
      'INSERT INTO customer_invoice_profiles(id,customer_id,department_id) VALUES ($1,$2,$3)',
      [oldInvoice, customer, dept],
    );
    await client.query(
      "INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action,details,created_at) VALUES ($1,$2,$3,'customer_invoice_profile',$4,'customer.invoice.created','{}'::jsonb,now())",
      [oldInvoiceAudit, dept, actor, oldInvoice],
    );
    await client.query(
      `INSERT INTO customer_invoice_profile_versions(id,profile_id,customer_id,department_id,version,invoice_type,recorded_by_user_id,audit_event_id)
      VALUES ($1,$2,$3,$4,1,'旧开票资料',$5,$6)`,
      [oldInvoiceVersion, oldInvoice, customer, dept, actor, oldInvoiceAudit],
    );
    await client.query(
      'UPDATE customer_invoice_profiles SET current_version_id=$1,updated_at=now() WHERE id=$2',
      [oldInvoiceVersion, oldInvoice],
    );
    await client.query(
      `INSERT INTO customer_agreement_invoice_receipts(id,department_id,actor_user_id,action,idempotency_key,request_fingerprint,customer_id,result_snapshot)
      VALUES ($1,$2,$3,'INVOICE_CREATE','old-invoice-key',repeat('a',64),$4,'{"old":"receipt"}'::jsonb)`,
      [oldReceipt, dept, actor, customer],
    );
    await client.query('COMMIT');
    await client.query(sql(enumMigration));
    try {
      await client.query(
        sql(factsMigration).replace(/COMMIT;\s*$/u, 'SELECT 1/0; COMMIT;'),
      );
      throw new Error(
        'injected facts migration failure unexpectedly succeeded',
      );
    } catch (error) {
      if (error.code !== '22012') throw error;
      await client.query('ROLLBACK');
    }
    if (
      (
        await client.query(
          "SELECT to_regclass('customer_settlement_records') AS rel",
        )
      ).rows[0].rel !== null
    )
      throw new Error('failed migration was not atomic');
    checks.push('110 failure atomic');
    await client.query(sql(factsMigration));
    checks.push('110 repair retry');
    await client.query(sql(receiptGuardMigration));
    await client.query(sql(deletionGuardMigration));
    const deletionBody = (
      await client.query(
        "SELECT pg_get_functiondef('customer_draft_deletion_guard()'::regprocedure) AS body",
      )
    ).rows[0].body;
    for (const required of [
      'OLD.profile_status',
      'OLD.admitted_at',
      'OLD.ever_admitted',
      'customer_contacts',
      'customer_agreements',
      'customer_invoice_profiles',
      'customer_settlement_records',
      'customer_settlement_versions',
      'customer_settlement_receipts',
    ]) {
      if (!deletionBody.includes(required))
        throw new Error(`CU008 deletion guard lost ${required}`);
    }
    checks.push(
      '112 preserves latest deletion guard and adds settlement associations',
    );
    const retained = (
      await client.query(
        `SELECT
      (SELECT count(*)::int FROM customer_contacts WHERE id=$1) AS contacts,
      (SELECT count(*)::int FROM customer_agreements WHERE id=$2) AS agreements,
      (SELECT count(*)::int FROM customer_invoice_profiles WHERE id=$3) AS invoices,
      (SELECT result_snapshot FROM customer_agreement_invoice_receipts WHERE id=$4) AS receipt`,
        [oldContact, oldAgreement, oldInvoice, oldReceipt],
      )
    ).rows[0];
    if (
      retained.contacts !== 1 ||
      retained.agreements !== 1 ||
      retained.invoices !== 1 ||
      retained.receipt?.old !== 'receipt'
    )
      throw new Error('108 contact/document/receipt facts changed by CU008');
    checks.push('108 contact agreement invoice receipt preserved');
    const empty = (
      await client.query(
        'SELECT count(*)::int AS n FROM customer_settlement_records',
      )
    ).rows[0].n;
    if (empty !== 0) throw new Error('historical customer was backfilled');
    checks.push('no historical backfill');
    const columns = (
      await client.query(`SELECT attname,atttypid::regtype::text AS type,atttypmod
      FROM pg_attribute WHERE attrelid='customer_settlement_versions'::regclass
      AND attname IN ('settlement_amount','invoice_amount','received_amount') ORDER BY attname`)
    ).rows;
    if (
      columns.length !== 3 ||
      columns.some(
        (column) => column.type !== 'numeric' || column.atttypmod !== -1,
      )
    )
      throw new Error('settlement numeric typmod mismatch');
    checks.push('numeric columns without typmod');
    const record = randomUUID(),
      version1 = randomUUID(),
      audit1 = randomUUID();
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO customer_settlement_records(id,customer_id,department_id) VALUES ($1,$2,$3)',
      [record, customer, dept],
    );
    await client.query(
      "INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action,details,created_at) VALUES ($1,$2,$3,'customer_settlement',$4,'customer.settlement.register','{}'::jsonb,now())",
      [audit1, dept, actor, record],
    );
    await client.query(
      `INSERT INTO customer_settlement_versions(id,record_id,customer_id,department_id,version,action,settlement_date,settlement_amount,recorded_by_user_id,audit_event_id)
      VALUES ($1,$2,$3,$4,1,'REGISTER','2026-10-01',0,$5,$6)`,
      [version1, record, customer, dept, actor, audit1],
    );
    await client.query(
      'UPDATE customer_settlement_records SET current_version_id=$1,updated_at=now() WHERE id=$2',
      [version1, record],
    );
    await client.query('COMMIT');
    checks.push('zero v1 register');
    const otherCustomer = randomUUID(),
      otherRecord = randomUUID(),
      otherVersion = randomUUID(),
      otherAudit = randomUUID();
    await client.query(
      'INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at) VALUES ($1,$2,$3,$4,$5,now())',
      [otherCustomer, 'CU008 other', 'cu008 other', dept, actor],
    );
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO customer_settlement_records(id,customer_id,department_id) VALUES ($1,$2,$3)',
      [otherRecord, otherCustomer, dept],
    );
    await client.query(
      "INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action,details,created_at) VALUES ($1,$2,$3,'customer_settlement',$4,'customer.settlement.register','{}'::jsonb,now())",
      [otherAudit, dept, actor, otherRecord],
    );
    await client.query(
      `INSERT INTO customer_settlement_versions(id,record_id,customer_id,department_id,version,action,settlement_date,settlement_amount,recorded_by_user_id,audit_event_id)
      VALUES ($1,$2,$3,$4,1,'REGISTER','2026-10-01',1,$5,$6)`,
      [otherVersion, otherRecord, otherCustomer, dept, actor, otherAudit],
    );
    await client.query(
      'UPDATE customer_settlement_records SET current_version_id=$1,updated_at=now() WHERE id=$2',
      [otherVersion, otherRecord],
    );
    await client.query('COMMIT');
    await rejects(
      'cross customer current pointer',
      'UPDATE customer_settlement_records SET version=2,current_version_id=$1 WHERE id=$2',
      [otherVersion, record],
      '23503',
    );
    for (const value of [
      '1.001',
      '1.230',
      '-1',
      '10000000000000000',
      'NaN',
      'Infinity',
      '-Infinity',
    ]) {
      for (const field of [
        'settlement_amount',
        'invoice_amount',
        'received_amount',
      ]) {
        const auditId = randomUUID();
        await rejects(
          `raw INSERT ${field} ${value}`,
          `INSERT INTO customer_settlement_versions(id,record_id,customer_id,department_id,version,action,settlement_date,settlement_amount,invoice_amount,received_amount,correction_reason,recorded_by_user_id,audit_event_id)
          VALUES ($1,$2,$3,$4,2,'CORRECT','2026-10-01',$5,$6,$7,'reason',$8,$9)`,
          [
            randomUUID(),
            record,
            customer,
            dept,
            field === 'settlement_amount' ? value : '0',
            field === 'invoice_amount' ? value : null,
            field === 'received_amount' ? value : null,
            actor,
            auditId,
          ],
          '23514',
          async () => {
            await client.query(
              "INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action,details,created_at) VALUES ($1,$2,$3,'customer_settlement',$4,'customer.settlement.correct','{}'::jsonb,now())",
              [auditId, dept, actor, record],
            );
          },
        );
        await rejects(
          `raw UPDATE ${field} ${value}`,
          `UPDATE customer_settlement_versions SET ${field}=$1 WHERE id=$2`,
          [value, version1],
          '23514',
          async () => {
            await client.query(
              'ALTER TABLE customer_settlement_versions DISABLE TRIGGER USER',
            );
          },
        );
      }
    }
    await rejects(
      'immutable v1',
      'UPDATE customer_settlement_versions SET received_amount=1 WHERE id=$1',
      [version1],
    );
    await rejects(
      'audit action immutable',
      "UPDATE audit_events SET action='tamper' WHERE id=$1",
      [audit1],
    );
    await rejects(
      'head retreat',
      'UPDATE customer_settlement_records SET version=0 WHERE id=$1',
      [record],
    );
    await rejects(
      'version audit mismatch',
      `INSERT INTO customer_settlement_versions(id,record_id,customer_id,department_id,version,action,settlement_date,settlement_amount,correction_reason,recorded_by_user_id,audit_event_id)
      VALUES ($1,$2,$3,$4,2,'CORRECT','2026-10-01',1,'reason',$5,$6)`,
      [randomUUID(), record, customer, dept, actor, audit1],
    );
    const orphanAudit = randomUUID(),
      orphanVersion = randomUUID();
    await client.query('BEGIN');
    try {
      // The v1 transaction is committed above. Keep the record-head trigger
      // immediate so only the version INSERT's deferred trigger is exercised.
      await client.query(
        'SET CONSTRAINTS customer_settlement_record_head IMMEDIATE',
      );
      await client.query(
        "INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action,details,created_at) VALUES ($1,$2,$3,'customer_settlement',$4,'customer.settlement.correct','{}'::jsonb,now())",
        [orphanAudit, dept, actor, record],
      );
      await client.query(
        `INSERT INTO customer_settlement_versions(id,record_id,customer_id,department_id,version,action,settlement_date,settlement_amount,correction_reason,recorded_by_user_id,audit_event_id)
        VALUES ($1,$2,$3,$4,2,'CORRECT','2026-10-01',1,'reason',$5,$6)`,
        [orphanVersion, record, customer, dept, actor, orphanAudit],
      );
      const pending = (
        await client.query(
          `SELECT r.version AS head, max(v.version) AS latest
           FROM customer_settlement_records r
           JOIN customer_settlement_versions v ON v.record_id=r.id
           WHERE r.id=$1 GROUP BY r.version`,
          [record],
        )
      ).rows[0];
      if (pending.head !== 1 || pending.latest !== 2)
        throw new Error('orphan append did not reach deferred head check');
      try {
        await client.query(
          'SET CONSTRAINTS customer_settlement_version_head IMMEDIATE',
        );
        throw new Error('orphan append unexpectedly passed version head');
      } catch (error) {
        if (
          error.code !== '23514' ||
          !error.message.includes('settlement current version is not latest')
        )
          throw error;
      }
    } finally {
      await client.query('ROLLBACK');
    }
    const rolledBack = (
      await client.query(
        `SELECT (SELECT count(*)::int FROM customer_settlement_versions WHERE id=$1) AS versions,
                (SELECT count(*)::int FROM audit_events WHERE id=$2) AS audits`,
        [orphanVersion, orphanAudit],
      )
    ).rows[0];
    if (rolledBack.versions !== 0 || rolledBack.audits !== 0)
      throw new Error('orphan append rollback left version or audit');
    checks.push('orphan append rejected by deferred version head');
    const oldKey = randomUUID();
    await client.query(
      `INSERT INTO customer_settlement_receipts(id,department_id,actor_user_id,action,idempotency_key,request_fingerprint,customer_id,record_id,result_version_id,result_customer_version)
      VALUES ($1,$2,$3,'REGISTER',$4,repeat('a',64),$5,$6,$7,1)`,
      [randomUUID(), dept, actor, oldKey, customer, record, version1],
    );
    await rejects(
      'receipt wrong action',
      `INSERT INTO customer_settlement_receipts(id,department_id,actor_user_id,action,idempotency_key,request_fingerprint,customer_id,record_id,result_version_id,result_customer_version)
      VALUES ($1,$2,$3,'CORRECT',$4,repeat('a',64),$5,$6,$7,1)`,
      [randomUUID(), dept, actor, randomUUID(), customer, record, version1],
    );
    for (const n of [2, 3]) {
      const audit = randomUUID(),
        version = randomUUID();
      await client.query('BEGIN');
      await client.query(
        "INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action,details,created_at) VALUES ($1,$2,$3,'customer_settlement',$4,'customer.settlement.correct','{}'::jsonb,now())",
        [audit, dept, actor, record],
      );
      await client.query(
        `INSERT INTO customer_settlement_versions(id,record_id,customer_id,department_id,version,action,settlement_date,settlement_amount,correction_reason,recorded_by_user_id,audit_event_id)
        VALUES ($1,$2,$3,$4,$5,'CORRECT','2026-10-01',1,'reason',$6,$7)`,
        [version, record, customer, dept, n, actor, audit],
      );
      await client.query(
        'UPDATE customer_settlement_records SET version=$1,current_version_id=$2,updated_at=now() WHERE id=$3',
        [n, version, record],
      );
      await client.query('COMMIT');
    }
    const historical = (
      await client.query(
        'SELECT v.version FROM customer_settlement_receipts r JOIN customer_settlement_versions v ON v.id=r.result_version_id WHERE r.idempotency_key=$1',
        [oldKey],
      )
    ).rows[0]?.version;
    if (historical !== 1)
      throw new Error('old receipt lost historical version');
    checks.push('v1-v2-v3 and old receipt v1');
    await rejects(
      'zero settlement blocks delete',
      'UPDATE customers SET deleted_at=now() WHERE id=$1',
      [customer],
    );
    return { checks, migrationCount: names.length };
  } finally {
    if (created) {
      await client.query('ROLLBACK').catch(() => {});
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
    await client.end();
  }
}
