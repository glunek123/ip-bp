import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { assertBatch2UsernameTarget } from './batch2-username-guard.mjs';

const requireBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { Client } = requireBackend('pg');
const { hashPassword } = requireBackend('./dist/auth/password.js');
const { allocateCustomerBusinessId } = requireBackend(
  './dist/modules/business-numbering/business-numbering.service.js',
);

// Add only synthetic data in the dedicated tmpfs database. No shared fixture reset.
export async function seedBatch2UsernameFixture() {
  const url = assertBatch2UsernameTarget();
  const client = new Client({ connectionString: url });
  const departmentId = randomUUID();
  const adminId = randomUUID();
  const adminRoleId = randomUUID();
  const userRoleId = randomUUID();
  const customerId = randomUUID();
  const contactId = randomUUID();
  const officeId = randomUUID();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const adminUsername = `batch2.admin.${suffix}`;
  const adminPassword = `Batch2-admin-${suffix}-2026!`;
  const hash = await hashPassword(adminPassword);
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS db, current_schema() AS schema',
      )
    ).rows[0];
    if (identity.db !== 'dev_cor_test' || identity.schema !== 'public')
      throw new Error('Unexpected batch2 fixture namespace');
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES($1,$2,now())',
      [departmentId, `用户名验收部-${suffix}`],
    );
    await client.query(
      'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES($1,$2,$3,now())',
      [adminId, `local:${adminId}`, '合成主管'],
    );
    await client.query(
      'INSERT INTO local_credentials(id,user_id,username,password_hash,updated_at) VALUES($1,$2,$3,$4,now())',
      [randomUUID(), adminId, adminUsername, hash],
    );
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES($1,$2,$3,now())',
      [randomUUID(), adminId, departmentId],
    );
    for (const [id, name] of [
      [adminRoleId, '合成主管角色'],
      [userRoleId, '合成普通角色'],
    ])
      await client.query(
        'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES($1,$2,$3,now())',
        [id, departmentId, `${name}-${suffix}`],
      );
    const adminActions = [
      'user.read',
      'user.manage',
      'role.read',
      'role.assign',
      'customer.read',
      'customer.account.create',
      'notary.office.manage',
      'lawyer.account.manage',
    ];
    for (const action of adminActions)
      await client.query(
        'INSERT INTO role_grants(id,role_template_id,action,scope) VALUES($1,$2,$3,$4)',
        [randomUUID(), adminRoleId, action, 'DEPARTMENT'],
      );
    await client.query(
      'INSERT INTO role_grants(id,role_template_id,action,scope) VALUES($1,$2,$3,$4)',
      [randomUUID(), userRoleId, 'customer.read', 'DEPARTMENT'],
    );
    await client.query(
      'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,updated_at) VALUES($1,$2,$3,$4,now())',
      [randomUUID(), adminId, departmentId, adminRoleId],
    );
    // Use the production allocator in this transaction. The environment owner
    // performs the one-time empty-database cutover before this fixture runs.
    const businessId = await allocateCustomerBusinessId({
      $queryRawUnsafe: async (sql) => (await client.query(sql)).rows,
    });
    await client.query(
      `INSERT INTO customers(
      id,business_id,name,normalized_name,customer_type,identity_type,identity_number,
      normalized_identity_number,identity_validity_mode,
      department_id,responsible_user_id,updated_at)
      VALUES($1,$6,$2,$2,'ENTERPRISE','BUSINESS_LICENSE',$3,$3,'LONG_TERM',$4,$5,now())`,
      [
        customerId,
        `用户名验收企业-${suffix}`,
        `91310000${suffix.toUpperCase()}`,
        departmentId,
        adminId,
        businessId,
      ],
    );
    await client.query(
      `INSERT INTO customer_contacts(
      id,customer_id,department_id,name,phone,origin,created_by_user_id,updated_by_user_id)
      VALUES($1,$2,$3,'合成联系人','13800000000','ADMISSION_FREEFORM',$4,$4)`,
      [contactId, customerId, departmentId, adminId],
    );
    await client.query(
      `UPDATE customers SET profile_status='ADMITTED',admitted_at=now(),
      admission_contact_name='合成联系人',admission_contact_phone='13800000000',
      compatibility_contact_id=$2,
      admission_contact_snapshot_name='合成联系人',
      admission_contact_snapshot_phone='13800000000',
      admission_contact_snapshot_source='NEW_ADMISSION',
      admission_contact_snapshot_frozen_at=now(),version=version+1,updated_at=now()
      WHERE id=$1`,
      [customerId, contactId],
    );
    await client.query(
      'INSERT INTO notary_offices(id,department_id,name,created_by_user_id,updated_at) VALUES($1,$2,$3,$4,now())',
      [officeId, departmentId, `用户名验收公证处-${suffix}`, adminId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
  return {
    adminUsername,
    adminPassword,
    departmentId,
    userRoleId,
    customerId,
    officeId,
    suffix,
  };
}
