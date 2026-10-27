import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const project = 'dev-cor-ops-batch2-20261027';
const databaseName = 'dev_cor_test';
const finalMigration = '20261027130000_batch2_calendar_reminders';

export function assertBatch2Admission(environment = process.env) {
  if (
    environment.NODE_ENV !== 'test' ||
    environment.BATCH2_ACCEPTANCE_READY !== 'batch2-ops-20261027-approved' ||
    environment.DEV_COR_TEST_DATABASE_PROJECT !== project ||
    !/^[a-f0-9]{64}$/u.test(
      environment.DEV_COR_TEST_DATABASE_CONTAINER_ID ?? '',
    )
  )
    throw new Error(
      'Batch 2 acceptance is not bound to an approved isolated container',
    );
  let target;
  try {
    target = new URL(environment.DATABASE_URL);
  } catch {
    throw new Error('Batch 2 database URL is invalid');
  }
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    target.hostname !== '127.0.0.1' ||
    target.port !== '15440' ||
    target.pathname !== `/${databaseName}` ||
    target.username !== 'dev_cor_test' ||
    !target.password ||
    target.searchParams.size !== 0
  )
    throw new Error(
      'Batch 2 database target differs from the approved isolated database',
    );
  return { databaseUrl: target.href, databaseName };
}

function quotedSchema(schema) {
  if (!/^b2pc_[a-f0-9]{32}$/u.test(schema)) throw new Error('Unowned schema');
  return `"${schema}"`;
}

async function expectSqlState(client, sql, parameters, code) {
  await client.query('SAVEPOINT batch2_expected_failure');
  try {
    await client.query(sql, parameters);
    throw new Error(`Expected SQLSTATE ${code}`);
  } catch (error) {
    if (error.code !== code) throw error;
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT batch2_expected_failure');
    await client.query('RELEASE SAVEPOINT batch2_expected_failure');
  }
}

// Runs only in the newly approved DB. Every row lives in a random owned
// schema, and the schema is removed after verification.
export async function verifyBatch2EmptyMigrationAndEpoch() {
  const target = assertBatch2Admission();
  const schema = `b2pc_${randomUUID().replaceAll('-', '')}`;
  const quoted = quotedSchema(schema);
  const client = new Client({ connectionString: target.databaseUrl });
  const [
    department,
    userA,
    userB,
    customer,
    holder,
    caseId,
    externalUser,
    leadId,
    decisionId,
    bindingId,
    contactId,
  ] = Array.from({ length: 11 }, randomUUID);
  const tag = `batch2-${schema}`;
  const seedOldExternalDecision = async () => {
    // The legacy CLIENT and its sole binding are one deferred-constraint unit.
    await client.query('BEGIN');
    try {
      await client.query(
        'INSERT INTO departments (id,name,updated_at) VALUES ($1,$2,now())',
        [department, tag],
      );
      await client.query(
        `INSERT INTO user_accounts (id,external_subject,display_name,updated_at,account_type)
      VALUES ($1,$2,$3,now(),'INTERNAL'),($4,$5,$6,now(),'INTERNAL'),($7,$8,$9,now(),'CLIENT')`,
        [
          userA,
          `${tag}-a`,
          '批次A',
          userB,
          `${tag}-b`,
          '批次B',
          externalUser,
          `${tag}-external`,
          '外部客户',
        ],
      );
      await client.query(
        'INSERT INTO department_memberships (id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now()),($4,$5,$3,now())',
        [randomUUID(), userA, department, randomUUID(), userB],
      );
      await client.query(
        `INSERT INTO customers
      (id,name,normalized_name,department_id,responsible_user_id,
       customer_type,identity_type,identity_number,normalized_identity_number,identity_validity_mode,
       updated_at)
      VALUES ($1,$2,$2,$3,$4,'ENTERPRISE','BUSINESS_LICENSE',$5,$5,'LONG_TERM',now())`,
        [
          customer,
          tag,
          department,
          userA,
          customer.replaceAll('-', '').slice(0, 18).toUpperCase(),
        ],
      );
      await client.query(
        `INSERT INTO customer_contacts
        (id,customer_id,department_id,name,phone,origin,created_by_user_id,updated_by_user_id)
        VALUES ($1,$2,$3,'合成联系人','13800138000','ADMISSION_FREEFORM',$4,$4)`,
        [contactId, customer, department, userA],
      );
      await client.query(
        `UPDATE customers SET profile_status='ADMITTED',admitted_at=now(),ever_admitted=true,
        admission_contact_name='合成联系人',admission_contact_phone='13800138000',
        compatibility_contact_id=$2,admission_contact_snapshot_name='合成联系人',
        admission_contact_snapshot_phone='13800138000',
        admission_contact_snapshot_source='NEW_ADMISSION',
        admission_contact_snapshot_frozen_at=now(),version=version+1,updated_at=now()
        WHERE id=$1`,
        [customer, contactId],
      );
      await client.query(
        'INSERT INTO rights_holders (id,name,department_id,updated_at) VALUES ($1,$2,$3,now())',
        [holder, tag, department],
      );
      await client.query(
        'INSERT INTO customer_rights_holder_links (id,customer_id,rights_holder_id,department_id) VALUES ($1,$2,$3,$4)',
        [randomUUID(), customer, holder, department],
      );
      await client.query(
        `INSERT INTO customer_account_bindings (id,user_id,customer_id,department_id,updated_at)
      VALUES ($1,$2,$3,$4,now())`,
        [bindingId, externalUser, customer, department],
      );
      await client.query(
        `INSERT INTO leads (id,department_id,business_no,customer_id,rights_holder_id,responsible_user_id,
      status,case_type,source,platform,found_at,shop_name,need_disclose,version,pushed_at,pushed_by_user_id,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,'WAITING_REVIEW','CIVIL','ONLINE','TAOBAO',now(),$7,false,2,now(),$6,now())`,
        [leadId, department, `${tag}-lead`, customer, holder, userA, tag],
      );
      await client.query(
        `INSERT INTO lead_review_decisions
      (id,department_id,lead_id,customer_id,reviewer_user_id,customer_account_binding_id,
       reviewer_display_name_snapshot,result,from_version,to_version)
      VALUES ($1,$2,$3,$4,$5,$6,'外部客户','INFRINGEMENT',2,3)`,
        [decisionId, department, leadId, customer, externalUser, bindingId],
      );
      await client.query(
        `UPDATE leads SET active_review_decision_id=$2,status='WAITING_EVIDENCE_DECISION',version=3
      WHERE id=$1`,
        [leadId, decisionId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  };
  const seedExternalCaseForEpoch = async () => {
    // Before 187, create a real external-entry root with its audit and receipt.
    // The original notary path needs an issued certificate and cannot be faked.
    const entryId = randomUUID();
    const auditId = randomUUID();
    const timing = (
      await client.query(
        "SELECT clock_timestamp()::timestamptz(3) AS recorded_at,(now() AT TIME ZONE 'Asia/Shanghai')::date::text AS stage_date",
      )
    ).rows[0];
    const businessNo = `${tag}-case`;
    const source = '合成旧版外录案件';
    const reason = '验证正式外录来源和负责人版本';
    const known = {
      courtId: null,
      courtCaseNo: null,
      acceptedOn: null,
      secondInstanceAcceptedOn: null,
      platform: null,
      shopName: null,
      shopExternalId: null,
      caseType: null,
      infringementTypes: null,
    };
    const idempotencyKey = randomUUID();
    const normalizedRequest = {
      idempotencyKey,
      entryKind: 'EXTERNAL_TRANSFER',
      initialStage: 'PENDING_MATCH',
      stageReachedOn: timing.stage_date,
      source,
      reason,
      customerId: customer,
      rightsHolderId: holder,
      defendants: [],
      lawyerAccountId: null,
      lawyerProfileId: null,
      known,
    };
    const requestFingerprint = createHash('sha256')
      .update(
        JSON.stringify({ ...normalizedRequest, idempotencyKey: undefined }),
      )
      .digest('hex');
    await client.query('BEGIN');
    try {
      await client.query(
        'INSERT INTO cases (id,business_no,department_id,customer_id,rights_holder_id,responsible_user_id) VALUES ($1,$2,$3,$4,$5,$6)',
        [caseId, businessNo, department, customer, holder, userA],
      );
      await client.query(
        `INSERT INTO audit_events
        (id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action,details)
        VALUES ($1,$2,$3,$3,'CASE',$4,'case.external-entry.created',$5)`,
        [
          auditId,
          department,
          userA,
          caseId,
          {
            entryId,
            entryKind: 'EXTERNAL_TRANSFER',
            initialStage: 'PENDING_MATCH',
            stageReachedOn: timing.stage_date,
            source,
            reason,
          },
        ],
      );
      await client.query(
        `INSERT INTO case_external_entries
        (id,case_id,department_id,entry_kind,initial_stage,stage_reached_on,source,reason,
         known,recorded_by_user_id,recorded_at,audit_event_id)
        VALUES ($1,$2,$3,'EXTERNAL_TRANSFER','PENDING_MATCH',$4,$5,$6,$7,$8,$9,$10)`,
        [
          entryId,
          caseId,
          department,
          timing.stage_date,
          source,
          reason,
          known,
          userA,
          timing.recorded_at,
          auditId,
        ],
      );
      await client.query(
        `INSERT INTO case_external_entry_receipts
        (id,department_id,actor_user_id,case_id,idempotency_key,request_fingerprint,result_snapshot)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          randomUUID(),
          department,
          userA,
          caseId,
          idempotencyKey,
          requestFingerprint,
          {
            id: caseId,
            businessNo,
            stage: 'PENDING_MATCH',
            version: 1,
            entryId,
            recordedAt: timing.recorded_at.toISOString(),
          },
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  };
  let created = false;
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS db, current_schema() AS schema',
      )
    ).rows[0];
    if (identity.db !== databaseName || identity.schema !== 'public')
      throw new Error('Unexpected PostgreSQL namespace');
    await client.query(`CREATE SCHEMA ${quoted}`);
    created = true;
    await client.query(`SET search_path TO ${quoted}`);
    const migrations = readdirSync(resolve(root, 'backend/prisma/migrations'))
      .filter((name) => /^\d{14}_/u.test(name) && name <= finalMigration)
      .sort();
    if (
      !migrations.includes('20261027120000_batch2_proxy_flows') ||
      migrations.at(-1) !== finalMigration
    )
      throw new Error('The 186/187 migration chain is incomplete');
    for (const name of migrations) {
      if (name === '20261027120000_batch2_proxy_flows')
        await seedOldExternalDecision();
      await client.query(
        readFileSync(
          resolve(root, 'backend/prisma/migrations', name, 'migration.sql'),
          'utf8',
        ),
      );
      if (name === '20261027120000_batch2_proxy_flows')
        await seedExternalCaseForEpoch();
    }
    const legacy = (
      await client.query(
        `SELECT actor_kind,customer_account_binding_id,internal_actor_user_id
      FROM lead_review_decisions WHERE id=$1`,
        [decisionId],
      )
    ).rows[0];
    if (
      legacy?.actor_kind !== 'CLIENT' ||
      legacy.customer_account_binding_id !== bindingId ||
      legacy.internal_actor_user_id !== null
    )
      throw new Error('Legacy external review was rewritten by 186/187');
    await client.query('BEGIN');
    await expectSqlState(
      client,
      `UPDATE lead_review_decisions SET actor_kind='INTERNAL_PROXY'
      WHERE id=$1`,
      [decisionId],
      '23514',
    );
    await client.query('ROLLBACK');
    const tables = (
      await client.query(
        `SELECT table_name FROM information_schema.tables
      WHERE table_schema=$1 AND table_name = ANY($2::text[])`,
        [
          schema,
          [
            'calendar_manual_items',
            'calendar_reminder_reads',
            'case_refund_applications',
          ],
        ],
      )
    ).rows.map((row) => row.table_name);
    if (tables.length !== 3) throw new Error('187 tables are incomplete');
    await client.query('BEGIN');
    const epoch = async () =>
      Number(
        (
          await client.query(
            'SELECT responsibility_epoch FROM cases WHERE id=$1',
            [caseId],
          )
        ).rows[0].responsibility_epoch,
      );
    if ((await epoch()) !== 0)
      throw new Error('Initial case responsibility epoch differs');
    await client.query('UPDATE cases SET business_no=$2 WHERE id=$1', [
      caseId,
      `${tag}-revised`,
    ]);
    if ((await epoch()) !== 0)
      throw new Error('Unrelated case update changed responsibility epoch');
    await client.query('UPDATE cases SET responsible_user_id=$2 WHERE id=$1', [
      caseId,
      userB,
    ]);
    if ((await epoch()) !== 1)
      throw new Error('First transfer did not advance responsibility epoch');
    await client.query('UPDATE cases SET responsible_user_id=$2 WHERE id=$1', [
      caseId,
      userA,
    ]);
    if ((await epoch()) !== 2)
      throw new Error(
        'A-B-A transfer did not advance responsibility epoch twice',
      );
    await expectSqlState(
      client,
      `INSERT INTO calendar_reminder_reads
      (id,department_id,owner_user_id,source_type,source_id,source_epoch,event_date)
      VALUES ($1,$2,$3,'INVALID',$4,'old','2026-10-27')`,
      [randomUUID(), department, userA, randomUUID()],
      '23514',
    );
    await expectSqlState(
      client,
      `INSERT INTO case_refund_applications
      (id,department_id,case_id,source_type,source_id,applicant_user_id,application_date)
      VALUES ($1,$2,$3,'INVALID',$4,$5,'2026-10-27')`,
      [randomUUID(), department, caseId, randomUUID(), userA],
      '23514',
    );
    await expectSqlState(
      client,
      `INSERT INTO case_refund_applications
      (id,department_id,case_id,source_type,source_id,applicant_user_id,application_date)
      VALUES ($1,$2,$3,'FIRST_INSTANCE_JUDGMENT',$4,$5,'2026-10-27')`,
      [randomUUID(), department, caseId, randomUUID(), userA],
      '23514',
    );
    await client.query('ROLLBACK');
    return {
      migrationCount: migrations.length,
      tables: tables.sort(),
      epoch: [0, 0, 1, 2],
      invalidTypesRejected: true,
      legacyExternalPreserved: true,
    };
  } finally {
    if (created) {
      await client.query('ROLLBACK');
      await client.query('RESET search_path');
      await client.query(`DROP SCHEMA ${quoted} CASCADE`);
    }
    await client.end();
  }
}

export async function readBatch2ProxyAudit(kind, id) {
  const target = assertBatch2Admission();
  const relation = {
    review: {
      table: 'lead_review_decisions',
      field: 'lead_id',
      binding: 'customer_account_binding_id',
      detail: 'result::text AS result,decided_at AS occurred_at',
    },
    withdrawal: {
      table: 'lead_withdrawal_confirmations',
      field: 'application_id',
      binding: 'customer_account_binding_id',
      detail:
        "result_snapshot->>'status' AS result,confirmed_at AS occurred_at",
    },
    certificate: {
      table: 'notary_certificates',
      field: 'matter_id',
      binding: 'notary_office_account_binding_id',
      detail: 'certificate_no AS result,issued_at AS occurred_at',
    },
  }[kind];
  if (!relation || !/^[0-9a-f-]{36}$/u.test(id))
    throw new Error('Unknown proxy audit source');
  const client = new Client({ connectionString: target.databaseUrl });
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS db, current_schema() AS schema',
      )
    ).rows[0];
    if (identity.db !== databaseName || identity.schema !== 'public')
      throw new Error('Unexpected proxy audit namespace');
    return (
      await client.query(
        `SELECT actor_kind,internal_actor_user_id,${relation.binding} AS binding_id,
      ${kind === 'certificate' ? 'actor_user_id' : kind === 'review' ? 'reviewer_user_id' : 'actor_user_id'} AS actor_user_id,
      ${relation.detail}
      FROM ${relation.table} WHERE ${relation.field}=$1`,
        [id],
      )
    ).rows;
  } finally {
    await client.end();
  }
}

export async function readBatch2CertificateDownstream(matterId, caseId) {
  const target = assertBatch2Admission();
  if (!/^[0-9a-f-]{36}$/u.test(matterId) || !/^[0-9a-f-]{36}$/u.test(caseId))
    throw new Error('Unknown certificate source');
  const client = new Client({ connectionString: target.databaseUrl });
  await client.connect();
  try {
    const certificate = (
      await client.query(
        'SELECT id FROM notary_certificates WHERE matter_id=$1',
        [matterId],
      )
    ).rows[0];
    if (!certificate) throw new Error('Proxy certificate fact absent');
    const fees = Number(
      (
        await client.query(
          'SELECT count(*)::integer AS n FROM notary_certificate_fees WHERE certificate_id=$1',
          [certificate.id],
        )
      ).rows[0].n,
    );
    const evidence = Number(
      (
        await client.query(
          'SELECT count(*)::integer AS n FROM evidence_items WHERE case_id=$1 AND source_notary_matter_id=$2',
          [caseId, matterId],
        )
      ).rows[0].n,
    );
    const feeRecords = Number(
      (
        await client.query(
          `SELECT count(*)::integer AS n FROM fee_records
      WHERE case_id=$1 AND source='auto' AND source_kind IN ('NOTARY_CERTIFICATE_FEE','NOTARY_MATTER_EVIDENCE')`,
          [caseId],
        )
      ).rows[0].n,
    );
    return { fees, evidence, feeRecords };
  } finally {
    await client.end();
  }
}
