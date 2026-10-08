import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { captureTestEnvironment } from '../../../../scripts/test-environment.mjs';

const root = resolve(import.meta.dirname, '../../../..');
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const environment = captureTestEnvironment(root, { pnpmVersion: '11.27.0' });
const migrationRoot = resolve(root, 'backend/prisma/migrations');
const target = '20260928040000_add_notary_issuance_decision';
// Freeze the historical schema under test; do not apply later migrations here.
const migrations = readdirSync(migrationRoot)
  .filter((name) => /^\d{14}_/.test(name) && name <= target)
  .sort();
assert.equal(migrations.at(-1), target);

async function run() {
  const client = new Client({
    connectionString: environment.childEnvironment.DATABASE_URL,
  });
  await client.connect();
  const database = (await client.query('SELECT current_database() AS name'))
    .rows[0].name;
  assert.equal(database, 'dev_cor_test');
  try {
    for (const mode of ['empty', 'upgrade']) {
      const schema = `nt004_${mode}_${randomBytes(8).toString('hex')}`;
      await client.query(`CREATE SCHEMA "${schema}"`);
      try {
        await client.query(`SET search_path TO "${schema}"`);
        for (const name of migrations.filter((name) => name < target)) {
          await client.query(
            readFileSync(resolve(migrationRoot, name, 'migration.sql'), 'utf8'),
          );
        }
        const department = randomUUID();
        const user = randomUUID();
        const review = randomUUID();
        let seededMatter = '';
        if (mode === 'upgrade') {
          await client.query(
            'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
            [department, 'NT004 legacy'],
          );
          await client.query(
            'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
            [user, `nt004:${user}`, '旧运营'],
          );
          await client.query(
            'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
            [randomUUID(), user, department],
          );
          const customer = randomUUID();
          const rights = randomUUID();
          const lead = randomUUID();
          const office = randomUUID();
          const matter = randomUUID();
          seededMatter = matter;
          await client.query(
            'INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at) VALUES ($1,$2,$3,$4,$5,now())',
            [customer, 'NT004 customer', 'nt004 customer', department, user],
          );
          await client.query(
            'INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,$2,$3,now())',
            [rights, 'NT004 rights', department],
          );
          await client.query(
            `INSERT INTO leads(id,department_id,business_no,customer_id,rights_holder_id,responsible_user_id,status,case_type,source,platform,found_at,shop_name,need_disclose,version,pushed_at,pushed_by_user_id,updated_at)
            VALUES ($1,$2,'NT004-LEGACY',$3,$4,$5,'TRANSFERRED_TO_NOTARY','CIVIL','ONLINE','TAOBAO',now(),'Probe Shop',false,3,now(),$5,now())`,
            [lead, department, customer, rights, user],
          );
          await client.query(
            'INSERT INTO notary_offices(id,department_id,name,created_by_user_id) VALUES ($1,$2,$3,$4)',
            [office, department, 'NT004 office', user],
          );
          await client.query(
            `INSERT INTO notary_matters(id,business_no,department_id,source_lead_id,customer_id,rights_holder_id,responsible_user_id,notary_office_id,stage,version,evidence_mode,batch_purpose,source_snapshot,created_by_user_id,from_lead_version,to_lead_version)
            VALUES ($1,'NT004-MATTER',$2,$3,$4,$5,$6,$7,'ISSUANCE_DECISION',4,'ONLINE_PURCHASE','Probe','{}',$6,3,4)`,
            [matter, department, lead, customer, rights, user, office],
          );
          await client.query(
            'INSERT INTO notary_matter_opening(matter_id,department_id,recorded_by_user_id,internal_actor_user_id) VALUES ($1,$2,$3,$3)',
            [matter, department, user],
          );
          await client.query(
            `INSERT INTO notary_opening_review_decisions(id,matter_id,department_id,customer_id,actor_user_id,actor_kind,internal_actor_user_id,actor_display_name_snapshot,result,from_version,to_version)
            VALUES ($1,$2,$3,$4,$5,'INTERNAL',$5,'旧运营','INFRINGEMENT',3,4)`,
            [review, matter, department, customer, user],
          );
        }
        const migration = readFileSync(
          resolve(migrationRoot, target, 'migration.sql'),
          'utf8',
        );
        if (mode === 'upgrade') {
          await client.query(
            'CREATE TABLE notary_issuance_decisions(probe integer)',
          );
          await assert.rejects(client.query(migration));
          await client.query('ROLLBACK');
          const beforeRetry = await client.query(
            `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typname='notary_matter_stage'`,
            [schema],
          );
          assert.equal(
            beforeRetry.rows.some((row) => row.enumlabel === 'WAITING_RETURN'),
            false,
          );
          await client.query('DROP TABLE notary_issuance_decisions');
        }
        await client.query(migration);
        const columns = await client.query(
          `SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name IN ('notary_issuance_decisions','notary_issuance_decision_audit_events')`,
          [schema],
        );
        assert.equal(columns.rowCount, 2);
        if (mode === 'upgrade') {
          const row = await client.query(
            'SELECT display_name FROM user_accounts WHERE id=$1',
            [user],
          );
          assert.equal(row.rows[0].display_name, '旧运营');
          const fact = await client.query(
            'SELECT result,from_version,to_version FROM notary_opening_review_decisions WHERE id=$1',
            [review],
          );
          assert.deepEqual(
            fact.rows.map((item) => [
              item.result,
              item.from_version,
              item.to_version,
            ]),
            [['INFRINGEMENT', 3, 4]],
          );
          const issuance = randomUUID();
          await client.query(
            `INSERT INTO notary_issuance_decisions(id,matter_id,department_id,opening_review_decision_id,actor_user_id,actor_display_name_snapshot,decision,from_version,to_version)
            VALUES ($1,$2,$3,$4,$5,'旧运营','ISSUE',4,5)`,
            [issuance, seededMatter, department, review, user],
          );
          await client.query(
            `INSERT INTO notary_issuance_decision_audit_events(id,issuance_decision_id,matter_id,department_id,actor_user_id,decision,matter_version,action)
            VALUES ($1,$2,$3,$4,$5,'ISSUE',5,'notary.issuance.decide.succeeded')`,
            [randomUUID(), issuance, seededMatter, department, user],
          );
          await client.query('BEGIN');
          try {
            await client.query('SAVEPOINT immutable');
            await assert.rejects(
              client.query(
                'UPDATE notary_issuance_decisions SET actor_display_name_snapshot=$1 WHERE id=$2',
                ['changed', issuance],
              ),
              (error) => error.code === '55000',
            );
            await client.query('ROLLBACK TO SAVEPOINT immutable');
            await client.query('SAVEPOINT immutable_audit');
            await assert.rejects(
              client.query(
                'DELETE FROM notary_issuance_decision_audit_events WHERE issuance_decision_id=$1',
                [issuance],
              ),
              (error) => error.code === '55000',
            );
            await client.query('ROLLBACK TO SAVEPOINT immutable_audit');
          } finally {
            await client.query('ROLLBACK');
          }
        }
        const enumRows = await client.query(
          `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typname='notary_matter_stage'`,
          [schema],
        );
        for (const stage of ['WAITING_CERTIFICATE', 'WAITING_RETURN'])
          assert.ok(enumRows.rows.some((row) => row.enumlabel === stage));
        await client.query('BEGIN');
        try {
          await client.query('SAVEPOINT negative');
          await assert.rejects(
            client.query(
              `INSERT INTO notary_issuance_decisions(id,matter_id,department_id,opening_review_decision_id,opening_review_result,actor_user_id,actor_display_name_snapshot,decision,from_version,to_version)
              VALUES ($1,$2,$3,$4,'NO_INFRINGEMENT',$5,'运营','ISSUE',4,5)`,
              [randomUUID(), randomUUID(), department, randomUUID(), user],
            ),
            (error) => error.code === '23514',
          );
          await client.query('ROLLBACK TO SAVEPOINT negative');
        } finally {
          await client.query('ROLLBACK');
        }
        console.log(`NT004 ${mode} migration probe passed`);
      } finally {
        await client.query('SET search_path TO public');
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    }
  } finally {
    await client.end();
  }
}

await run();
