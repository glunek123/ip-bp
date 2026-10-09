import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureTestEnvironment } from '../../scripts/test-environment.mjs';
import { acquireE2eResourceLock } from '../../scripts/run-e2e.mjs';

const root = resolve(import.meta.dirname, '../..');
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const environment = captureTestEnvironment(root, { pnpmVersion: '11.27.0' });
const migrationRoot = resolve(root, 'backend/prisma/migrations');
const target = '20261009030000_customer_cooperation';
const previous = readdirSync(migrationRoot)
  .filter((name) => /^\d{14}_/u.test(name) && name < target)
  .sort();
if (previous.length !== 100)
  throw new Error(
    `Expected 100 supported migrations, found ${previous.length}`,
  );
const schemas = [
  `cu005_empty_${randomBytes(8).toString('hex')}`,
  `cu005_upgrade_${randomBytes(8).toString('hex')}`,
];
const client = new Client({
  connectionString: environment.childEnvironment.DATABASE_URL,
});

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

async function count(sql) {
  return (await client.query(sql)).rows[0].count;
}

async function rejects(sql, params, code, text) {
  await client.query('SAVEPOINT cu005_negative');
  try {
    await client.query(sql, params);
    throw new Error(`${text}: unexpectedly succeeded`);
  } catch (error) {
    if (error.code !== code || !error.message.includes(text)) throw error;
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT cu005_negative');
  }
}

async function seed() {
  const ids = {
    department: randomUUID(),
    actor: randomUUID(),
    target: randomUUID(),
    draft: randomUUID(),
    admitted: randomUUID(),
    holder: randomUUID(),
    link: randomUUID(),
    lead: randomUUID(),
    audit: randomUUID(),
    oldFact: randomUUID(),
    oldReceipt: randomUUID(),
  };
  await client.query(
    "INSERT INTO departments(id,name,updated_at) VALUES ($1,'CU005',now())",
    [ids.department],
  );
  await client.query(
    `INSERT INTO user_accounts(id,external_subject,display_name,updated_at)
     VALUES ($1,$3,'当前运营',now()),($2,$4,'目标运营',now())`,
    [ids.actor, ids.target, `cu005-${ids.actor}`, `cu005-${ids.target}`],
  );
  await client.query(
    `INSERT INTO department_memberships(id,user_id,department_id,updated_at)
     VALUES (gen_random_uuid(),$1,$3,now()),(gen_random_uuid(),$2,$3,now())`,
    [ids.actor, ids.target, ids.department],
  );
  await client.query(
    `INSERT INTO customers(id,name,normalized_name,profile_status,department_id,
       responsible_user_id,version,updated_at)
     VALUES ($1,'维护草稿','维护草稿','DRAFT',$2,$3,1,now())`,
    [ids.draft, ids.department, ids.actor],
  );
  await client.query(
    `INSERT INTO customers(id,name,normalized_name,profile_status,department_id,
       responsible_user_id,version,updated_at,customer_type,identity_type,
       identity_number,normalized_identity_number,admission_contact_name,
       admission_contact_phone,identity_validity_mode,admitted_at)
     VALUES ($1,'已准入客户','已准入客户','ADMITTED',$2,$3,1,now(),
       'ENTERPRISE','BUSINESS_LICENSE','91310000TEST123456','91310000TEST123456',
       '客户联系人','13800138000','LONG_TERM',now())`,
    [ids.admitted, ids.department, ids.actor],
  );
  await client.query(
    `UPDATE customers SET deleted_at=now(),deleted_by_user_id=$2,version=2 WHERE id=$1`,
    [ids.draft, ids.actor],
  );
  await client.query(
    `UPDATE customers SET deleted_at=NULL,deleted_by_user_id=NULL,version=3 WHERE id=$1`,
    [ids.draft],
  );
  await client.query(
    `INSERT INTO rights_holders(id,name,department_id,updated_at)
     VALUES ($1,'权利主体',$2,now())`,
    [ids.holder, ids.department],
  );
  await client.query(
    `INSERT INTO customer_rights_holder_links(id,customer_id,rights_holder_id,department_id)
     VALUES ($1,$2,$3,$4)`,
    [ids.link, ids.admitted, ids.holder, ids.department],
  );
  await client.query(
    `INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action)
     VALUES ($1,$2,$3,'customer',$4,'customer.draft-restored')`,
    [ids.audit, ids.department, ids.actor, ids.draft],
  );
  await client.query(
    `INSERT INTO customer_draft_lifecycle_facts(id,customer_id,department_id,action,actor_user_id,
       from_version,to_version,audit_event_id)
     VALUES ($1,$2,$3,'RESTORE',$4,2,3,$5)`,
    [ids.oldFact, ids.draft, ids.department, ids.actor, ids.audit],
  );
  await client.query(
    `INSERT INTO customer_draft_lifecycle_receipts(id,department_id,actor_user_id,idempotency_key,
       request_fingerprint,action,customer_id,result_snapshot,fact_id)
     VALUES ($1,$2,$3,'old-key',repeat('a',64),'RESTORE',$4,
       jsonb_build_object('id',($4::uuid)::text,'version',3),$5)`,
    [ids.oldReceipt, ids.department, ids.actor, ids.draft, ids.oldFact],
  );
  await leadInsert(ids, ids.admitted, 'legacy', ids.lead);
  return ids;
}

async function leadInsert(ids, customerId, suffix, id = randomUUID()) {
  return client.query(
    `INSERT INTO leads(id,department_id,business_no,customer_id,rights_holder_id,
       responsible_user_id,case_type,source,platform,found_at,shop_name,need_disclose,updated_at)
     VALUES ($6,$1,$2,$3,$4,$5,'CIVIL','ONLINE','TAOBAO',now(),'合法店铺',false,now())`,
    [
      ids.department,
      `CU005-${suffix}-${randomBytes(4).toString('hex')}`,
      customerId,
      ids.holder,
      ids.actor,
      id,
    ],
  );
}

async function run() {
  await client.connect();
  try {
    const database = (await client.query('SELECT current_database() AS name'))
      .rows[0]?.name;
    if (database !== 'dev_cor_test')
      throw new Error('Migration probe requires dev_cor_test');
    for (const schema of schemas) {
      if (!/^cu005_(empty|upgrade)_[a-f0-9]{16}$/u.test(schema))
        throw new Error('Unsafe random schema name');
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      await apply(previous);
      if (schema.includes('_upgrade_')) {
        const ids = await seed();
        const before = {
          customers: await count(
            'SELECT count(*)::int AS count FROM customers',
          ),
          leads: await count('SELECT count(*)::int AS count FROM leads'),
          audits: await count(
            'SELECT count(*)::int AS count FROM audit_events',
          ),
          receipt: (
            await client.query(
              'SELECT to_jsonb(r) AS body FROM customer_draft_lifecycle_receipts r WHERE id=$1',
              [ids.oldReceipt],
            )
          ).rows[0]?.body,
        };
        // A preexisting object forces a late DDL failure. The migration's
        // earlier enum/column/table changes must all roll back.
        await client.query('CREATE TABLE customer_maintenance_facts(id uuid)');
        let failed = false;
        try {
          await apply([target]);
        } catch (error) {
          if (!error.message.includes('already exists')) throw error;
          await client.query('ROLLBACK');
          failed = true;
        }
        if (!failed) throw new Error('Injected DDL failure did not occur');
        if (
          (await count(
            `SELECT count(*)::int AS count FROM information_schema.columns
           WHERE table_schema='${schema}' AND table_name='customers'
             AND column_name='cooperation_status'`,
          )) !== 0
        )
          throw new Error('Failed DDL left the cooperation column');
        await client.query('DROP TABLE customer_maintenance_facts');
        await apply([target]);
        const after = {
          customers: await count(
            'SELECT count(*)::int AS count FROM customers',
          ),
          leads: await count('SELECT count(*)::int AS count FROM leads'),
          audits: await count(
            'SELECT count(*)::int AS count FROM audit_events',
          ),
          receipt: (
            await client.query(
              'SELECT to_jsonb(r) AS body FROM customer_draft_lifecycle_receipts r WHERE id=$1',
              [ids.oldReceipt],
            )
          ).rows[0]?.body,
        };
        if (JSON.stringify(before) !== JSON.stringify(after))
          throw new Error(
            'Old customers or lifecycle receipt changed during upgrade',
          );
        if (
          (await count(
            "SELECT count(*)::int AS count FROM customers WHERE cooperation_status='COOPERATING'",
          )) !== 2
        )
          throw new Error('Old customers were not backfilled as cooperating');

        await client.query('BEGIN');
        try {
          await leadInsert(ids, ids.admitted, 'cooperating');
          await client.query(
            `UPDATE customers SET cooperation_status='PAUSED',version=version+1 WHERE id=$1`,
            [ids.admitted],
          );
          await rejects(
            `INSERT INTO leads(id,department_id,business_no,customer_id,rights_holder_id,
               responsible_user_id,case_type,source,platform,found_at,shop_name,need_disclose,updated_at)
             VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'CIVIL','ONLINE','TAOBAO',now(),'合法店铺',false,now())`,
            [
              ids.department,
              `CU005-paused-${randomUUID()}`,
              ids.admitted,
              ids.holder,
              ids.actor,
            ],
            '23514',
            'customer unavailable for new lead',
          );
          await client.query(
            'UPDATE leads SET remark=$2 WHERE customer_id=$1',
            [ids.admitted, '存量可编辑'],
          );
          await client.query(
            `UPDATE customers SET cooperation_status='TERMINATED' WHERE id=$1`,
            [ids.admitted],
          );
          await rejects(
            `INSERT INTO leads(id,department_id,business_no,customer_id,rights_holder_id,
               responsible_user_id,case_type,source,platform,found_at,shop_name,need_disclose,updated_at)
             VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'CIVIL','ONLINE','TAOBAO',now(),'合法店铺',false,now())`,
            [
              ids.department,
              `CU005-terminated-${randomUUID()}`,
              ids.admitted,
              ids.holder,
              ids.actor,
            ],
            '23514',
            'customer unavailable for new lead',
          );
          await client.query(
            `UPDATE customers SET cooperation_status='COOPERATING' WHERE id=$1`,
            [ids.admitted],
          );
          await leadInsert(ids, ids.admitted, 'resumed');

          // Customer maintenance evidence does not create a CU004 business
          // association: an unadmitted, otherwise empty draft remains deletable.
          const audit = randomUUID();
          const fact = randomUUID();
          await client.query(
            `UPDATE customers SET cooperation_status='PAUSED',version=version+1 WHERE id=$1`,
            [ids.draft],
          );
          await client.query(
            `INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action)
             VALUES ($1,$2,$3,'customer',$4,'customer.cooperation-pause')`,
            [audit, ids.department, ids.actor, ids.draft],
          );
          await client.query(
            `INSERT INTO customer_maintenance_facts(id,customer_id,department_id,action,actor_user_id,
               from_version,to_version,from_cooperation_status,to_cooperation_status,reason,audit_event_id)
             VALUES ($1,$2,$3,'PAUSE',$4,3,4,'COOPERATING','PAUSED','人工暂停',$5)`,
            [fact, ids.draft, ids.department, ids.actor, audit],
          );
          await client.query(
            `INSERT INTO customer_maintenance_receipts(id,department_id,actor_user_id,idempotency_key,
               request_fingerprint,action,customer_id,fact_id)
             VALUES (gen_random_uuid(),$1,$2,'maintenance-key',repeat('b',64),'PAUSE',$3,$4)`,
            [ids.department, ids.actor, ids.draft, fact],
          );
          await rejects(
            `UPDATE customer_maintenance_facts SET reason='changed' WHERE id=$1`,
            [fact],
            '23514',
            'immutable',
          );
          await rejects(
            `UPDATE customer_maintenance_receipts SET idempotency_key='changed' WHERE fact_id=$1`,
            [fact],
            '23514',
            'immutable',
          );
          await client.query(
            `UPDATE customers SET deleted_at=now(),deleted_by_user_id=$2,version=version+1 WHERE id=$1`,
            [ids.draft, ids.actor],
          );
          if (
            (await count(
              `SELECT count(*)::int AS count FROM customers WHERE id='${ids.draft}' AND deleted_at IS NOT NULL`,
            )) !== 1
          )
            throw new Error(
              'Maintenance history blocked eligible draft deletion',
            );
          await client.query('ROLLBACK');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
        console.log(
          '100 -> 101 upgrade, DDL rollback/retry, old receipt preservation, lead INSERT guard and draft deletion passed',
        );
      } else {
        await apply([target]);
        if (
          (await count(
            `SELECT count(*)::int AS count FROM information_schema.columns
             WHERE table_schema='${schema}' AND column_name='cooperation_status'
               AND table_name='customers'`,
          )) !== 1
        )
          throw new Error('Empty-chain cooperation column missing');
        console.log('101-migration empty chain passed');
      }
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.query('SET search_path TO public').catch(() => {});
    for (const schema of schemas) {
      if (/^cu005_(empty|upgrade)_[a-f0-9]{16}$/u.test(schema))
        await client
          .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
          .catch(() => {});
    }
    await client.end();
  }
}

export async function verifyCustomerCooperationMigration() {
  const lock = acquireE2eResourceLock();
  try {
    await run();
  } finally {
    lock.release();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  verifyCustomerCooperationMigration().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
