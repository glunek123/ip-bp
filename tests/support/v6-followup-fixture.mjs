import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const migrationRoot = resolve(root, 'backend/prisma/migrations');
const approvedProject = 'dev-cor-v6-followups-20261026';
const finalMigration = '20261026150000_v6_fee_cancellation';

export const v6FollowupMigrations = readdirSync(migrationRoot)
  .filter((name) => /^\d{14}_/u.test(name) && name <= finalMigration)
  .sort();

export function v6MigrationSql(name) {
  if (!v6FollowupMigrations.includes(name))
    throw new Error('Migration is outside the approved 184 chain');
  return readFileSync(resolve(migrationRoot, name, 'migration.sql'), 'utf8');
}

function assertBoundTestTarget() {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('v6 follow-up tests require test mode');
  const url = process.env.DATABASE_URL;
  validateIsolatedTestDatabaseUrl(url, { allowRandomPort: true });
  const parsed = new URL(url);
  if (
    parsed.hostname !== '127.0.0.1' ||
    parsed.port !== '15440' ||
    parsed.pathname !== '/dev_cor_test' ||
    process.env.DEV_COR_TEST_DATABASE_PROJECT !== approvedProject ||
    !/^[a-f0-9]{64}$/u.test(
      process.env.DEV_COR_TEST_DATABASE_CONTAINER_ID ?? '',
    )
  )
    throw new Error('v6 follow-up database identity is not bound');
  if (
    v6FollowupMigrations.length !== 184 ||
    v6FollowupMigrations.at(-1) !== finalMigration
  )
    throw new Error('v6 follow-up migration chain changed');
}

function quoteIdentifier(value) {
  if (!/^v6f_[a-f0-9]{32}$/u.test(value))
    throw new Error('Refusing an unowned schema identifier');
  return `"${value}"`;
}

export async function withV6FollowupSchema(operation, options = {}) {
  assertBoundTestTarget();
  const schema = `v6f_${randomUUID().replaceAll('-', '')}`;
  const quoted = quoteIdentifier(schema);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  let connected = false;
  let created = false;
  let primaryError;
  let value;
  try {
    await client.connect();
    connected = true;
    const identity = (
      await client.query(
        'SELECT current_database() AS db, current_schema() AS schema',
      )
    ).rows[0];
    if (identity.db !== 'dev_cor_test' || identity.schema !== 'public')
      throw new Error('Unexpected initial database namespace');
    await client.query(`CREATE SCHEMA ${quoted}`);
    created = true;
    await client.query(`SET search_path TO ${quoted}`);
    const through = options.through ?? finalMigration;
    if (!v6FollowupMigrations.includes(through))
      throw new Error('Unknown migration boundary');
    for (const name of v6FollowupMigrations) {
      if (name > through) break;
      try {
        await client.query(v6MigrationSql(name));
      } catch (error) {
        const fields = [
          `migration=${name}`,
          `sqlstate=${String(error?.code ?? 'unknown')}`,
          `position=${String(error?.position ?? 'none')}`,
          `internalPosition=${String(error?.internalPosition ?? 'none')}`,
        ];
        if (typeof error?.internalQuery === 'string')
          fields.push(`internalQuery=${error.internalQuery.slice(0, 1200)}`);
        throw new Error(`v6 migration failed: ${fields.join(' | ')}`, {
          cause: error,
        });
      }
    }
    value = await operation({ client, schema, quoted, through });
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
        const remains = (
          await client.query(
            'SELECT count(*)::integer AS count FROM pg_namespace WHERE nspname=$1',
            [schema],
          )
        ).rows[0].count;
        if (remains !== 0)
          throw new Error('Owned schema remained after cleanup');
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
      'v6 follow-up test and cleanup both failed',
    );
  if (primaryError) throw primaryError;
  if (cleanupErrors.length)
    throw new AggregateError(cleanupErrors, 'Owned-schema cleanup failed');
  return value;
}

export function v6ScopedDatabaseUrl(schema) {
  quoteIdentifier(schema);
  assertBoundTestTarget();
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  return url.toString();
}

export function v6ScopedPrisma(schema) {
  const { PrismaPg } = requireBackend('@prisma/adapter-pg');
  const { PrismaClient } = requireBackend(
    resolve(root, 'backend/dist/generated/prisma/client.js'),
  );
  return new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: v6ScopedDatabaseUrl(schema) },
      { schema },
    ),
  });
}

export async function seedV6InternalCustomer(client) {
  const departmentId = randomUUID();
  const actorUserId = randomUUID();
  const customerId = randomUUID();
  const rightsHolderId = randomUUID();
  const contactId = randomUUID();
  await client.query(
    'INSERT INTO departments(id,name,updated_at) VALUES($1,$2,now())',
    [departmentId, `v6合成部门-${departmentId.slice(0, 8)}`],
  );
  await client.query(
    'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES($1,$2,$3,now())',
    [actorUserId, `v6-followup-${actorUserId}`, '合成运营'],
  );
  await client.query(
    'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES($1,$2,$3,now())',
    [randomUUID(), actorUserId, departmentId],
  );
  await client.query(
    'INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES($1,$2,$3,now())',
    [rightsHolderId, '合成权利人', departmentId],
  );
  await client.query(
    `INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at)
     VALUES($1,'合成客户','合成客户',$2,$3,now())`,
    [customerId, departmentId, actorUserId],
  );
  await client.query(
    `INSERT INTO customer_rights_holder_links(id,customer_id,rights_holder_id,department_id)
     VALUES($1,$2,$3,$4)`,
    [randomUUID(), customerId, rightsHolderId, departmentId],
  );
  await client.query(
    `INSERT INTO customer_contacts(id,customer_id,department_id,name,phone,origin)
     VALUES($1,$2,$3,'合成联系人','13800000000','MANUAL')`,
    [contactId, customerId, departmentId],
  );
  await client.query(
    `UPDATE customers SET profile_status='ADMITTED', admitted_at=now(),
      customer_type='ENTERPRISE', identity_type='BUSINESS_LICENSE',
      identity_number='V6-FOLLOWUP-LICENSE',
      normalized_identity_number='V6-FOLLOWUP-LICENSE',
      identity_validity_mode='LONG_TERM',
      admission_contact_name='合成联系人', admission_contact_phone='13800000000',
      compatibility_contact_id=$2,
      admission_contact_snapshot_name='合成联系人',
      admission_contact_snapshot_phone='13800000000',
      admission_contact_snapshot_source='NEW_ADMISSION',
      admission_contact_snapshot_frozen_at=now()
     WHERE id=$1`,
    [customerId, contactId],
  );
  return { departmentId, actorUserId, customerId, rightsHolderId };
}

export async function seedV6ExternalCase(client, owner, options = {}) {
  const caseId = randomUUID();
  const entryId = randomUUID();
  const auditId = randomUUID();
  const receiptId = randomUUID();
  const oldBusinessNo = `CA-V6-${caseId.slice(0, 8)}`;
  const createdAt = options.createdAt ?? '2026-10-25T01:00:00Z';
  const stageReachedOn = options.stageReachedOn ?? '2026-10-25';
  const stage = options.stage ?? 'PENDING_MATCH';
  const source = '合成外录来源';
  const reason = '历史补录';
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO cases(id,business_no,department_id,customer_id,rights_holder_id,
         responsible_user_id,stage,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        caseId,
        oldBusinessNo,
        owner.departmentId,
        owner.customerId,
        owner.rightsHolderId,
        owner.actorUserId,
        stage,
        createdAt,
      ],
    );
    await client.query(
      `INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,
         resource_type,resource_id,action,details)
       VALUES($1,$2,$3,$3,'CASE',$4,'case.external-entry.created',$5::jsonb)`,
      [
        auditId,
        owner.departmentId,
        owner.actorUserId,
        caseId,
        JSON.stringify({
          entryId,
          entryKind: 'EXTERNAL_TRANSFER',
          initialStage: stage,
          stageReachedOn,
          source,
          reason,
        }),
      ],
    );
    const entry = await client.query(
      `INSERT INTO case_external_entries(id,case_id,department_id,entry_kind,
         initial_stage,stage_reached_on,source,reason,known,recorded_by_user_id,audit_event_id)
       VALUES($1,$2,$3,'EXTERNAL_TRANSFER',$4,$5,$6,$7,
         '{"courtId":null,"courtCaseNo":null,"acceptedOn":null,"secondInstanceAcceptedOn":null,"platform":null,"shopName":null,"shopExternalId":null,"caseType":null,"infringementTypes":null}'::jsonb,$8,$9)
       RETURNING recorded_at`,
      [
        entryId,
        caseId,
        owner.departmentId,
        stage,
        stageReachedOn,
        source,
        reason,
        owner.actorUserId,
        auditId,
      ],
    );
    await client.query(
      `INSERT INTO case_external_entry_receipts(id,department_id,actor_user_id,
         case_id,idempotency_key,request_fingerprint,result_snapshot)
       VALUES($1,$2,$3,$4,$5,repeat('b',64),$6::jsonb)`,
      [
        receiptId,
        owner.departmentId,
        owner.actorUserId,
        caseId,
        `v6-external-${caseId}`,
        JSON.stringify({
          id: caseId,
          businessNo: oldBusinessNo,
          stage,
          version: 1,
          entryId,
          recordedAt: entry.rows[0].recorded_at.toISOString(),
        }),
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  return { caseId, entryId, auditId, receiptId, oldBusinessNo };
}

export async function grantV6SyntheticRole(client, owner, actions) {
  const roleId = randomUUID();
  await client.query(
    'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES($1,$2,$3,now())',
    [roleId, owner.departmentId, `v6测试角色-${roleId.slice(0, 8)}`],
  );
  await client.query(
    `INSERT INTO role_assignments(id,user_id,department_id,role_template_id,updated_at)
     VALUES($1,$2,$3,$4,now())`,
    [randomUUID(), owner.actorUserId, owner.departmentId, roleId],
  );
  for (const [action, scope] of actions) {
    await client.query(
      `INSERT INTO role_grants(id,role_template_id,action,scope)
       VALUES($1,$2,$3::permission_action,$4::permission_scope)`,
      [randomUUID(), roleId, action, scope],
    );
  }
  return roleId;
}

export function v6Actor(owner) {
  return {
    userId: owner.actorUserId,
    departmentId: owner.departmentId,
    authorizationRevision: 1,
  };
}

export function v6BackendClass(relativePath, className) {
  const module = requireBackend(resolve(root, 'backend/dist', relativePath));
  if (typeof module[className] !== 'function')
    throw new Error(`Built backend class is missing: ${className}`);
  return module[className];
}

export function v6Access(database) {
  const AccessControlService = v6BackendClass(
    'access-control/access-control.service.js',
    'AccessControlService',
  );
  const PrismaAccessControlStore = v6BackendClass(
    'access-control/prisma-access-control.store.js',
    'PrismaAccessControlStore',
  );
  return new AccessControlService(new PrismaAccessControlStore(database));
}

export function v6Materials(database, access) {
  const MaterialService = v6BackendClass(
    'modules/materials/material.service.js',
    'MaterialService',
  );
  // These operations only read/write version facts and references; storage is never called.
  return new MaterialService(database, access, undefined, undefined);
}
