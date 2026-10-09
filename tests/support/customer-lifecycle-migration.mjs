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
const client = new Client({
  connectionString: environment.childEnvironment.DATABASE_URL,
});
const migrationRoot = resolve(root, 'backend/prisma/migrations');
const lifecycleTarget = '20261008040000_customer_draft_lifecycle';
const receiptTarget = '20261009010000_customer_lifecycle_receipt_guards';
const target = '20261009020000_seal_customer_ever_admitted_deletion';
const migrations = readdirSync(migrationRoot)
  .filter((name) => /^\d{14}_/.test(name) && name <= target)
  .sort();
const empty = `cu004_empty_${randomBytes(8).toString('hex')}`;
const upgrade = `cu004_upgrade_${randomBytes(8).toString('hex')}`;
const ids = {
  department: '11111111-1111-4111-8111-111111111111',
  actor: '22222222-2222-4222-8222-222222222222',
  eligible: '33333333-3333-4333-8333-333333333333',
  linked: '44444444-4444-4444-8444-444444444444',
  holder: '55555555-5555-4555-8555-555555555555',
  draft: '66666666-6666-4666-8666-666666666666',
  admitted: '77777777-7777-4777-8777-777777777777',
  account: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  material: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  clientUser: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  lead: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  admittedBare: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  admissionReceipt: '88888888-8888-4888-8888-888888888888',
  holderReceipt: '99999999-9999-4999-8999-999999999999',
};

async function seedHistoricalReceipts() {
  await client.query(
    `INSERT INTO customer_admission_receipts(id,department_id,actor_user_id,idempotency_key,request_fingerprint,
      result_customer_id,result_customer_version,result_snapshot)
      VALUES ($1,$2,$3,'old-admission',repeat('a',64),$4::uuid,1,jsonb_build_object('id',($4::uuid)::text,'version',1))`,
    [ids.admissionReceipt, ids.department, ids.actor, ids.admitted],
  );
  await client.query(
    `INSERT INTO rights_holder_command_receipts(id,department_id,actor_user_id,action,idempotency_key,
      request_fingerprint,result_holder_id,result_link_id,result_customer_id,result_customer_version)
      SELECT $1,$2,$3,'link-existing','old-link',repeat('b',64),$4,l.id,$5,1
      FROM customer_rights_holder_links l WHERE l.customer_id=$5`,
    [ids.holderReceipt, ids.department, ids.actor, ids.holder, ids.linked],
  );
}

async function receiptSnapshot() {
  return (
    await client.query(
      `SELECT (SELECT to_jsonb(r) FROM customer_admission_receipts r WHERE id=$1) AS admission,
      (SELECT to_jsonb(r) FROM rights_holder_command_receipts r WHERE id=$2) AS holder`,
      [ids.admissionReceipt, ids.holderReceipt],
    )
  ).rows[0];
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

async function count(sql) {
  return (await client.query(sql)).rows[0].count;
}

async function rejects(sql, params, code, text) {
  await client.query('SAVEPOINT cu004_negative');
  try {
    await client.query(sql, params);
    throw new Error(`${text}: unexpectedly succeeded`);
  } catch (error) {
    if (error.code !== code || !error.message.includes(text)) throw error;
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT cu004_negative');
  }
}

async function seed() {
  await client.query(
    `INSERT INTO departments(id,name,updated_at) VALUES ($1,'CU004',now())`,
    [ids.department],
  );
  await client.query(
    `INSERT INTO user_accounts(id,external_subject,display_name,updated_at)
    VALUES ($1,'cu004-operator','CU004 operator',now())`,
    [ids.actor],
  );
  await client.query(
    `INSERT INTO department_memberships(id,user_id,department_id,updated_at)
    VALUES (gen_random_uuid(),$1,$2,now())`,
    [ids.actor, ids.department],
  );
  await client.query(
    `INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at,profile_status,admitted_at)
    VALUES ($1,'Eligible','eligible',$4,$5,now(),'DRAFT',NULL),($2,'Linked','linked',$4,$5,now(),'DRAFT',NULL),
      ($3,'Draft','draft',$4,$5,now(),'DRAFT',NULL)`,
    [ids.eligible, ids.linked, ids.draft, ids.department, ids.actor],
  );
  await client.query(
    `INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at,profile_status)
      VALUES ($1,'Account','account',$3,$4,now(),'DRAFT'),($2,'Material','material',$3,$4,now(),'DRAFT')`,
    [ids.account, ids.material, ids.department, ids.actor],
  );
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at)
      VALUES ($1,'cu004-client','CU004 client','CLIENT',now())`,
    [ids.clientUser],
  );
  await client.query(
    `INSERT INTO customer_account_bindings(id,user_id,customer_id,department_id,active,updated_at)
      VALUES (gen_random_uuid(),$1,$2,$3,false,now())`,
    [ids.clientUser, ids.account, ids.department],
  );
  await client.query('COMMIT');
  await client.query(
    `INSERT INTO materials(id,department_id,owner_type,owner_id,category,purpose,status,deleted_at,updated_at)
      VALUES (gen_random_uuid(),$1,'CUSTOMER',$2,'CUSTOMER_IDENTITY','IDENTITY_FULL','DELETED',now(),now())`,
    [ids.department, ids.material],
  );
  await client.query(
    `INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at,
    profile_status,admitted_at,customer_type,identity_type,identity_number,normalized_identity_number,
    admission_contact_name,admission_contact_phone,identity_validity_mode)
    VALUES ($1,'Admitted','admitted',$2,$3,now(),'ADMITTED',now(),'ENTERPRISE','BUSINESS_LICENSE',
      'CU004-OLD','CU004-OLD','Contact','12345678','NOT_STATED')`,
    [ids.admitted, ids.department, ids.actor],
  );
  await client.query(
    `INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at,
      profile_status,admitted_at,customer_type,identity_type,identity_number,normalized_identity_number,
      admission_contact_name,admission_contact_phone,identity_validity_mode)
      VALUES ($1,'Bare admitted','bare admitted',$2,$3,now(),'ADMITTED',now(),'ENTERPRISE','BUSINESS_LICENSE',
        'CU004-BARE','CU004-BARE','Contact','12345678','NOT_STATED')`,
    [ids.admittedBare, ids.department, ids.actor],
  );
  await client.query(
    `INSERT INTO rights_holders(id,name,department_id,updated_at)
    VALUES ($1,'Holder',$2,now())`,
    [ids.holder, ids.department],
  );
  await client.query(
    `INSERT INTO customer_rights_holder_links(id,customer_id,rights_holder_id,department_id)
    VALUES (gen_random_uuid(),$1,$2,$3)`,
    [ids.linked, ids.holder, ids.department],
  );
  await client.query(
    `INSERT INTO customer_rights_holder_links(id,customer_id,rights_holder_id,department_id)
      VALUES (gen_random_uuid(),$1,$2,$3)`,
    [ids.admitted, ids.holder, ids.department],
  );
  await client.query(
    `INSERT INTO leads(id,department_id,business_no,customer_id,rights_holder_id,responsible_user_id,
      case_type,source,platform,found_at,shop_name,need_disclose,updated_at)
      VALUES ($1,$2,'CU004-LEAD',$3,$4,$5,'CIVIL','ONLINE','TAOBAO',now(),'CU004 shop',false,now())`,
    [ids.lead, ids.department, ids.admitted, ids.holder, ids.actor],
  );
  await client.query(
    `INSERT INTO upload_drafts(id,department_id,actor_user_id,internal_actor_user_id,owner_type,owner_id,category,purpose,original_filename,declared_mime_type,status,expires_at,created_at,updated_at)
    VALUES ($1,$2,$4,$4,'CUSTOMER',$3,'CUSTOMER_IDENTITY','CUSTOMER_IDENTITY','expired.pdf','application/pdf','EXPIRED',now()-interval '1 day',now(),now())`,
    [ids.draft, ids.department, ids.draft, ids.actor],
  );
}

async function seedAcceptedCu003Proof(legacy) {
  const proofMaterialId = randomUUID();
  const proofVersionId = randomUUID();
  const nextAssetVersionId = randomUUID();
  const nextAuditId = randomUUID();
  const receiptId = randomUUID();
  const referenceId = randomUUID();
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO materials(id,department_id,owner_type,owner_id,category,purpose,updated_at)
      VALUES ($1,$2,'CUSTOMER',$3,'CUSTOMER_RIGHT_EVIDENCE','CUSTOMER_RIGHT_EVIDENCE',now())`,
      [proofMaterialId, legacy.departmentId, legacy.customerId],
    );
    await client.query(
      `INSERT INTO content_versions(id,material_id,storage_key,original_filename,mime_type,size_bytes,sha256,uploaded_by)
      VALUES ($1,$2,$3,'cu004-proof.pdf','application/pdf',5,$4,$5)`,
      [
        proofVersionId,
        proofMaterialId,
        `${legacy.departmentId}/${proofMaterialId}/${proofVersionId}`,
        'b'.repeat(64),
        legacy.userId,
      ],
    );
    await client.query(
      'UPDATE materials SET current_version_id=$2 WHERE id=$1',
      [proofMaterialId, proofVersionId],
    );
    await client.query(
      `INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action,details)
      VALUES ($1,$2,$3,'right-asset',$4,'right-asset.revised',$5)`,
      [
        nextAuditId,
        legacy.departmentId,
        legacy.userId,
        legacy.assetId,
        { customerId: legacy.customerId, assetId: legacy.assetId, version: 2 },
      ],
    );
    await client.query(
      `INSERT INTO customer_right_asset_versions(id,asset_id,customer_id,department_id,version,action,type,name,category,holder_id,validity_mode,recorded_by_user_id,audit_event_id,evidence_content_version_ids)
      VALUES ($1,$2,$3,$4,2,'REVISE','TRADEMARK','CU004 preserved proof','商标权',$5,'UNKNOWN',$6,$7,ARRAY[$8]::uuid[])`,
      [
        nextAssetVersionId,
        legacy.assetId,
        legacy.customerId,
        legacy.departmentId,
        legacy.holderId,
        legacy.userId,
        nextAuditId,
        proofVersionId,
      ],
    );
    await client.query(
      `INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,material_id,content_version_id,action_event_id,asset_version_id)
      VALUES ($1,$2,'right_asset_version',$3,'CUSTOMER_RIGHT_EVIDENCE',$4,$5,$6,$7)`,
      [
        referenceId,
        legacy.departmentId,
        nextAssetVersionId,
        proofMaterialId,
        proofVersionId,
        nextAuditId,
        nextAssetVersionId,
      ],
    );
    await client.query(
      'UPDATE customer_right_assets SET current_version_id=$2,version=2 WHERE id=$1',
      [legacy.assetId, nextAssetVersionId],
    );
    await client.query(
      `INSERT INTO customer_right_asset_receipts(id,department_id,actor_user_id,customer_id,asset_id,result_version_id,action,idempotency_key,request_fingerprint,result_customer_version)
      VALUES ($1,$2,$3,$4,$5,$6,'REVISE','cu004-proof-key',$7,3)`,
      [
        receiptId,
        legacy.departmentId,
        legacy.userId,
        legacy.customerId,
        legacy.assetId,
        nextAssetVersionId,
        'b'.repeat(64),
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  return {
    proofMaterialId,
    proofVersionId,
    nextAssetVersionId,
    receiptId,
    referenceId,
  };
}

async function acceptedProofSnapshot(legacy, proof) {
  return (
    await client.query(
      `SELECT
    a.current_version_id AS current_asset_version_id, a.version AS asset_version,
    v.evidence_content_version_ids AS evidence_ids,
    r.result_version_id AS receipt_version_id,
    m.current_version_id AS current_content_version_id,
    cv.storage_key, cv.sha256, cv.size_bytes::text AS size_bytes,
    mr.content_version_id AS reference_content_version_id, mr.asset_version_id AS reference_asset_version_id
    FROM customer_right_assets a
    JOIN customer_right_asset_versions v ON v.id=$2
    JOIN customer_right_asset_receipts r ON r.id=$3
    JOIN materials m ON m.id=$4
    JOIN content_versions cv ON cv.id=$5
    JOIN material_references mr ON mr.id=$6
    WHERE a.id=$1`,
      [
        legacy.assetId,
        proof.nextAssetVersionId,
        proof.receiptId,
        proof.proofMaterialId,
        proof.proofVersionId,
        proof.referenceId,
      ],
    )
  ).rows[0];
}

async function run() {
  if (migrations.at(-1) !== target) throw new Error('target is not latest');
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${empty}"`);
    await client.query(`SET search_path TO "${empty}"`);
    await apply(migrations);
    console.log(`empty chain passed: ${migrations.length}`);
    await client.query(`CREATE SCHEMA "${upgrade}"`);
    await client.query(`SET search_path TO "${upgrade}"`);
    await apply(migrations.filter((name) => name < lifecycleTarget));
    await seed();
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = environment.childEnvironment.DATABASE_URL;
    const { seedPreviousSchema } =
      await import('./customer-right-evidence-migration.mjs');
    const legacy = await seedPreviousSchema(client);
    const proof = await seedAcceptedCu003Proof(legacy);
    const proofBefore = await acceptedProofSnapshot(legacy, proof);
    const before = await count('SELECT count(*)::int AS count FROM customers');
    await client.query(
      `CREATE FUNCTION customer_draft_deletion_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`,
    );
    let failed = false;
    try {
      await apply([lifecycleTarget]);
    } catch (error) {
      if (!error.message.includes('already exists')) throw error;
      failed = true;
    }
    if (!failed) throw new Error('injected DDL failure did not occur');
    if (
      (await count(
        `SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='${upgrade}' AND table_name='customers' AND column_name='deleted_at'`,
      )) !== 0
    )
      throw new Error('failed migration left partial schema');
    await client.query('DROP FUNCTION customer_draft_deletion_guard()');
    await apply([lifecycleTarget]);
    await seedHistoricalReceipts();
    const receiptsBefore = await receiptSnapshot();
    await client.query(
      `CREATE FUNCTION rights_holder_receipt_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`,
    );
    let receiptUpgradeFailed = false;
    try {
      await apply([receiptTarget]);
    } catch (error) {
      if (!error.message.includes('already exists')) throw error;
      await client.query('ROLLBACK');
      receiptUpgradeFailed = true;
    }
    if (!receiptUpgradeFailed)
      throw new Error('receipt guard DDL failure did not occur');
    if (
      (await count(
        `SELECT count(*)::int AS count FROM information_schema.triggers WHERE event_object_schema='${upgrade}' AND trigger_name='customer_admission_receipt_parent_guard'`,
      )) !== 0
    )
      throw new Error('receipt guard failed migration left partial trigger');
    await client.query('DROP FUNCTION rights_holder_receipt_parent_guard()');
    await apply([receiptTarget]);
    const previousDeletionGuard = (
      await client.query(
        `SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname='customer_draft_deletion_guard'`,
        [upgrade],
      )
    ).rows[0].definition;
    await client.query(
      `ALTER TABLE customers ADD CONSTRAINT customers_deleted_never_admitted_check CHECK (true)`,
    );
    let sealUpgradeFailed = false;
    try {
      await apply([target]);
    } catch (error) {
      if (!error.message.includes('already exists')) throw error;
      await client.query('ROLLBACK');
      sealUpgradeFailed = true;
    }
    if (!sealUpgradeFailed)
      throw new Error('ever-admitted seal DDL failure did not occur');
    const afterFailedSeal = (
      await client.query(
        `SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname='customer_draft_deletion_guard'`,
        [upgrade],
      )
    ).rows[0].definition;
    if (afterFailedSeal !== previousDeletionGuard)
      throw new Error('failed seal migration changed guard function');
    await client.query(
      `ALTER TABLE customers DROP CONSTRAINT customers_deleted_never_admitted_check`,
    );
    await apply([target]);
    const caseDependencyChain = await client.query(
      `SELECT c.conname FROM pg_constraint c
       JOIN pg_namespace n ON n.oid=c.connamespace
       WHERE n.nspname=$1 AND c.conname IN
         ('leads_customer_department_fkey','cases_lead_fkey','cases_matter_fkey')`,
      [upgrade],
    );
    const caseParentGuard = await count(
      `SELECT count(*)::int AS count FROM pg_trigger t
       JOIN pg_class r ON r.oid=t.tgrelid
       JOIN pg_namespace n ON n.oid=r.relnamespace
       WHERE n.nspname='${upgrade}' AND r.relname='cases'
         AND t.tgname='customer_case_parent_guard' AND NOT t.tgisinternal`,
    );
    if (caseDependencyChain.rowCount !== 3 || caseParentGuard !== 1)
      throw new Error('case lead/matter prerequisite or parent guard missing');
    if (
      JSON.stringify(await receiptSnapshot()) !== JSON.stringify(receiptsBefore)
    )
      throw new Error(
        'existing customer admission/holder receipts changed on guard upgrade',
      );
    const after = await count('SELECT count(*)::int AS count FROM customers');
    if (before !== 8 || after !== 8)
      throw new Error(`customer preservation failed ${before} -> ${after}`);
    const proofAfter = await acceptedProofSnapshot(legacy, proof);
    if (JSON.stringify(proofBefore) !== JSON.stringify(proofAfter))
      throw new Error(
        'CU003 frozen proof, receipt or current pointer changed on upgrade',
      );
    if (
      (await count(
        `SELECT count(*)::int AS count FROM customers WHERE id='${ids.admitted}' AND ever_admitted`,
      )) !== 1
    )
      throw new Error('old admitted customer missing durable marker');
    await client.query('BEGIN');
    try {
      await client.query(
        `UPDATE customers SET deleted_at=now(),deleted_by_user_id=$2,version=version+1 WHERE id=$1`,
        [ids.eligible, ids.actor],
      );
      await rejects(
        `UPDATE customers SET deleted_at=now(),deleted_by_user_id=$2 WHERE id=$1`,
        [ids.linked, ids.actor],
        '23514',
        'business history',
      );
      await rejects(
        `UPDATE customers SET deleted_at=now(),deleted_by_user_id=$2 WHERE id=$1`,
        [ids.draft, ids.actor],
        '23514',
        'business history',
      );
      await rejects(
        `UPDATE customers SET deleted_at=now(),deleted_by_user_id=$2 WHERE id=$1`,
        [ids.account, ids.actor],
        '23514',
        'business history',
      );
      await rejects(
        `UPDATE customers SET deleted_at=now(),deleted_by_user_id=$2 WHERE id=$1`,
        [ids.material, ids.actor],
        '23514',
        'business history',
      );
      await rejects(
        `UPDATE customers SET profile_status='DRAFT',admitted_at=NULL,deleted_at=now(),deleted_by_user_id=$2 WHERE id=$1`,
        [ids.admitted, ids.actor],
        '23514',
        'business history',
      );
      await client.query(
        `UPDATE customers SET profile_status='DRAFT',admitted_at=NULL WHERE id=$1`,
        [ids.admitted],
      );
      await rejects(
        `UPDATE customers SET deleted_at=now(),deleted_by_user_id=$2 WHERE id=$1`,
        [ids.admitted, ids.actor],
        '23514',
        'business history',
      );
      await rejects(
        `UPDATE customers SET profile_status='DRAFT',admitted_at=NULL,ever_admitted=false,
          deleted_at=now(),deleted_by_user_id=$2 WHERE id=$1`,
        [ids.admittedBare, ids.actor],
        '23514',
        'business history',
      );
      await rejects(
        `INSERT INTO customer_rights_holder_links(id,customer_id,rights_holder_id,department_id)
        VALUES (gen_random_uuid(),$1,$2,$3)`,
        [ids.eligible, ids.holder, ids.department],
        '23514',
        'unavailable',
      );
      await rejects(
        `UPDATE customer_account_bindings SET customer_id=$1 WHERE customer_id=$2`,
        [ids.eligible, ids.account],
        '23514',
        'customer unavailable for business association',
      );
      await rejects(
        `UPDATE materials SET owner_id=$1 WHERE owner_id=$2`,
        [ids.eligible, ids.material],
        '23514',
        'customer unavailable for business association',
      );
      await rejects(
        `UPDATE leads SET customer_id=$1 WHERE id=$2`,
        [ids.eligible, ids.lead],
        '23514',
        'customer unavailable for business association',
      );
      await rejects(
        `UPDATE customer_right_assets SET customer_id=$1 WHERE id=$2`,
        [ids.eligible, legacy.assetId],
        '23514',
        'customer unavailable for business association',
      );
      await rejects(
        `UPDATE customer_right_asset_versions SET customer_id=$1 WHERE id=$2`,
        [ids.eligible, proof.nextAssetVersionId],
        '23514',
        'customer unavailable for business association',
      );
      await rejects(
        `UPDATE customer_right_asset_receipts SET customer_id=$1 WHERE id=$2`,
        [ids.eligible, proof.receiptId],
        '23514',
        'customer unavailable for business association',
      );
      await rejects(
        `INSERT INTO upload_drafts(id,department_id,actor_user_id,internal_actor_user_id,owner_type,owner_id,
          category,purpose,original_filename,declared_mime_type,status,expires_at,created_at,updated_at)
        VALUES (gen_random_uuid(),$2,$3,$3,'CUSTOMER',$1,'CUSTOMER_IDENTITY','CUSTOMER_IDENTITY',
          'late.pdf','application/pdf','EXPIRED',now()-interval '1 day',now(),now())`,
        [ids.eligible, ids.department, ids.actor],
        '23514',
        'customer unavailable for business association',
      );
      await rejects(
        `INSERT INTO customer_admission_receipts(id,department_id,actor_user_id,idempotency_key,request_fingerprint,
          result_customer_id,result_customer_version,result_snapshot)
          VALUES (gen_random_uuid(),$2,$3,'deleted-admission',repeat('c',64),$1,2,'{}'::jsonb)`,
        [ids.eligible, ids.department, ids.actor],
        '23514',
        'customer unavailable for business association',
      );
      await rejects(
        `INSERT INTO rights_holder_command_receipts(id,department_id,actor_user_id,action,idempotency_key,
          request_fingerprint,result_holder_id,result_link_id,result_customer_id,result_customer_version)
          SELECT gen_random_uuid(),$2,$3,'link-existing','deleted-holder',repeat('d',64),$4,l.id,$1,2
          FROM customer_rights_holder_links l WHERE l.customer_id=$5`,
        [ids.eligible, ids.department, ids.actor, ids.holder, ids.linked],
        '23514',
        'customer unavailable for business association',
      );
      await rejects(
        `INSERT INTO rights_holder_command_receipts(id,department_id,actor_user_id,action,idempotency_key,
          request_fingerprint,result_holder_id,result_link_id,result_customer_id,result_customer_version)
          SELECT gen_random_uuid(),$2,$3,'link-existing','cross-link',repeat('e',64),$4,l.id,$1,2
          FROM customer_rights_holder_links l WHERE l.customer_id=$5`,
        [ids.admitted, ids.department, ids.actor, ids.holder, ids.linked],
        '23514',
        'rights holder receipt/link identity mismatch',
      );
      await rejects(
        `INSERT INTO customer_admission_receipts(id,department_id,actor_user_id,idempotency_key,request_fingerprint,
          result_customer_id,result_customer_version,result_snapshot)
          VALUES (gen_random_uuid(),$2,$3,'draft-admission',repeat('f',64),$1,2,'{}'::jsonb)`,
        [ids.linked, ids.department, ids.actor],
        '23514',
        'customer admission receipt requires admitted customer',
      );
      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    console.log(
      `previous schema upgrade, rollback/retry, ever-admitted, CU003 proof/receipt/current-pointer and guards passed: customers ${before} -> ${after}`,
    );
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS "${empty}" CASCADE`);
    await client.query(`DROP SCHEMA IF EXISTS "${upgrade}" CASCADE`);
    await client.end();
  }
}

export async function verifyCustomerLifecycleMigration() {
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
  verifyCustomerLifecycleMigration().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
