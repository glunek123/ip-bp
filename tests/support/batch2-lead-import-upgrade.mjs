import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { assertBatch2ImportTarget } from './batch2-lead-import-target.mjs';

const root = process.cwd();
const migrationRoot = resolve(root, 'backend/prisma/migrations');
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const migration189 = '20261027150000_batch2_lead_import_images';
const migration190 = '20261027160000_batch2_import_responsible_operator';

function check(value, message) {
  if (!value) throw new Error(message);
}

async function count(query, sql, values = []) {
  return Number((await query(sql, values)).rows[0].n);
}

function receiptFor({
  departmentId,
  actorId,
  ownerId,
  teamId,
  customerId,
  holderId,
  leadId,
  productId,
  businessNo,
}) {
  const input = {
    customerId,
    rightsHolderId: holderId,
    caseType: 'CIVIL',
    infringementTypes: ['TRADEMARK'],
    source: 'ONLINE',
    platform: 'TAOBAO',
    foundAt: '2026-10-27T00:00:00.000Z',
    shopName: '迁移合成店铺',
    needDisclose: false,
    products: [
      {
        title: '迁移合成商品',
        quantity: 1,
        unitPrice: '1.00',
        commentCount: 0,
      },
    ],
    leadScreenshotContentVersionIds: [],
  };
  const originalRequest = { items: [{ rowNumber: 2, input }] };
  const resultSnapshot = {
    items: [
      {
        rowNumber: 2,
        lead: {
          id: leadId,
          businessNo,
          departmentId,
          customerId,
          rightsHolderId: holderId,
          responsibleUserId: ownerId,
          teamId,
          status: 'WAITING_PUSH',
          version: 1,
          creationChannel: 'CSV',
          caseType: 'CIVIL',
          source: 'ONLINE',
          platform: 'TAOBAO',
          foundAt: input.foundAt,
          shopName: input.shopName,
          shopExternalId: null,
          needDisclose: false,
          remark: null,
          products: [
            {
              id: productId,
              position: 1,
              url: null,
              title: '迁移合成商品',
              quantity: 1,
              unitPrice: '1.00',
              commentCount: 0,
              estimatedAmount: '1.00',
            },
          ],
          infringementTypes: ['TRADEMARK'],
          leadScreenshotContentVersionIds: [],
          externalSourceRef: null,
          pushedAt: null,
        },
      },
    ],
  };
  return {
    departmentId,
    actorId,
    originalRequest,
    resultSnapshot,
    fingerprint: createHash('sha256')
      .update(JSON.stringify(originalRequest))
      .digest('hex'),
  };
}

async function insertLeadAndReceipt(query, facts) {
  const receipt = receiptFor(facts);
  await query(
    `INSERT INTO leads(id,department_id,business_no,customer_id,rights_holder_id,responsible_user_id,team_id,
      case_type,source,platform,found_at,shop_name,need_disclose,creation_channel,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,'CIVIL','ONLINE','TAOBAO',$8,'迁移合成店铺',false,'CSV',now())`,
    [
      facts.leadId,
      facts.departmentId,
      facts.businessNo,
      facts.customerId,
      facts.holderId,
      facts.ownerId,
      facts.teamId,
      receipt.originalRequest.items[0].input.foundAt,
    ],
  );
  await query(
    `INSERT INTO lead_products(id,lead_id,position,title,quantity,unit_price,comment_count,estimated_amount)
     VALUES($1,$2,1,'迁移合成商品',1,1.00,0,1.00)`,
    [facts.productId, facts.leadId],
  );
  await query(
    `INSERT INTO lead_infringements(id,lead_id,infringement_type) VALUES($1,$2,'TRADEMARK')`,
    [randomUUID(), facts.leadId],
  );
  await query(
    `INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action,details)
     VALUES($1,$2,$3,'lead',$4,'lead.created',$5::jsonb)`,
    [
      randomUUID(),
      facts.departmentId,
      facts.actorId,
      facts.leadId,
      JSON.stringify({
        businessNo: facts.businessNo,
        version: 1,
        screenshotCount: 0,
      }),
    ],
  );
  const receiptId = randomUUID();
  await query(
    `INSERT INTO lead_csv_import_receipts(id,department_id,actor_user_id,idempotency_key,
      request_fingerprint,original_request,result_snapshot)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
    [
      receiptId,
      facts.departmentId,
      facts.actorId,
      `owned-${receiptId}`,
      receipt.fingerprint,
      JSON.stringify(receipt.originalRequest),
      JSON.stringify(receipt.resultSnapshot),
    ],
  );
  return { ...receipt, receiptId };
}

async function expectSqlstate(query, expected, sql, values = []) {
  await query('SAVEPOINT batch2_import_expected_failure');
  let failure;
  try {
    await query(sql, values);
    await query('SET CONSTRAINTS ALL IMMEDIATE');
  } catch (error) {
    failure = error;
  }
  await query('ROLLBACK TO SAVEPOINT batch2_import_expected_failure');
  await query('RELEASE SAVEPOINT batch2_import_expected_failure');
  check(
    failure?.code === expected,
    `Expected SQLSTATE ${expected}, received ${failure?.code ?? 'success'}`,
  );
}

async function faultAndRetryMigration(query, source, assertRolledBack) {
  check(/\nCOMMIT;\s*$/u.test(source), 'Migration transaction footer changed');
  const injected = source.replace(
    /\nCOMMIT;\s*$/u,
    "\nDO $$ BEGIN RAISE EXCEPTION 'owned migration fault' USING ERRCODE = '23514'; END $$;\nCOMMIT;",
  );
  let failure;
  try {
    await query(injected);
  } catch (error) {
    failure = error;
  }
  await query('ROLLBACK');
  check(
    failure?.code === '23514',
    'Migration fault did not reach the owned transaction',
  );
  await assertRolledBack();
  await query(source);
}

/** Pre-app, owned-schema only. Never touches public business tables or network images. */
export async function verifyBatch2LeadImportUpgrade() {
  const url = assertBatch2ImportTarget();
  const names = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/u.test(name) && name <= migration190)
    .sort();
  check(
    names.length === 190 &&
      names.at(-2) === migration189 &&
      names.at(-1) === migration190,
    'Expected exact 184→190 migration chain',
  );
  const nonce = randomUUID().replaceAll('-', '');
  const schema = `batch2_i_upgrade_${nonce}`;
  check(
    /^batch2_i_upgrade_[a-f0-9]{32}$/u.test(schema),
    'Invalid owned schema name',
  );
  const quoted = `"${schema}"`;
  const client = new Client({ connectionString: url });
  const query = (sql, values = []) => client.query(sql, values);
  let connected = false;
  let created = false;
  let primaryError;
  let result;
  try {
    await client.connect();
    connected = true;
    const identity = (
      await query(
        'SELECT current_database() AS db,current_schema() AS namespace',
      )
    ).rows[0];
    check(
      identity.db === 'dev_cor_test' && identity.namespace === 'public',
      'Unexpected owned database namespace',
    );
    await query(`CREATE SCHEMA ${quoted}`);
    created = true;
    await query(`SET search_path TO ${quoted}`);
    for (const name of names.slice(0, -2))
      await query(
        await readFile(resolve(migrationRoot, name, 'migration.sql'), 'utf8'),
      );

    const departmentId = randomUUID();
    const otherDepartmentId = randomUUID();
    const actorId = randomUUID();
    const ownerId = randomUUID();
    const crossDepartmentActorId = randomUUID();
    const teamId = randomUUID();
    const customerId = randomUUID();
    const contactId = randomUUID();
    const holderId = randomUUID();
    for (const id of [departmentId, otherDepartmentId])
      await query(
        'INSERT INTO departments(id,name,updated_at) VALUES($1,$2,now())',
        [id, `合成部门-${id}`],
      );
    for (const [id, name] of [
      [actorId, '旧导入人'],
      [ownerId, '新负责运营'],
      [crossDepartmentActorId, '跨部门人员'],
    ])
      await query(
        'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES($1,$2,$3,now())',
        [id, `batch2-upgrade:${id}`, name],
      );
    await query(
      'INSERT INTO teams(id,department_id,name,updated_at) VALUES($1,$2,$3,now())',
      [teamId, departmentId, '合成团队'],
    );
    for (const [userId, deptId, memberTeamId] of [
      [actorId, departmentId, null],
      [ownerId, departmentId, teamId],
      [crossDepartmentActorId, otherDepartmentId, null],
    ])
      await query(
        'INSERT INTO department_memberships(id,user_id,department_id,team_id,updated_at) VALUES($1,$2,$3,$4,now())',
        [randomUUID(), userId, deptId, memberTeamId],
      );
    // This owned schema is before the separately authorized numbering cutover.
    // A NULL historical business_id is legal only while its counter is -1.
    check(
      (await count(
        query,
        'SELECT count(*) AS n FROM customer_business_number_counters WHERE singleton_id=1 AND last_value=-1',
      )) === 1,
      'Owned schema already crossed the customer numbering cutover',
    );
    const customerIdentity = `91310000${nonce.slice(0, 10).toUpperCase()}`;
    await query('BEGIN');
    try {
      await query(
        `INSERT INTO customers(id,name,normalized_name,customer_type,identity_type,
          identity_number,normalized_identity_number,identity_validity_mode,
          department_id,responsible_user_id,cooperation_status,updated_at)
         VALUES($1,'合成客户','合成客户','ENTERPRISE','BUSINESS_LICENSE',
          $2,$2,'LONG_TERM',$3,$4,'COOPERATING',now())`,
        [customerId, customerIdentity, departmentId, actorId],
      );
      await query(
        `INSERT INTO customer_contacts(id,customer_id,department_id,name,phone,origin,
          created_by_user_id,updated_by_user_id)
         VALUES($1,$2,$3,'合成联系人','13800000000','ADMISSION_FREEFORM',$4,$4)`,
        [contactId, customerId, departmentId, actorId],
      );
      await query(
        `UPDATE customers SET profile_status='ADMITTED',admitted_at=now(),
          admission_contact_name='合成联系人',admission_contact_phone='13800000000',
          compatibility_contact_id=$2,admission_contact_snapshot_name='合成联系人',
          admission_contact_snapshot_phone='13800000000',
          admission_contact_snapshot_source='NEW_ADMISSION',
          admission_contact_snapshot_frozen_at=now(),version=version+1,updated_at=now()
         WHERE id=$1`,
        [customerId, contactId],
      );
      await query(
        'INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES($1,$2,$3,now())',
        [holderId, '合成主体', departmentId],
      );
      await query(
        'INSERT INTO customer_rights_holder_links(id,customer_id,rights_holder_id,department_id) VALUES($1,$2,$3,$4)',
        [randomUUID(), customerId, holderId, departmentId],
      );
      await query('COMMIT');
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
    const eligibleCustomer = (
      await query(
        `SELECT profile_status,cooperation_status,ever_admitted,admitted_at,
          customer_type,identity_type,identity_number,normalized_identity_number,
          identity_validity_mode,identity_valid_to,deleted_at,compatibility_contact_id,
          admission_contact_name,admission_contact_phone,
          admission_contact_snapshot_name,admission_contact_snapshot_phone,
          admission_contact_snapshot_source,admission_contact_snapshot_frozen_at,
          business_id FROM customers WHERE id=$1`,
        [customerId],
      )
    ).rows[0];
    check(
      eligibleCustomer?.profile_status === 'ADMITTED' &&
        eligibleCustomer.cooperation_status === 'COOPERATING' &&
        eligibleCustomer.ever_admitted === true &&
        eligibleCustomer.admitted_at !== null &&
        eligibleCustomer.customer_type === 'ENTERPRISE' &&
        eligibleCustomer.identity_type === 'BUSINESS_LICENSE' &&
        eligibleCustomer.identity_number === customerIdentity &&
        eligibleCustomer.normalized_identity_number === customerIdentity &&
        eligibleCustomer.identity_validity_mode === 'LONG_TERM' &&
        eligibleCustomer.identity_valid_to === null &&
        eligibleCustomer.deleted_at === null &&
        eligibleCustomer.compatibility_contact_id === contactId &&
        eligibleCustomer.admission_contact_name === '合成联系人' &&
        eligibleCustomer.admission_contact_phone === '13800000000' &&
        eligibleCustomer.admission_contact_snapshot_name === '合成联系人' &&
        eligibleCustomer.admission_contact_snapshot_phone === '13800000000' &&
        eligibleCustomer.admission_contact_snapshot_source ===
          'NEW_ADMISSION' &&
        eligibleCustomer.admission_contact_snapshot_frozen_at !== null &&
        eligibleCustomer.business_id === null,
      'Synthetic customer is not eligible for the historical lead',
    );

    const oldLeadId = randomUUID();
    const oldProductId = randomUUID();
    const old = await insertLeadAndReceipt(query, {
      departmentId,
      actorId,
      ownerId: actorId,
      teamId: null,
      customerId,
      holderId,
      leadId: oldLeadId,
      productId: oldProductId,
      businessNo: `I-OLD-${nonce}`,
    });
    const oldSnapshot = (
      await query(
        'SELECT result_snapshot FROM lead_csv_import_receipts WHERE id=$1',
        [old.receiptId],
      )
    ).rows[0].result_snapshot;
    const source189 = await readFile(
      resolve(migrationRoot, migration189, 'migration.sql'),
      'utf8',
    );
    await faultAndRetryMigration(query, source189, async () => {
      check(
        (await count(
          query,
          `SELECT count(*) AS n FROM information_schema.tables
        WHERE table_schema=$1 AND table_name='lead_image_import_tasks'`,
          [schema],
        )) === 0,
        '189 fault left a task table',
      );
      check(
        (await count(
          query,
          'SELECT count(*) AS n FROM lead_csv_import_receipts WHERE id=$1',
          [old.receiptId],
        )) === 1,
        '189 fault lost the old receipt',
      );
    });
    const source190 = await readFile(
      resolve(migrationRoot, migration190, 'migration.sql'),
      'utf8',
    );
    await faultAndRetryMigration(query, source190, async () => {
      check(
        (await count(
          query,
          `SELECT count(*) AS n FROM information_schema.columns
        WHERE table_schema=$1 AND table_name='lead_image_import_tasks' AND column_name='retry_actor_user_id'`,
          [schema],
        )) === 0,
        '190 fault left retry actor column',
      );
      check(
        (await count(
          query,
          'SELECT count(*) AS n FROM lead_csv_import_receipts WHERE id=$1',
          [old.receiptId],
        )) === 1,
        '190 fault lost the old receipt',
      );
    });
    check(
      JSON.stringify(
        (
          await query(
            'SELECT result_snapshot FROM lead_csv_import_receipts WHERE id=$1',
            [old.receiptId],
          )
        ).rows[0].result_snapshot,
      ) === JSON.stringify(oldSnapshot),
      'Historical receipt was rewritten',
    );
    const newLeadId = randomUUID();
    const newProductId = randomUUID();
    const newer = await insertLeadAndReceipt(query, {
      departmentId,
      actorId,
      ownerId,
      teamId,
      customerId,
      holderId,
      leadId: newLeadId,
      productId: newProductId,
      businessNo: `I-NEW-${nonce}`,
    });
    await query('BEGIN');
    try {
      const forged = JSON.parse(JSON.stringify(newer.resultSnapshot));
      forged.items[0].lead.responsibleUserId = actorId;
      await expectSqlstate(
        query,
        '23514',
        `INSERT INTO lead_csv_import_receipts
        (id,department_id,actor_user_id,idempotency_key,request_fingerprint,original_request,result_snapshot)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
        [
          randomUUID(),
          departmentId,
          actorId,
          `forged-${nonce}`,
          newer.fingerprint,
          JSON.stringify(newer.originalRequest),
          JSON.stringify(forged),
        ],
      );
      const taskId = randomUUID();
      await query(
        `INSERT INTO lead_image_import_tasks(id,department_id,actor_user_id,lead_id,product_id,
        row_number,product_number,url,url_sha256,status,updated_at)
        VALUES($1,$2,$3,$4,$5,2,1,'https://example.invalid/image.png',$6,'FAILED',now())`,
        [
          taskId,
          departmentId,
          actorId,
          newLeadId,
          newProductId,
          'a'.repeat(64),
        ],
      );
      await expectSqlstate(
        query,
        '23503',
        'UPDATE lead_image_import_tasks SET retry_actor_user_id=$2 WHERE id=$1',
        [taskId, crossDepartmentActorId],
      );
      await query(
        'UPDATE lead_image_import_tasks SET retry_actor_user_id=$2,generation=generation+1 WHERE id=$1',
        [taskId, ownerId],
      );
      check(
        (
          await query(
            'SELECT actor_user_id,retry_actor_user_id,generation FROM lead_image_import_tasks WHERE id=$1',
            [taskId],
          )
        ).rows[0].retry_actor_user_id === ownerId,
        'Valid same-department retry actor rejected',
      );
      await expectSqlstate(
        query,
        '23503',
        `INSERT INTO lead_image_import_tasks(id,department_id,actor_user_id,lead_id,product_id,
        row_number,product_number,url,url_sha256,updated_at)
        VALUES($1,$2,$3,$4,$5,2,1,'https://example.invalid/wrong.png',$6,now())`,
        [
          randomUUID(),
          departmentId,
          actorId,
          newLeadId,
          oldProductId,
          'b'.repeat(64),
        ],
      );
      await query('COMMIT');
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
    result = {
      migrationCount: names.length,
      oldReceiptPreserved: true,
      newResponsibleOwner: ownerId,
      retryActor: ownerId,
      forgedOwnerRejected: true,
      crossDepartmentRetryRejected: true,
      wrongProductRejected: true,
      faultRollbackAndRetry: true,
    };
  } catch (error) {
    primaryError = error;
  }
  const cleanupErrors = [];
  if (connected) {
    try {
      await client.query('ROLLBACK');
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (created) {
      try {
        await client.query('RESET search_path');
        await client.query(`DROP SCHEMA ${quoted} CASCADE`);
        check(
          (await count(
            query,
            'SELECT count(*) AS n FROM pg_namespace WHERE nspname=$1',
            [schema],
          )) === 0,
          'Owned schema remained after cleanup',
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await client.end();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (primaryError && cleanupErrors.length)
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      'Upgrade probe and cleanup failed',
    );
  if (primaryError) throw primaryError;
  if (cleanupErrors.length)
    throw new AggregateError(cleanupErrors, 'Upgrade cleanup failed');
  return result;
}
