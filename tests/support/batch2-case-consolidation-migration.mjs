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
    await apply(names.slice(0, -1));
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
    await query('SET session_replication_role = replica');
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
      for (const [index, caseId] of [mainId, childId].entries()) {
        const leadId = randomUUID();
        await query(
          "INSERT INTO leads(id,department_id,business_no,customer_id,rights_holder_id,responsible_user_id,case_type,source,platform,found_at,shop_name,shop_external_id,need_disclose,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'CIVIL','ONLINE','TAOBAO',now(),'Batch 2 shop','batch2-shop',false,now())",
          [
            leadId,
            departmentId,
            `B2-lead-${index}-${schema}`,
            customerId,
            rightsHolderId,
            actorId,
          ],
        );
        await query(
          "INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING_MATCH',1)",
          [
            caseId,
            `B2-${index}-${schema}`,
            departmentId,
            leadId,
            randomUUID(),
            randomUUID(),
            customerId,
            rightsHolderId,
            actorId,
          ],
        );
      }
    } finally {
      await query('SET session_replication_role = origin');
    }
    await apply([target]);
    const preserved = await count(
      "SELECT count(*) AS n FROM cases WHERE id = ANY($1::uuid[]) AND stage = 'PENDING_MATCH' AND version = 1",
      [[mainId, childId]],
    );
    const tables = await count(
      "SELECT count(*) AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name IN ('case_consolidations','case_consolidation_members','case_consolidation_receipts','case_filing_consolidation_sources')",
      [schema],
    );
    const incompleteRoot = await reject(
      'INSERT INTO case_consolidations(id,department_id,main_case_id,created_by_user_id) VALUES ($1,$2,$3,$4)',
      [randomUUID(), departmentId, mainId, actorId],
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
