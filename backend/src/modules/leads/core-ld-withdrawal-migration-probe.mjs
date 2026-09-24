import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { captureTestEnvironment } from '../../../../scripts/test-environment.mjs';

const root = resolve(import.meta.dirname, '../../../..');
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const environment = captureTestEnvironment(root, { pnpmVersion: '11.27.0' });
const schema = `ld007_probe_${randomBytes(8).toString('hex')}`;
const upgradeSchema = `ld007_upgrade_${randomBytes(8).toString('hex')}`;
const client = new Client({
  connectionString: environment.childEnvironment.DATABASE_URL,
});
const migrationRoot = resolve(root, 'backend/prisma/migrations');
const migrations = readdirSync(migrationRoot)
  .filter((name) => /^\d{14}_/.test(name))
  .sort();

async function run() {
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  try {
    await client.query(`SET search_path TO "${schema}"`);
    await applyMigrations(migrations);
    console.log('empty migration chain passed:', migrations.length);
    await client.query(`CREATE SCHEMA "${upgradeSchema}"`);
    await client.query(`SET search_path TO "${upgradeSchema}"`);
    await applyMigrations(migrations.filter((name) => name < '20260923012000'));
    await seedPreviousSchema();
    await applyMigrations(
      migrations.filter(
        (name) => name === '20260923012000_add_lead_withdrawal_actions',
      ),
    );
    await client.query(
      'CREATE TABLE lead_withdrawal_applications (probe integer)',
    );
    let failureObserved = false;
    try {
      await applyMigrations(
        migrations.filter(
          (name) => name === '20260923013000_add_lead_withdrawal_history',
        ),
      );
    } catch (error) {
      if (!error.message.includes('already exists')) throw error;
      failureObserved = true;
      await client.query('ROLLBACK');
    }
    if (!failureObserved)
      throw new Error('failure rollback probe did not fail');
    const rolledBack = await client.query(
      `SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema=$1 AND table_name='leads' AND column_name='active_review_decision_id'`,
      [upgradeSchema],
    );
    if (rolledBack.rows[0].count !== 0)
      throw new Error('failed migration left the pointer column behind');
    await client.query('DROP TABLE lead_withdrawal_applications');
    await applyMigrations(
      migrations.filter(
        (name) => name === '20260923013000_add_lead_withdrawal_history',
      ),
    );
    await applyMigrations(
      migrations.filter(
        (name) => name === '20260923014000_harden_lead_withdrawal_reason',
      ),
    );
    await assertUpgrade();
    await applyMigrations(
      migrations.filter(
        (name) => name >= '20260924010000' && name <= '20260924012000',
      ),
    );
    await applyMigrations(
      migrations.filter((name) => name === '20260924013000_add_notary_actions'),
    );
    await client.query('CREATE TABLE notary_offices (probe integer)');
    let notaryFailureObserved = false;
    try {
      await applyMigrations(
        migrations.filter(
          (name) => name === '20260924014000_add_notary_handoff',
        ),
      );
    } catch (error) {
      if (!error.message.includes('already exists')) throw error;
      notaryFailureObserved = true;
      await client.query('ROLLBACK');
    }
    if (!notaryFailureObserved)
      throw new Error('notary migration rollback probe did not fail');
    const partialNotary = await client.query(
      `SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema=$1 AND table_name='notary_matters'`,
      [upgradeSchema],
    );
    if (partialNotary.rows[0].count !== 0)
      throw new Error('failed notary migration left a partial matter table');
    await client.query('DROP TABLE notary_offices');
    await applyMigrations(
      migrations.filter((name) => name >= '20260924014000'),
    );
    await assertEvidenceUpgrade();
    await assertNotaryUpgrade();
    console.log('previous-schema upgrade and constraints passed');
  } finally {
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    await client.query(`DROP SCHEMA IF EXISTS "${upgradeSchema}" CASCADE`);
    await client.end();
  }
}

async function applyMigrations(names) {
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

const ids = {
  department: '11111111-1111-4111-8111-111111111111',
  operator: '22222222-2222-4222-8222-222222222222',
  client: '33333333-3333-4333-8333-333333333333',
  clientB: '33333333-3333-4333-8333-333333333334',
  binding: '44444444-4444-4444-8444-444444444444',
  bindingB: '44444444-4444-4444-8444-444444444445',
  customerA: '55555555-5555-4555-8555-555555555555',
  customerB: '66666666-6666-4666-8666-666666666666',
  rights: '77777777-7777-4777-8777-777777777777',
  leadA: '88888888-8888-4888-8888-888888888888',
  leadB: '99999999-9999-4999-8999-999999999999',
  decisionA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  decisionB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  receiptA: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  receiptB: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  application: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  confirmation: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
};

async function seedPreviousSchema() {
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO departments(id,name,updated_at) VALUES ($1,'Probe',now())`,
      [ids.department],
    );
    await client.query(
      `INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,'probe-operator','Probe Operator',now())`,
      [ids.operator],
    );
    await client.query(
      `INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,'probe-client','Probe Client','CLIENT',now())`,
      [ids.client],
    );
    await client.query(
      `INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,'probe-client-b','Probe Client B','CLIENT',now())`,
      [ids.clientB],
    );
    await client.query(
      `INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES (gen_random_uuid(),$1,$2,now())`,
      [ids.operator, ids.department],
    );
    await client.query(
      `INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at) VALUES ($1,'Probe A','probe a',$3,$4,now()),($2,'Probe B','probe b',$3,$4,now())`,
      [ids.customerA, ids.customerB, ids.department, ids.operator],
    );
    await client.query(
      `INSERT INTO customer_account_bindings(id,user_id,customer_id,department_id,updated_at) VALUES ($1,$2,$3,$4,now())`,
      [ids.binding, ids.client, ids.customerA, ids.department],
    );
    await client.query(
      `INSERT INTO customer_account_bindings(id,user_id,customer_id,department_id,updated_at) VALUES ($1,$2,$3,$4,now())`,
      [ids.bindingB, ids.clientB, ids.customerB, ids.department],
    );
    await client.query(
      `INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,'Probe Rights',$2,now())`,
      [ids.rights, ids.department],
    );
    await client.query(
      `INSERT INTO leads(id,department_id,business_no,customer_id,rights_holder_id,responsible_user_id,status,case_type,source,platform,found_at,shop_name,need_disclose,version,pushed_at,pushed_by_user_id,updated_at) VALUES ($1,$3,'P-A',$4,$6,$7,'ARCHIVED','CIVIL','ONLINE','TAOBAO',now(),'Shop A',false,3,now(),$7,now()),($2,$3,'P-B',$5,$6,$7,'WAITING_EVIDENCE_DECISION','CIVIL','ONLINE','TAOBAO',now(),'Shop B',false,3,now(),$7,now())`,
      [
        ids.leadA,
        ids.leadB,
        ids.department,
        ids.customerA,
        ids.customerB,
        ids.rights,
        ids.operator,
      ],
    );
    await client.query(
      `INSERT INTO lead_review_decisions(id,department_id,lead_id,customer_id,reviewer_user_id,customer_account_binding_id,reviewer_display_name_snapshot,result,reason,archive_type,archived_at,from_version,to_version) VALUES ($1,$3,$4,$6,$8,$10,'Probe Client','NO_INFRINGEMENT','Old reason','NO_INFRINGEMENT',now(),2,3),($2,$3,$5,$7,$9,$11,'Probe Client B','INFRINGEMENT',NULL,NULL,NULL,2,3)`,
      [
        ids.decisionA,
        ids.decisionB,
        ids.department,
        ids.leadA,
        ids.leadB,
        ids.customerA,
        ids.customerB,
        ids.client,
        ids.clientB,
        ids.binding,
        ids.bindingB,
      ],
    );
    await client.query(
      `INSERT INTO client_lead_review_receipts(id,department_id,actor_user_id,customer_account_binding_id,action,idempotency_key,request_fingerprint,result_lead_id,result_lead_version,review_decision_id,result_snapshot) VALUES ($1,$3,$4,$6,'client.lead.review','old-a',repeat('a',64),$8,3,$10,'{}'),($2,$3,$5,$7,'client.lead.review','old-b',repeat('b',64),$9,3,$11,'{}')`,
      [
        ids.receiptA,
        ids.receiptB,
        ids.department,
        ids.client,
        ids.clientB,
        ids.binding,
        ids.bindingB,
        ids.leadA,
        ids.leadB,
        ids.decisionA,
        ids.decisionB,
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function rejects(sql, parameters, expectedCode) {
  await client.query('SAVEPOINT negative_probe');
  try {
    await client.query(sql, parameters);
    throw new Error(
      `negative probe unexpectedly succeeded: ${sql.slice(0, 60)}`,
    );
  } catch (error) {
    if (error.code !== expectedCode) throw error;
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT negative_probe');
  }
}

async function assertUpgrade() {
  const result = await client.query(
    `SELECT l.id, l.active_review_decision_id, d.result FROM leads l JOIN lead_review_decisions d ON d.id=l.active_review_decision_id ORDER BY l.id`,
  );
  if (
    result.rowCount !== 2 ||
    result.rows[0].active_review_decision_id !== ids.decisionA ||
    result.rows[1].active_review_decision_id !== ids.decisionB
  )
    throw new Error('old decisions were not backfilled exactly');
  const receipts = await client.query(
    `SELECT count(*)::int AS count FROM client_lead_review_receipts`,
  );
  if (receipts.rows[0].count !== 2)
    throw new Error('old receipts were not preserved');
  await client.query('BEGIN');
  try {
    await client.query(
      `UPDATE leads SET active_review_decision_id=NULL WHERE id=$1`,
      [ids.leadB],
    );
    await rejects(
      `UPDATE leads SET active_review_decision_id=$1 WHERE id=$2`,
      [ids.decisionB, ids.leadA],
      '23503',
    );
    await client.query(
      `UPDATE leads SET active_review_decision_id=$1 WHERE id=$2`,
      [ids.decisionB, ids.leadB],
    );
    await rejects(
      `INSERT INTO lead_withdrawal_applications(id,original_decision_id,lead_id,customer_id,department_id,applicant_user_id,reason,from_version,to_version,idempotency_key,request_fingerprint,result_snapshot) VALUES ($1,$2,$3,$4,$5,$6,'Reason',3,4,'bad',repeat('a',64),'{}')`,
      [
        ids.application,
        ids.decisionB,
        ids.leadA,
        ids.customerA,
        ids.department,
        ids.operator,
      ],
      '23503',
    );
    await rejects(
      `INSERT INTO lead_withdrawal_applications(id,original_decision_id,lead_id,customer_id,department_id,applicant_user_id,reason,from_version,to_version,idempotency_key,request_fingerprint,result_snapshot) VALUES ($1,$2,$3,$4,$5,$6,' ',3,4,'blank',repeat('a',64),'{}')`,
      [
        ids.application,
        ids.decisionA,
        ids.leadA,
        ids.customerA,
        ids.department,
        ids.operator,
      ],
      '23514',
    );
    await rejects(
      `INSERT INTO lead_withdrawal_applications(id,original_decision_id,lead_id,customer_id,department_id,applicant_user_id,reason,from_version,to_version,idempotency_key,request_fingerprint,result_snapshot) VALUES ($1,$2,$3,$4,$5,$6,E'\t',3,4,'tab-blank',repeat('a',64),'{}')`,
      [
        ids.application,
        ids.decisionA,
        ids.leadA,
        ids.customerA,
        ids.department,
        ids.operator,
      ],
      '23514',
    );
    await rejects(
      `INSERT INTO lead_withdrawal_applications(id,original_decision_id,lead_id,customer_id,department_id,applicant_user_id,reason,from_version,to_version,idempotency_key,request_fingerprint,result_snapshot) VALUES ($1,$2,$3,$4,$5,$6,repeat('x',5001),3,4,'long',repeat('a',64),'{}')`,
      [
        ids.application,
        ids.decisionA,
        ids.leadA,
        ids.customerA,
        ids.department,
        ids.operator,
      ],
      '23514',
    );
    await client.query(
      `INSERT INTO lead_withdrawal_applications(id,original_decision_id,lead_id,customer_id,department_id,applicant_user_id,reason,from_version,to_version,idempotency_key,request_fingerprint,result_snapshot) VALUES ($1,$2,$3,$4,$5,$6,'Reason',3,4,'good',repeat('a',64),'{}')`,
      [
        ids.application,
        ids.decisionA,
        ids.leadA,
        ids.customerA,
        ids.department,
        ids.operator,
      ],
    );
    await rejects(
      `INSERT INTO lead_withdrawal_applications(id,original_decision_id,lead_id,customer_id,department_id,applicant_user_id,reason,from_version,to_version,idempotency_key,request_fingerprint,result_snapshot) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'Reason',3,4,'duplicate',repeat('a',64),'{}')`,
      [ids.decisionA, ids.leadA, ids.customerA, ids.department, ids.operator],
      '23505',
    );
    await rejects(
      `UPDATE lead_withdrawal_applications SET reason='Changed' WHERE id=$1`,
      [ids.application],
      '55000',
    );
    await rejects(
      `DELETE FROM lead_withdrawal_applications WHERE id=$1`,
      [ids.application],
      '55000',
    );
    await rejects(
      `INSERT INTO lead_withdrawal_confirmations(id,application_id,original_decision_id,lead_id,customer_id,department_id,actor_user_id,customer_account_binding_id,from_version,to_version,idempotency_key,request_fingerprint,result_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,4,5,'bad',repeat('a',64),'{}')`,
      [
        ids.confirmation,
        ids.application,
        ids.decisionA,
        ids.leadA,
        ids.customerB,
        ids.department,
        ids.client,
        ids.binding,
      ],
      '23503',
    );
    await rejects(
      `INSERT INTO lead_withdrawal_confirmations(id,application_id,original_decision_id,lead_id,customer_id,department_id,actor_user_id,customer_account_binding_id,from_version,to_version,idempotency_key,request_fingerprint,result_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,4,5,'bad-binding',repeat('a',64),'{}')`,
      [
        ids.confirmation,
        ids.application,
        ids.decisionA,
        ids.leadA,
        ids.customerA,
        ids.department,
        ids.clientB,
        ids.bindingB,
      ],
      '23503',
    );
    await client.query(
      `INSERT INTO lead_withdrawal_confirmations(id,application_id,original_decision_id,lead_id,customer_id,department_id,actor_user_id,customer_account_binding_id,from_version,to_version,idempotency_key,request_fingerprint,result_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,4,5,'good',repeat('a',64),'{}')`,
      [
        ids.confirmation,
        ids.application,
        ids.decisionA,
        ids.leadA,
        ids.customerA,
        ids.department,
        ids.client,
        ids.binding,
      ],
    );
    await rejects(
      `INSERT INTO lead_withdrawal_confirmations(id,application_id,original_decision_id,lead_id,customer_id,department_id,actor_user_id,customer_account_binding_id,from_version,to_version,idempotency_key,request_fingerprint,result_snapshot) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,4,5,'duplicate',repeat('a',64),'{}')`,
      [
        ids.application,
        ids.decisionA,
        ids.leadA,
        ids.customerA,
        ids.department,
        ids.client,
        ids.binding,
      ],
      '23505',
    );
    await rejects(
      `DELETE FROM lead_withdrawal_confirmations WHERE id=$1`,
      [ids.confirmation],
      '55000',
    );
    await rejects(
      `UPDATE lead_withdrawal_confirmations SET idempotency_key='changed' WHERE id=$1`,
      [ids.confirmation],
      '55000',
    );
    await client.query(
      `UPDATE leads SET active_review_decision_id=NULL, status='WAITING_REVIEW', version=5 WHERE id=$1`,
      [ids.leadA],
    );
    const nextDecision = '12121212-1212-4212-8212-121212121212';
    await client.query(
      `INSERT INTO lead_review_decisions(id,department_id,lead_id,customer_id,reviewer_user_id,customer_account_binding_id,reviewer_display_name_snapshot,result,reason,archive_type,archived_at,from_version,to_version) VALUES ($1,$2,$3,$4,$5,$6,'Probe Client','INFRINGEMENT',NULL,NULL,NULL,5,6)`,
      [
        nextDecision,
        ids.department,
        ids.leadA,
        ids.customerA,
        ids.client,
        ids.binding,
      ],
    );
    await client.query(
      `UPDATE leads SET active_review_decision_id=$1, status='WAITING_EVIDENCE_DECISION', version=6 WHERE id=$2`,
      [nextDecision, ids.leadA],
    );
    const rounds = await client.query(
      `SELECT count(*)::int AS count FROM lead_review_decisions WHERE lead_id=$1`,
      [ids.leadA],
    );
    if (rounds.rows[0].count !== 2)
      throw new Error('second review round was not preserved');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function assertEvidenceUpgrade() {
  const oldFacts = await client.query(
    `SELECT (SELECT count(*)::int FROM lead_review_decisions) AS decisions,
            (SELECT count(*)::int FROM client_lead_review_receipts) AS receipts,
            (SELECT count(*)::int FROM lead_withdrawal_applications) AS applications`,
  );
  if (
    oldFacts.rows[0].decisions !== 3 ||
    oldFacts.rows[0].receipts !== 2 ||
    oldFacts.rows[0].applications !== 1
  )
    throw new Error('upgrade changed pre-existing review or withdrawal facts');
  await client.query('BEGIN');
  try {
    const insert = `INSERT INTO lead_evidence_decisions
      (id,original_review_decision_id,lead_id,customer_id,department_id,actor_user_id,
       actor_display_name_snapshot,result,reason,archive_type,decided_at,archived_at,from_version,to_version)
      VALUES ($1,$2,$3,$4,$5,$6,'Operator Original','NO_EVIDENCE',$7,'NO_EVIDENCE',now(),now(),6,7)`;
    const factId = '13131313-1313-4313-8313-131313131313';
    await rejects(
      insert,
      [
        factId,
        ids.decisionA,
        ids.leadA,
        ids.customerA,
        ids.department,
        ids.operator,
        'Bad review',
      ],
      '23503',
    );
    await rejects(
      insert,
      [
        factId,
        ids.decisionB,
        ids.leadA,
        ids.customerA,
        ids.department,
        ids.operator,
        'Wrong lead',
      ],
      '23503',
    );
    await rejects(
      insert,
      [
        factId,
        '12121212-1212-4212-8212-121212121212',
        ids.leadA,
        ids.customerB,
        ids.department,
        ids.operator,
        'Wrong enterprise',
      ],
      '23503',
    );
    await rejects(
      insert,
      [
        factId,
        '12121212-1212-4212-8212-121212121212',
        ids.leadA,
        ids.customerA,
        ids.department,
        ids.operator,
        ' ',
      ],
      '23514',
    );
    await rejects(
      insert,
      [
        factId,
        '12121212-1212-4212-8212-121212121212',
        ids.leadA,
        ids.customerA,
        ids.department,
        ids.operator,
        'x'.repeat(5001),
      ],
      '23514',
    );
    await client.query(insert, [
      factId,
      '12121212-1212-4212-8212-121212121212',
      ids.leadA,
      ids.customerA,
      ids.department,
      ids.operator,
      'Valid reason',
    ]);
    await rejects(
      `UPDATE lead_evidence_decisions SET reason='changed' WHERE id=$1`,
      [factId],
      '55000',
    );
    await rejects(
      `DELETE FROM lead_evidence_decisions WHERE id=$1`,
      [factId],
      '55000',
    );
    const archive = await client.query(
      `SELECT result,reason,actor_display_name_snapshot,archive_type FROM lead_evidence_decisions WHERE id=$1`,
      [factId],
    );
    if (
      archive.rows[0]?.result !== 'NO_EVIDENCE' ||
      archive.rows[0]?.reason !== 'Valid reason' ||
      archive.rows[0]?.actor_display_name_snapshot !== 'Operator Original' ||
      archive.rows[0]?.archive_type !== 'NO_EVIDENCE'
    )
      throw new Error('evidence archive facts were not preserved');
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function assertNotaryUpgrade() {
  const oldFacts = await client.query(
    `SELECT (SELECT count(*)::int FROM lead_review_decisions) AS decisions,
            (SELECT count(*)::int FROM client_lead_review_receipts) AS receipts,
            (SELECT count(*)::int FROM lead_withdrawal_applications) AS applications`,
  );
  if (
    oldFacts.rows[0].decisions !== 3 ||
    oldFacts.rows[0].receipts !== 2 ||
    oldFacts.rows[0].applications !== 1
  )
    throw new Error('notary upgrade changed historical lead facts');
  await client.query('BEGIN');
  try {
    const office = '14141414-1414-4414-8414-141414141414';
    const matter = '15151515-1515-4515-8515-151515151515';
    const product = '16161616-1616-4616-8616-161616161616';
    const otherProduct = '17171717-1717-4717-8717-171717171717';
    await client.query(
      `INSERT INTO notary_offices(id,department_id,name,created_by_user_id) VALUES ($1,$2,'Probe Notary',$3)`,
      [office, ids.department, ids.operator],
    );
    await client.query(
      `INSERT INTO lead_products(id,lead_id,position,title,quantity,unit_price,comment_count,estimated_amount) VALUES ($1,$2,1,'Probe A',1,10,0,10),($3,$4,1,'Probe B',1,10,0,10)`,
      [product, ids.leadA, otherProduct, ids.leadB],
    );
    const insert = `INSERT INTO notary_matters(id,business_no,department_id,source_lead_id,customer_id,rights_holder_id,responsible_user_id,notary_office_id,evidence_mode,batch_purpose,source_snapshot,created_by_user_id,from_lead_version,to_lead_version)
      VALUES ($1,'NT-20260924-001',$2,$3,$4,$5,$6,$7,'ONLINE_PURCHASE','Probe batch','{}',$6,6,7)`;
    await rejects(
      insert,
      [
        matter,
        ids.department,
        ids.leadA,
        ids.customerB,
        ids.rights,
        ids.operator,
        office,
      ],
      '23503',
    );
    await client.query(insert, [
      matter,
      ids.department,
      ids.leadA,
      ids.customerA,
      ids.rights,
      ids.operator,
      office,
    ]);
    await rejects(
      `INSERT INTO notary_matter_products(notary_matter_id,source_lead_id,lead_product_id) VALUES ($1,$2,$3)`,
      [matter, ids.leadA, otherProduct],
      '23503',
    );
    await client.query(
      `INSERT INTO notary_matter_products(notary_matter_id,source_lead_id,lead_product_id) VALUES ($1,$2,$3)`,
      [matter, ids.leadA, product],
    );
    await rejects(
      `UPDATE notary_matters SET batch_purpose='Changed' WHERE id=$1`,
      [matter],
      '55000',
    );
    await rejects(
      `DELETE FROM notary_matter_products WHERE notary_matter_id=$1`,
      [matter],
      '55000',
    );
    const facts = await client.query(
      `SELECT count(*)::int AS count FROM notary_matters WHERE source_lead_id=$1 AND customer_id=$2`,
      [ids.leadA, ids.customerA],
    );
    if (facts.rows[0].count !== 1)
      throw new Error('notary handoff source link missing');
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
async function checkTestLedger() {
  await client.connect();
  try {
    for (const name of migrations.filter(
      (value) => value >= '20260923012000',
    )) {
      const sql = readFileSync(resolve(migrationRoot, name, 'migration.sql'));
      const checksum = createHash('sha256').update(sql).digest('hex');
      const result = await client.query(
        'SELECT checksum FROM public._prisma_migrations WHERE migration_name=$1 AND finished_at IS NOT NULL',
        [name],
      );
      if (result.rowCount !== 1 || result.rows[0].checksum !== checksum) {
        throw new Error(`test migration ledger mismatch: ${name}`);
      }
    }
    console.log('isolated test migration ledger checksums match');
  } finally {
    await client.end();
  }
}

(process.argv.includes('--check-test-ledger')
  ? checkTestLedger()
  : run()
).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
