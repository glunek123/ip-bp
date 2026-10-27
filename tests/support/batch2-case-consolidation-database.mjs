import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const requireBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { Client } = requireBackend('pg');

export function assertBatch2CaseConsolidationTarget() {
  if (
    process.env.NODE_ENV !== 'test' ||
    process.env.DEV_COR_TEST_DATABASE_PROJECT !==
      'dev-cor-ops-batch2-20261027' ||
    process.env.DEV_COR_OPS_BATCH2_READY !== '1' ||
    !process.env.DEV_COR_TEST_DATABASE_CONTAINER_ID ||
    process.env.DEV_COR_TEST_DATABASE_CONTAINER_ID !==
      process.env.DEV_COR_OPS_BATCH2_OWNED_CONTAINER_ID
  )
    throw new Error('Batch 2 owned test target is not ready');
  const url = process.env.DEV_COR_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error('Batch 2 test database URL mismatch');
  const parsed = validateIsolatedTestDatabaseUrl(url, {
    allowRandomPort: true,
  });
  if (
    parsed.hostname !== '127.0.0.1' ||
    parsed.port !== 15440 ||
    parsed.database !== 'dev_cor_test' ||
    parsed.username !== 'dev_cor_test'
  )
    throw new Error('Batch 2 target must be the owned 15440 test database');
  return url;
}

export async function prepareBatch2CaseConsolidationFixture() {
  const databaseUrl = assertBatch2CaseConsolidationTarget();
  const { hashPassword } = requireBackend('./dist/auth/password.js');
  const client = new Client({ connectionString: databaseUrl });
  const run = randomUUID();
  const departmentId = randomUUID();
  const userId = randomUUID();
  const customerId = randomUUID();
  const holderId = randomUUID();
  const roleId = randomUUID();
  const username = `batch2-${run}`;
  const password = `Batch2-${randomUUID()}`;
  const passwordHash = await hashPassword(password);
  const businessTag = `B2-${run.slice(0, 8)}`;
  const cases = Array.from({ length: 23 }, (_, index) => ({
    id: randomUUID(),
    businessNo: `${businessTag}-${String(index + 1).padStart(2, '0')}`,
    feeId: index < 2 ? randomUUID() : null,
  }));
  await client.connect();
  try {
    const database = (await client.query('SELECT current_database() AS name'))
      .rows[0].name;
    if (database !== 'dev_cor_test')
      throw new Error('Unexpected batch 2 database');
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
      [departmentId, `Batch2 ${run}`],
    );
    await client.query(
      "INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,$2,$3,'INTERNAL',now())",
      [userId, `batch2:${run}`, 'Batch 2 synthetic operator'],
    );
    await client.query(
      'INSERT INTO local_credentials(id,user_id,username,password_hash,updated_at) VALUES ($1,$2,$3,$4,now())',
      [randomUUID(), userId, username, passwordHash],
    );
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [randomUUID(), userId, departmentId],
    );
    await client.query(
      'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,now())',
      [roleId, departmentId, `Batch2 ${run}`],
    );
    await client.query(
      'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,active,updated_at) VALUES ($1,$2,$3,$4,true,now())',
      [randomUUID(), userId, departmentId, roleId],
    );
    for (const [action, scope] of [
      ['case.read', 'DEPARTMENT'],
      ['case.export', 'DEPARTMENT'],
      ['case.consolidate', 'SELF'],
      ['case.match', 'SELF'],
      ['case.filing.submit', 'SELF'],
      ['fee.read', 'DEPARTMENT'],
    ])
      await client.query(
        'INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,$3,$4)',
        [randomUUID(), roleId, action, scope],
      );
    await client.query(
      'INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at) VALUES ($1,$2,$3,$4,$5,now())',
      [
        customerId,
        `Batch 2 customer ${run}`,
        `batch2 customer ${run}`,
        departmentId,
        userId,
      ],
    );
    await client.query(
      'INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [holderId, `Batch 2 holder ${run}`, departmentId],
    );
    await client.query(
      'INSERT INTO customer_rights_holder_links(id,customer_id,rights_holder_id,department_id) VALUES ($1,$2,$3,$4)',
      [randomUUID(), customerId, holderId, departmentId],
    );
    for (const [index, item] of cases.entries()) {
      const auditId = randomUUID();
      await client.query(
        "INSERT INTO cases(id,business_no,department_id,customer_id,rights_holder_id,responsible_user_id,stage,version,created_at) VALUES ($1,$2,$3,$4,$5,$6,'PENDING_MATCH',1,now()-($7::int * interval '1 second'))",
        [
          item.id,
          item.businessNo,
          departmentId,
          customerId,
          holderId,
          userId,
          index,
        ],
      );
      await client.query(
        "INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action) VALUES ($1,$2,$3,$3,'CASE',$4,'case.external-entry.recorded')",
        [auditId, departmentId, userId, item.id],
      );
      await client.query(
        "INSERT INTO case_external_entries(id,case_id,department_id,entry_kind,initial_stage,stage_reached_on,source,reason,known,recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,'HISTORICAL_BACKFILL','WAITING_FILING',current_date,$4,$5,$6,$7,$8)",
        [
          randomUUID(),
          item.id,
          departmentId,
          `Batch2 ${run}`,
          'Synthetic isolated case',
          {
            courtId: null,
            courtCaseNo: null,
            acceptedOn: null,
            secondInstanceAcceptedOn: null,
            platform: 'TAOBAO',
            shopName: 'Batch 2 shop',
            shopExternalId: `shop-${run}`,
            caseType: 'CIVIL',
            infringementTypes: null,
          },
          userId,
          auditId,
        ],
      );
      if (item.feeId)
        await client.query(
          "INSERT INTO fee_records(id,case_id,department_id,type,direction,status,amount,fee_date,source,actor_user_id,idempotency_key) VALUES ($1,$2,$3,'公证费','支出','已支付',10,current_date,'manual',$4,$5)",
          [
            item.feeId,
            item.id,
            departmentId,
            userId,
            `batch2-fee-${index}-${run}`,
          ],
        );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
  return { run, businessTag, departmentId, userId, username, password, cases };
}

export async function inspectBatch2CaseConsolidationFixture(
  departmentId,
  caseIds,
) {
  const client = new Client({
    connectionString: assertBatch2CaseConsolidationTarget(),
  });
  await client.connect();
  try {
    const feeRows = (
      await client.query(
        'SELECT id,case_id,amount::text AS amount FROM fee_records WHERE department_id=$1 AND case_id=ANY($2::uuid[]) ORDER BY id',
        [departmentId, caseIds],
      )
    ).rows;
    const relations = (
      await client.query(
        'SELECT case_id,is_main FROM case_consolidation_members WHERE department_id=$1 AND case_id=ANY($2::uuid[]) ORDER BY case_id',
        [departmentId, caseIds],
      )
    ).rows;
    return { feeRows, relations };
  } finally {
    await client.end();
  }
}

export async function prepareBatch2ConsolidatedFilingSource(
  departmentId,
  userId,
  mainCaseId,
  childCaseId,
) {
  const client = new Client({
    connectionString: assertBatch2CaseConsolidationTarget(),
  });
  const courtId = randomUUID();
  const materialId = randomUUID();
  const contentVersionId = randomUUID();
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "UPDATE cases SET stage='WAITING_FILING' WHERE id=$1 AND department_id=$2",
      [mainCaseId, departmentId],
    );
    await client.query(
      'INSERT INTO filing_courts(id,department_id,name) VALUES ($1,$2,$3)',
      [courtId, departmentId, `Batch2 court ${randomUUID()}`],
    );
    await client.query(
      "INSERT INTO materials(id,department_id,owner_type,owner_id,category,purpose) VALUES ($1,$2,'CASE',$3,'FILING_EVIDENCE','FILING_EVIDENCE')",
      [materialId, departmentId, childCaseId],
    );
    await client.query(
      "INSERT INTO content_versions(id,material_id,storage_key,original_filename,mime_type,size_bytes,sha256,uploaded_by) VALUES ($1,$2,$3,'batch2-source.pdf','application/pdf',4,$4,$5)",
      [
        contentVersionId,
        materialId,
        `batch2/${randomUUID()}`,
        'a'.repeat(64),
        userId,
      ],
    );
    await client.query(
      'UPDATE materials SET current_version_id=$2 WHERE id=$1',
      [materialId, contentVersionId],
    );
    await client.query('COMMIT');
    return { courtId, materialId, contentVersionId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
