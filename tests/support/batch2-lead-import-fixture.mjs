import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { assertBatch2ImportTarget } from './batch2-lead-import-target.mjs';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const { hashPassword } = requireBackend('./dist/auth/password.js');
const { allocateCustomerBusinessId } = requireBackend(
  './dist/modules/business-numbering/business-numbering.service.js',
);
const project = 'dev-cor-ops-batch2-20261027';
export const syntheticImageUrl = 'https://synthetic.batch2.test/image.png';
export const syntheticImageBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64',
);

// This is the I-only runtime guard. The normal E2E runner still owns its
// database/app lock; this additionally binds the controlled Nest process.
export function assertBatch2ImportOwnedRuntime() {
  const url = assertBatch2ImportTarget();
  if (
    process.env.PORT !== '3101' ||
    process.env.API_PROXY_TARGET !== 'http://127.0.0.1:3101' ||
    resolve(process.env.PRIVATE_FILE_ROOT ?? '') !==
      resolve(root, '.local/private-files/test')
  )
    throw new Error('Batch-2 import requires isolated app and file paths');
  const id = process.env.DEV_COR_TEST_DATABASE_CONTAINER_ID;
  const [container] = JSON.parse(
    execFileSync('docker', ['inspect', id], { encoding: 'utf8' }),
  );
  const binding = container?.NetworkSettings?.Ports?.['5432/tcp'];
  const labels = container?.Config?.Labels ?? {};
  if (
    container?.Id !== id ||
    container?.State?.Running !== true ||
    container?.Name !== `/${project}-postgres-test-1` ||
    labels['com.docker.compose.project'] !== project ||
    labels['com.docker.compose.service'] !== 'postgres-test' ||
    labels['com.docker.compose.container-number'] !== '1' ||
    !container?.Config?.Env?.includes('POSTGRES_DB=dev_cor_test') ||
    !container?.Config?.Env?.includes('POSTGRES_USER=dev_cor_test') ||
    !Array.isArray(binding) ||
    binding.length !== 1 ||
    binding[0].HostIp !== '127.0.0.1' ||
    binding[0].HostPort !== '15440'
  )
    throw new Error('Batch-2 import container identity differs');
  return url;
}

export async function seedBatch2LeadImportFixture() {
  const client = new Client({
    connectionString: assertBatch2ImportOwnedRuntime(),
  });
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const departmentId = randomUUID();
  const otherDepartmentId = randomUUID();
  const teamId = randomUUID();
  const customerId = randomUUID();
  const contactId = randomUUID();
  const holderId = randomUUID();
  const actors = Object.fromEntries(
    ['a', 'b', 'self', 'owner', 'other'].map((kind) => [
      kind,
      {
        id: randomUUID(),
        username: `b2i.${kind}.${suffix}`,
        displayName: `导入${kind}-${suffix}`,
        password: `Batch2-import-${suffix}-2026!`,
      },
    ]),
  );
  const hash = await hashPassword(actors.a.password);
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS db, current_schema() AS schema',
      )
    ).rows[0];
    if (identity.db !== 'dev_cor_test' || identity.schema !== 'public')
      throw new Error('Unexpected batch-2 import fixture namespace');
    const migrations = await client.query(
      `SELECT migration_name FROM _prisma_migrations
       WHERE migration_name='20261027160000_batch2_import_responsible_operator'
         AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    );
    if (migrations.rowCount !== 1)
      throw new Error('The complete batch-2 migration chain is required');
    await client.query('BEGIN');
    for (const [id, name] of [
      [departmentId, `导入验收部门-${suffix}`],
      [otherDepartmentId, `导入隔离部门-${suffix}`],
    ])
      await client.query(
        'INSERT INTO departments(id,name,updated_at) VALUES($1,$2,now())',
        [id, name],
      );
    await client.query(
      'INSERT INTO teams(id,department_id,name,updated_at) VALUES($1,$2,$3,now())',
      [teamId, departmentId, `目标团队-${suffix}`],
    );
    const roles = {
      department: randomUUID(),
      self: randomUUID(),
      other: randomUUID(),
    };
    for (const [kind, roleId] of Object.entries(roles))
      await client.query(
        'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES($1,$2,$3,now())',
        [
          roleId,
          kind === 'other' ? otherDepartmentId : departmentId,
          `导入${kind}-${suffix}`,
        ],
      );
    for (const action of [
      'customer.read',
      'lead.create',
      'lead.read',
      'lead.edit',
    ]) {
      for (const [roleId, scope] of [
        [roles.department, 'DEPARTMENT'],
        [roles.self, action === 'customer.read' ? 'DEPARTMENT' : 'SELF'],
      ])
        await client.query(
          'INSERT INTO role_grants(id,role_template_id,action,scope) VALUES($1,$2,$3,$4)',
          [randomUUID(), roleId, action, scope],
        );
    }
    await client.query(
      `INSERT INTO role_grants(id,role_template_id,action,scope)
       VALUES($1,$2,'lead.read','DEPARTMENT')`,
      [randomUUID(), roles.other],
    );
    for (const [kind, actor] of Object.entries(actors)) {
      const dept = kind === 'other' ? otherDepartmentId : departmentId;
      const role =
        kind === 'self'
          ? roles.self
          : kind === 'other'
            ? roles.other
            : roles.department;
      await client.query(
        'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES($1,$2,$3,now())',
        [actor.id, `local:${actor.id}`, actor.displayName],
      );
      await client.query(
        'INSERT INTO local_credentials(id,user_id,username,password_hash,updated_at) VALUES($1,$2,$3,$4,now())',
        [randomUUID(), actor.id, actor.username, hash],
      );
      await client.query(
        `INSERT INTO department_memberships(id,user_id,department_id,team_id,updated_at)
         VALUES($1,$2,$3,$4,now())`,
        [randomUUID(), actor.id, dept, kind === 'owner' ? teamId : null],
      );
      await client.query(
        `INSERT INTO role_assignments(id,user_id,department_id,role_template_id,updated_at)
         VALUES($1,$2,$3,$4,now())`,
        [randomUUID(), actor.id, dept, role],
      );
    }
    const businessId = await allocateCustomerBusinessId({
      $queryRawUnsafe: async (sql) => (await client.query(sql)).rows,
    });
    const customerName = `导入验收企业-${suffix}`;
    const holderName = `导入验收权利人-${suffix}`;
    await client.query(
      `INSERT INTO customers(id,business_id,name,normalized_name,customer_type,
       identity_type,identity_number,normalized_identity_number,identity_validity_mode,
       department_id,responsible_user_id,updated_at)
       VALUES($1,$2,$3,$3,'ENTERPRISE','BUSINESS_LICENSE',$4,$4,'LONG_TERM',$5,$6,now())`,
      [
        customerId,
        businessId,
        customerName,
        `91310000${suffix.toUpperCase()}`,
        departmentId,
        actors.a.id,
      ],
    );
    await client.query(
      `INSERT INTO customer_contacts(id,customer_id,department_id,name,phone,origin,
       created_by_user_id,updated_by_user_id)
       VALUES($1,$2,$3,'合成联系人','13800000000','ADMISSION_FREEFORM',$4,$4)`,
      [contactId, customerId, departmentId, actors.a.id],
    );
    await client.query(
      `UPDATE customers SET profile_status='ADMITTED',admitted_at=now(),
       admission_contact_name='合成联系人',admission_contact_phone='13800000000',
       compatibility_contact_id=$2,admission_contact_snapshot_name='合成联系人',
       admission_contact_snapshot_phone='13800000000',
       admission_contact_snapshot_source='NEW_ADMISSION',
       admission_contact_snapshot_frozen_at=now(),version=version+1,updated_at=now()
       WHERE id=$1`,
      [customerId, contactId],
    );
    await client.query(
      'INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES($1,$2,$3,now())',
      [holderId, holderName, departmentId],
    );
    await client.query(
      `INSERT INTO customer_rights_holder_links(id,customer_id,rights_holder_id,department_id)
       VALUES($1,$2,$3,$4)`,
      [randomUUID(), customerId, holderId, departmentId],
    );
    await client.query('COMMIT');
    return {
      actors,
      departmentId,
      otherDepartmentId,
      teamId,
      customerId,
      customerName,
      holderId,
      holderName,
      suffix,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

export async function assertAttachedLeadImage({
  taskId,
  leadId,
  productId,
  productNumber,
  departmentId,
}) {
  const client = new Client({
    connectionString: assertBatch2ImportOwnedRuntime(),
  });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT t.id,t.row_number,t.product_number,t.status,t.upload_draft_id,
       t.content_version_id,v.source_upload_draft_id,v.storage_key,v.sha256,v.size_bytes,
       m.id AS material_id,m.owner_type,m.owner_id,
       s.id AS screenshot_id,s.product_id AS screenshot_product_id
       FROM lead_image_import_tasks t
       JOIN content_versions v ON v.id=t.content_version_id
       JOIN materials m ON m.id=v.material_id
       JOIN lead_product_screenshots s ON s.content_version_id=v.id
       WHERE t.id=$1 AND t.lead_id=$2 AND t.product_id=$3 AND t.department_id=$4`,
      [taskId, leadId, productId, departmentId],
    );
    if (result.rowCount !== 1)
      throw new Error('Expected one real attached image');
    const row = result.rows[0];
    const expectedKey = `${departmentId}/${row.material_id}/${row.content_version_id}`;
    if (
      row.status !== 'ATTACHED' ||
      row.row_number !== 2 ||
      row.product_number !== productNumber ||
      row.screenshot_product_id !== productId ||
      row.owner_type !== 'LEAD' ||
      row.owner_id !== leadId ||
      row.source_upload_draft_id !== row.upload_draft_id ||
      row.storage_key !== expectedKey
    )
      throw new Error(
        'Image task, content version, or product relation differs',
      );
    const bytes = await readFile(
      resolve(root, '.local/private-files/test', ...expectedKey.split('/')),
    );
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (
      !bytes.equals(syntheticImageBytes) ||
      row.sha256 !== sha256 ||
      BigInt(row.size_bytes) !== BigInt(bytes.length)
    )
      throw new Error('Private image bytes or content hash differs');
    const count = await client.query(
      `SELECT (SELECT count(*)::int FROM content_versions
       WHERE source_upload_draft_id=$1) AS versions,
       (SELECT count(*)::int FROM lead_product_screenshots
       WHERE content_version_id=$2) AS associations`,
      [row.upload_draft_id, row.content_version_id],
    );
    if (count.rows[0].versions !== 1 || count.rows[0].associations !== 1)
      throw new Error('Image attachment duplicated private data');
    return { contentVersionId: row.content_version_id, sha256 };
  } finally {
    await client.end();
  }
}
