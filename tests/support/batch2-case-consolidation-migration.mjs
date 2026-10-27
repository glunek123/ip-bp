import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { assertBatch2CaseConsolidationTarget } from './batch2-case-consolidation-database.mjs';

const root = process.cwd();
const target = '20261027140000_batch2_case_consolidation';
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');

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
  await client.connect();
  try {
    if (
      (await query('SELECT current_database() AS name')).rows[0].name !==
      'dev_cor_test'
    )
      throw new Error('Unexpected database');
    await query(`CREATE SCHEMA "${schema}"`);
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
    await query('BEGIN');
    try {
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
        "INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,profile_status,admitted_at,ever_admitted,updated_at) VALUES ($1,$2,$2,$3,$4,'ADMITTED',now(),true,now())",
        [customerId, `Batch2 ${schema}`, departmentId, actorId],
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
        await query(
          "INSERT INTO cases(id,business_no,department_id,customer_id,rights_holder_id,responsible_user_id,stage,version) VALUES ($1,$2,$3,$4,$5,$6,'PENDING_MATCH',1)",
          [
            caseId,
            `CA-B2-${index}-${schema}`,
            departmentId,
            customerId,
            rightsHolderId,
            actorId,
          ],
        );
        await query(
          "INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action) VALUES ($1,$2,$3,$3,'CASE',$4,'case.external-entry.created')",
          [auditId, departmentId, actorId, caseId],
        );
        await query(
          "INSERT INTO case_external_entries(id,case_id,department_id,entry_kind,initial_stage,stage_reached_on,source,reason,known,recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,'EXTERNAL_TRANSFER','PENDING_MATCH',current_date,$4,$5,$6,$7,$8)",
          [
            randomUUID(),
            caseId,
            departmentId,
            `Batch2 ${schema}`,
            'Historical valid external case before migration 188',
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
            auditId,
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
    return {
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
  } finally {
    await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(
      () => undefined,
    );
    await client.end();
  }
}
