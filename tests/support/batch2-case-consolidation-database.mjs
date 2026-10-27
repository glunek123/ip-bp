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
    !/^[a-f0-9]{64}$/u.test(
      process.env.DEV_COR_TEST_DATABASE_CONTAINER_ID ?? '',
    ) ||
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
  const { allocateCustomerBusinessId } = requireBackend(
    './dist/modules/business-numbering/business-numbering.service.js',
  );
  const client = new Client({ connectionString: databaseUrl });
  const run = randomUUID();
  const departmentId = randomUUID();
  const userId = randomUUID();
  const customerId = randomUUID();
  const holderId = randomUUID();
  const roleId = randomUUID();
  const lawyerUserId = randomUUID();
  const lawyerProfileId = randomUUID();
  const username = `batch2-${run}`;
  const password = `Batch2-${randomUUID()}`;
  const passwordHash = await hashPassword(password);
  const businessTag = `Batch2 shop ${run}`;
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS name,current_schema() AS schema',
      )
    ).rows[0];
    if (identity.name !== 'dev_cor_test' || identity.schema !== 'public')
      throw new Error('Unexpected batch 2 database');
    await client.query('BEGIN');
    const numbering = (
      await client.query(
        'SELECT last_value FROM customer_business_number_counters WHERE singleton_id=1 FOR UPDATE',
      )
    ).rows[0];
    if (!numbering || BigInt(numbering.last_value) < 0n)
      throw new Error('Root-owned empty numbering initialization is required');
    const businessId = await allocateCustomerBusinessId({
      $queryRawUnsafe: async (sql, ...values) =>
        (await client.query(sql, values)).rows,
    });
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
      "INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,$2,$3,'LAWYER',now())",
      [lawyerUserId, `batch2-lawyer:${run}`, 'Batch 2 synthetic lawyer'],
    );
    await client.query(
      'INSERT INTO local_credentials(id,user_id,username,password_hash,updated_at) VALUES ($1,$2,$3,$4,now())',
      [randomUUID(), lawyerUserId, `batch2-lawyer-${run}`, passwordHash],
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
      ['customer.read', 'DEPARTMENT'],
      ['customer.account.create', 'DEPARTMENT'],
      ['case.external-entry.create', 'SELF'],
      ['case.consolidate', 'SELF'],
      ['case.match', 'SELF'],
      ['case.complaint.submit', 'SELF'],
      ['case.complaint.confirm', 'SELF'],
      ['case.complaint.mail', 'SELF'],
      ['case.filing.submit', 'SELF'],
      ['fee.read', 'DEPARTMENT'],
      ['lead.read', 'DEPARTMENT'],
      ['lead.create', 'SELF'],
      ['lead.push', 'SELF'],
      ['lead.review.proxy', 'SELF'],
      ['notary.office.manage', 'DEPARTMENT'],
      ['notary.evidence.record', 'SELF'],
      ['notary.unbox.record', 'SELF'],
      ['notary.opening.review', 'SELF'],
      ['notary.issuance.decide', 'SELF'],
      ['notary.certificate.issue.proxy', 'SELF'],
    ])
      await client.query(
        'INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,$3,$4)',
        [randomUUID(), roleId, action, scope],
      );
    await client.query(
      "INSERT INTO customers(id,business_id,name,normalized_name,customer_type,identity_type,identity_number,normalized_identity_number,identity_validity_mode,admission_contact_snapshot_name,admission_contact_snapshot_phone,admission_contact_snapshot_source,admission_contact_snapshot_frozen_at,department_id,responsible_user_id,profile_status,admitted_at,ever_admitted,updated_at) VALUES ($1,$2,$3,$4,'ENTERPRISE','BUSINESS_LICENSE',$5,$5,'LONG_TERM','合成联系人','13800000000','NEW_ADMISSION',now(),$6,$7,'ADMITTED',now(),true,now())",
      [
        customerId,
        businessId,
        `Batch 2 customer ${run}`,
        `batch2 customer ${run}`,
        `91310000${run.replaceAll('-', '').slice(0, 16).toUpperCase()}`,
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
    await client.query(
      'INSERT INTO lawyer_profiles(id,department_id,full_name,bound_user_id) VALUES ($1,$2,$3,$4)',
      [lawyerProfileId, departmentId, `Batch2 lawyer ${run}`, lawyerUserId],
    );
    await client.query(
      'INSERT INTO lawyer_account_bindings(id,user_id,department_id,profile_id,updated_at) VALUES ($1,$2,$3,$4,now())',
      [randomUUID(), lawyerUserId, departmentId, lawyerProfileId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
  return {
    run,
    businessTag,
    shopExternalId: `shop-${run}`,
    departmentId,
    userId,
    customerId,
    holderId,
    lawyerUserId,
    lawyerProfileId,
    username,
    password,
    cases: [],
  };
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

export async function addBatch2OriginalCaseFees(departmentId, userId, cases) {
  const client = new Client({
    connectionString: assertBatch2CaseConsolidationTarget(),
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    const feeIds = [];
    for (const [index, item] of cases.entries()) {
      const feeId = randomUUID();
      await client.query(
        "INSERT INTO fee_records(id,case_id,department_id,type,direction,status,amount,fee_date,source,actor_user_id,idempotency_key) VALUES ($1,$2,$3,'公证费','支出','已支付',10,current_date,'manual',$4,$5)",
        [feeId, item.id, departmentId, userId, `batch2-fee-${index}-${feeId}`],
      );
      feeIds.push(feeId);
    }
    await client.query('COMMIT');
    return feeIds;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
