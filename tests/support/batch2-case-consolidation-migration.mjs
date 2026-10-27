import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { assertBatch2CaseConsolidationTarget } from './batch2-case-consolidation-database.mjs';

const root = process.cwd();
const target = '20261027140000_batch2_case_consolidation';
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');

export async function cleanupBatch2CaseConsolidationMigration(
  client,
  schema,
  connected,
  created,
  primaryError,
) {
  const cleanupErrors = [];
  if (connected) {
    try {
      await client.query('ROLLBACK');
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (created) {
      if (!/^batch2_consolidation_[a-f0-9]{32}$/u.test(schema)) {
        cleanupErrors.push(new Error('Invalid owned consolidation schema'));
      } else {
        try {
          await client.query('RESET search_path');
        } catch (error) {
          cleanupErrors.push(error);
        }
        try {
          await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        } catch (error) {
          cleanupErrors.push(error);
        }
        try {
          const remains = (
            await client.query(
              'SELECT count(*)::int AS count FROM pg_namespace WHERE nspname=$1',
              [schema],
            )
          ).rows[0].count;
          if (remains !== 0)
            throw new Error('Owned consolidation schema remains');
        } catch (error) {
          cleanupErrors.push(error);
        }
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
      'Consolidation migration check and cleanup failed',
    );
  if (primaryError) throw primaryError;
  if (cleanupErrors.length)
    throw new AggregateError(
      cleanupErrors,
      'Consolidation migration cleanup failed',
    );
}

export async function verifyBatch2CaseConsolidationMigration() {
  const databaseUrl = assertBatch2CaseConsolidationTarget();
  const migrationRoot = resolve(root, 'backend/prisma/migrations');
  const names = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/u.test(name) && name <= target)
    .sort();
  if (names.at(-1) !== target)
    throw new Error('Batch 2 consolidation migration is missing');
  const schema = `batch2_consolidation_${randomUUID().replaceAll('-', '')}`;
  const client = new Client({ connectionString: databaseUrl });
  let connected = false;
  let created = false;
  let primaryError;
  let result;
  const query = (sql, values = []) => client.query(sql, values);
  const count = async (sql, values = []) =>
    Number((await query(sql, values)).rows[0].n);
  const apply = async (namesToApply) => {
    for (const name of namesToApply)
      await query(
        await readFile(resolve(migrationRoot, name, 'migration.sql'), 'utf8'),
      );
  };
  const reject = async (sql, values = []) => {
    await query('BEGIN');
    try {
      await query(sql, values);
      await query('COMMIT');
      return null;
    } catch (error) {
      await query('ROLLBACK');
      return error.code;
    }
  };
  try {
    await client.connect();
    connected = true;
    if (
      (await query('SELECT current_database() AS name')).rows[0].name !==
      'dev_cor_test'
    )
      throw new Error('Unexpected database');
    await query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await query(`SET search_path TO "${schema}"`);
    const numberingMigration = '20261026100000_v6_business_numbering';
    await apply(names.filter((name) => name < numberingMigration));
    const before = await count(
      "SELECT count(*) AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name='case_consolidations'",
      [schema],
    );
    const departmentId = randomUUID();
    const actorId = randomUUID();
    const mainId = randomUUID();
    const childId = randomUUID();
    const customerId = randomUUID();
    const rightsHolderId = randomUUID();
    const contactId = randomUUID();
    await query('BEGIN');
    try {
      const historicalTime = (
        await query(
          `SELECT to_char(date_trunc('milliseconds', now()) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS recorded_at,
            ((now() AT TIME ZONE 'Asia/Shanghai')::date)::text AS stage_reached_on`,
        )
      ).rows[0];
      await query(
        'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
        [departmentId, 'Batch 2 synthetic'],
      );
      await query(
        'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
        [actorId, `b2-${actorId}`, 'Batch 2 actor'],
      );
      await query(
        'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
        [randomUUID(), actorId, departmentId],
      );
      await query(
        "INSERT INTO customers(id,name,normalized_name,customer_type,identity_type,identity_number,normalized_identity_number,identity_validity_mode,admission_contact_name,admission_contact_phone,compatibility_contact_id,admission_contact_snapshot_name,admission_contact_snapshot_phone,admission_contact_snapshot_source,admission_contact_snapshot_frozen_at,department_id,responsible_user_id,profile_status,admitted_at,ever_admitted,updated_at) VALUES ($1,$2,$2,'ENTERPRISE','BUSINESS_LICENSE',$3,$3,'LONG_TERM',$4,$5,$6,$4,$5,'NEW_ADMISSION',now(),$7,$8,'ADMITTED',now(),true,now())",
        [
          customerId,
          `Batch2 ${schema}`,
          `91310000${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`,
          '合成历史联系人',
          '13800000000',
          contactId,
          departmentId,
          actorId,
        ],
      );
      await query(
        "INSERT INTO customer_contacts(id,customer_id,department_id,name,phone,is_primary,origin,created_by_user_id) VALUES ($1,$2,$3,$4,$5,true,'ADMISSION_FREEFORM',$6)",
        [
          contactId,
          customerId,
          departmentId,
          '合成历史联系人',
          '13800000000',
          actorId,
        ],
      );
      await query(
        "INSERT INTO customer_contact_versions(id,contact_id,version,action,before,after,actor_user_id,source) VALUES ($1,$2,1,'CREATED',NULL,$3,$4,'HUMAN')",
        [
          randomUUID(),
          contactId,
          {
            name: '合成历史联系人',
            phone: '13800000000',
            email: null,
            duty: null,
            isPrimary: true,
            endedAt: null,
            endReason: null,
          },
          actorId,
        ],
      );
      await query(
        'INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,$2,$3,now())',
        [rightsHolderId, `Batch2 holder ${schema}`, departmentId],
      );
      await query(
        'INSERT INTO customer_rights_holder_links(id,customer_id,rights_holder_id,department_id) VALUES ($1,$2,$3,$4)',
        [randomUUID(), customerId, rightsHolderId, departmentId],
      );
      for (const [index, caseId] of [mainId, childId].entries()) {
        const auditId = randomUUID();
        const entryId = randomUUID();
        const businessNo = `CA-B2-${index}-${schema}`;
        const source = `Batch2 ${schema}`;
        const reason = 'Historical valid external case before migration 188';
        await query(
          "INSERT INTO cases(id,business_no,department_id,customer_id,rights_holder_id,responsible_user_id,stage,version) VALUES ($1,$2,$3,$4,$5,$6,'PENDING_MATCH',1)",
          [
            caseId,
            businessNo,
            departmentId,
            customerId,
            rightsHolderId,
            actorId,
          ],
        );
        await query(
          "INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action,details) VALUES ($1,$2,$3,$3,'CASE',$4,'case.external-entry.created',$5)",
          [
            auditId,
            departmentId,
            actorId,
            caseId,
            {
              entryId,
              entryKind: 'EXTERNAL_TRANSFER',
              initialStage: 'PENDING_MATCH',
              stageReachedOn: historicalTime.stage_reached_on,
              source,
              reason,
            },
          ],
        );
        await query(
          "INSERT INTO case_external_entries(id,case_id,department_id,entry_kind,initial_stage,stage_reached_on,source,reason,known,recorded_by_user_id,recorded_at,audit_event_id) VALUES ($1,$2,$3,'EXTERNAL_TRANSFER','PENDING_MATCH',$4,$5,$6,$7,$8,$9,$10)",
          [
            entryId,
            caseId,
            departmentId,
            historicalTime.stage_reached_on,
            source,
            reason,
            {
              courtId: null,
              courtCaseNo: null,
              acceptedOn: null,
              secondInstanceAcceptedOn: null,
              platform: 'TAOBAO',
              shopName: 'Batch 2 shop',
              shopExternalId: 'batch2-shop',
              caseType: 'CIVIL',
              infringementTypes: null,
            },
            actorId,
            historicalTime.recorded_at,
            auditId,
          ],
        );
        await query(
          'INSERT INTO case_external_entry_receipts(id,department_id,actor_user_id,case_id,idempotency_key,request_fingerprint,result_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [
            randomUUID(),
            departmentId,
            actorId,
            caseId,
            `batch2-history-${caseId}`,
            'a'.repeat(64),
            {
              id: caseId,
              businessNo,
              stage: 'PENDING_MATCH',
              version: 1,
              entryId,
              recordedAt: historicalTime.recorded_at,
            },
          ],
        );
      }
      await query('COMMIT');
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
    await apply(
      names.filter((name) => name >= numberingMigration && name < target),
    );
    await apply([target]);
    const preserved = await count(
      "SELECT count(*) AS n FROM cases WHERE id = ANY($1::uuid[]) AND stage = 'PENDING_MATCH' AND version = 1",
      [[mainId, childId]],
    );
    const tables = await count(
      "SELECT count(*) AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name IN ('case_consolidations','case_consolidation_members','case_consolidation_receipts','case_filing_consolidation_sources')",
      [schema],
    );
    const failedRootId = randomUUID();
    const incompleteRoot = await reject(
      'INSERT INTO case_consolidations(id,department_id,main_case_id,created_by_user_id) VALUES ($1,$2,$3,$4)',
      [failedRootId, departmentId, mainId, actorId],
    );
    const rootAfterFailed = await count(
      'SELECT count(*) AS n FROM case_consolidations WHERE id=$1',
      [failedRootId],
    );
    const incompleteRootRetry = await reject(
      'INSERT INTO case_consolidations(id,department_id,main_case_id,created_by_user_id) VALUES ($1,$2,$3,$4)',
      [failedRootId, departmentId, mainId, actorId],
    );
    const consolidationId = randomUUID();
    await query('BEGIN');
    await query('UPDATE cases SET version=2 WHERE id = ANY($1::uuid[])', [
      [mainId, childId],
    ]);
    await query(
      'INSERT INTO case_consolidations(id,department_id,main_case_id,created_by_user_id) VALUES ($1,$2,$3,$4)',
      [consolidationId, departmentId, mainId, actorId],
    );
    for (const [index, caseId] of [mainId, childId].entries())
      await query(
        "INSERT INTO case_consolidation_members(consolidation_id,case_id,department_id,is_main,original_version,defendant_kind,defendant_name,defendant_id_no) VALUES ($1,$2,$3,$4,1,'PERSON','合成被告','110101200001011234')",
        [consolidationId, caseId, departmentId, index === 0],
      );
    await query(
      'INSERT INTO case_consolidation_receipts(id,consolidation_id,department_id,actor_user_id,idempotency_key,request_fingerprint,result_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [
        randomUUID(),
        consolidationId,
        departmentId,
        actorId,
        'b2-key',
        'a'.repeat(64),
        { mainCaseId: mainId },
      ],
    );
    await query('COMMIT');
    const childProgress = await reject(
      "UPDATE cases SET stage='WAITING_COMPLAINT',version=3 WHERE id=$1",
      [childId],
    );
    const immutableMember = await reject(
      'UPDATE case_consolidation_members SET defendant_name=$2 WHERE case_id=$1',
      [childId, '变更'],
    );
    const mainProgress = await reject(
      'UPDATE cases SET version=3 WHERE id=$1',
      [mainId],
    );
    result = {
      before,
      preserved,
      tables,
      incompleteRoot,
      rootAfterFailed,
      incompleteRootRetry,
      childProgress,
      immutableMember,
      mainProgress,
    };
  } catch (error) {
    primaryError = error;
  }
  await cleanupBatch2CaseConsolidationMigration(
    client,
    schema,
    connected,
    created,
    primaryError,
  );
  return result;
}
