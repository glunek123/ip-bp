import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { assertBatch2Admission } from './batch2-proxy-calendar-acceptance.mjs';

const backend = createRequire(resolve(process.cwd(), 'backend/package.json'));
const { Client } = backend('pg');
const { hashPassword } = backend('./dist/auth/password.js');
const { allocateCustomerBusinessId } = backend(
  './dist/modules/business-numbering/business-numbering.service.js',
);

// Every row belongs to this suite's random departments. No core fixture IDs,
// reset, trigger disabling or target review/certificate/judgment facts.
export async function seedBatch2ProxyCalendarActors() {
  const { databaseUrl } = assertBatch2Admission();
  const client = new Client({ connectionString: databaseUrl });
  const id = () => randomUUID();
  const suffix = id().replaceAll('-', '').slice(0, 12);
  const departmentId = id();
  const foreignDepartmentId = id();
  const operator = {
    id: id(),
    username: `b2.proxy.${suffix}`,
    password: `B2Proxy-${suffix}-2026!`,
  };
  const colleague = {
    id: id(),
    username: `b2.colleague.${suffix}`,
    password: `B2Colleague-${suffix}-2026!`,
  };
  const foreign = {
    id: id(),
    username: `b2.foreign.${suffix}`,
    password: `B2Foreign-${suffix}-2026!`,
  };
  const clientAccount = {
    id: id(),
    username: `b2.client.${suffix}`,
    password: `B2Client-${suffix}-2026!`,
  };
  const customers = { withAccount: id(), withoutAccount: id() };
  const rightsHolderId = id();
  const roleIds = { operator: id(), colleague: id(), foreign: id() };
  const actions = [
    'customer.read',
    'lead.read',
    'lead.create',
    'lead.push',
    'lead.review.proxy',
    'lead.withdraw.apply',
    'lead.withdraw.confirm.proxy',
    'lead.evidence.decide',
    'notary.office.manage',
    'notary.evidence.record',
    'notary.unbox.record',
    'notary.opening.review',
    'notary.issuance.decide',
    'notary.certificate.issue.proxy',
    'case.read',
    'case.external-entry.create',
    'case.judgment.register',
    'case.judgment.correct',
    'case.refund.application.record',
  ];
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS db, current_schema() AS schema',
      )
    ).rows[0];
    if (identity.db !== 'dev_cor_test' || identity.schema !== 'public')
      throw new Error('Unexpected proxy/calendar database namespace');
    await client.query('BEGIN');
    const numbering = (
      await client.query(
        'SELECT last_value FROM customer_business_number_counters WHERE singleton_id=1 FOR UPDATE',
      )
    ).rows[0];
    if (!numbering || BigInt(numbering.last_value) < 0n)
      throw new Error(
        'Root-owned empty-database numbering initialization is required',
      );
    const customerBusinessIds = [];
    const numberTx = {
      $queryRawUnsafe: async (sql) => (await client.query(sql)).rows,
    };
    for (let index = 0; index < 2; index += 1)
      customerBusinessIds.push(await allocateCustomerBusinessId(numberTx));
    for (const [department, label] of [
      [departmentId, '本部'],
      [foreignDepartmentId, '外部部门'],
    ])
      await client.query(
        'INSERT INTO departments(id,name,updated_at) VALUES($1,$2,now())',
        [department, `批次代办${label}-${suffix}`],
      );
    for (const [account, kind] of [
      [operator, 'INTERNAL'],
      [colleague, 'INTERNAL'],
      [foreign, 'INTERNAL'],
      [clientAccount, 'CLIENT'],
    ]) {
      await client.query(
        'INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES($1,$2,$3,$4,now())',
        [account.id, `batch2:${account.id}`, account.username, kind],
      );
      await client.query(
        'INSERT INTO local_credentials(id,user_id,username,password_hash,updated_at) VALUES($1,$2,$3,$4,now())',
        [
          id(),
          account.id,
          account.username,
          await hashPassword(account.password),
        ],
      );
    }
    for (const [account, department] of [
      [operator, departmentId],
      [colleague, departmentId],
      [foreign, foreignDepartmentId],
    ])
      await client.query(
        'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES($1,$2,$3,now())',
        [id(), account.id, department],
      );
    for (const [role, department, name] of [
      [roleIds.operator, departmentId, 'operator'],
      [roleIds.colleague, departmentId, 'colleague'],
      [roleIds.foreign, foreignDepartmentId, 'foreign'],
    ])
      await client.query(
        'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES($1,$2,$3,now())',
        [role, department, `batch2-${name}-${suffix}`],
      );
    for (const [account, department, role] of [
      [operator, departmentId, roleIds.operator],
      [colleague, departmentId, roleIds.colleague],
      [foreign, foreignDepartmentId, roleIds.foreign],
    ])
      await client.query(
        'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,updated_at) VALUES($1,$2,$3,$4,now())',
        [id(), account.id, department, role],
      );
    for (const action of actions)
      await client.query(
        "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES($1,$2,$3,'DEPARTMENT')",
        [id(), roleIds.operator, action],
      );
    for (const [role, action] of [
      [roleIds.colleague, 'case.read'],
      [roleIds.foreign, 'case.read'],
    ])
      await client.query(
        "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES($1,$2,$3,'DEPARTMENT')",
        [id(), role, action],
      );
    await client.query(
      'INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES($1,$2,$3,now())',
      [rightsHolderId, `批次权利主体-${suffix}`, departmentId],
    );
    for (const [customerId, ordinal, businessId] of [
      [customers.withAccount, 'A', customerBusinessIds[0]],
      [customers.withoutAccount, 'B', customerBusinessIds[1]],
    ]) {
      const name = `批次代办客户${ordinal}-${suffix}`;
      const identityNo = `91310000${suffix.toUpperCase()}${ordinal}`;
      await client.query(
        `INSERT INTO customers(id,business_id,name,normalized_name,customer_type,identity_type,identity_number,normalized_identity_number,identity_validity_mode,admitted_at,profile_status,admission_contact_snapshot_name,admission_contact_snapshot_phone,admission_contact_snapshot_source,admission_contact_snapshot_frozen_at,department_id,responsible_user_id,ever_admitted,updated_at)
        VALUES($1,$2,$3,$3,'ENTERPRISE','BUSINESS_LICENSE',$4,$4,'LONG_TERM',now(),'ADMITTED','合成联系人','13800000000','NEW_ADMISSION',now(),$5,$6,true,now())`,
        [customerId, businessId, name, identityNo, departmentId, operator.id],
      );
      await client.query(
        'INSERT INTO customer_rights_holder_links(id,customer_id,rights_holder_id,department_id) VALUES($1,$2,$3,$4)',
        [id(), customerId, rightsHolderId, departmentId],
      );
    }
    await client.query(
      'INSERT INTO customer_account_bindings(id,user_id,customer_id,department_id,updated_at) VALUES($1,$2,$3,$4,now())',
      [id(), clientAccount.id, customers.withAccount, departmentId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
  return {
    departmentId,
    foreignDepartmentId,
    operator,
    colleague,
    foreign,
    clientAccount,
    customers,
    rightsHolderId,
    suffix,
  };
}

export async function transferBatch2SyntheticCaseOwner(
  caseId,
  departmentId,
  expectedOwnerId,
  newOwnerId,
) {
  const { databaseUrl } = assertBatch2Admission();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS db, current_schema() AS schema',
      )
    ).rows[0];
    if (identity.db !== 'dev_cor_test' || identity.schema !== 'public')
      throw new Error('Unexpected proxy/calendar database namespace');
    const result = await client.query(
      `UPDATE cases SET responsible_user_id=$4
       WHERE id=$1 AND department_id=$2 AND responsible_user_id=$3
       RETURNING responsibility_epoch`,
      [caseId, departmentId, expectedOwnerId, newOwnerId],
    );
    if (result.rowCount !== 1)
      throw new Error('Synthetic case owner changed unexpectedly');
    return Number(result.rows[0].responsibility_epoch);
  } finally {
    await client.end();
  }
}
