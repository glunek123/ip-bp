import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const requireFromBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { Client } = requireFromBackend('pg');
const migrationRoot = resolve(process.cwd(), 'backend/prisma/migrations');
const backendRoot = resolve(process.cwd(), 'backend');
const prismaCli = resolve(backendRoot, 'node_modules/prisma/build/index.js');
const enumTarget = '20260930030000_add_notary_list_export_action';
const grantTarget = '20260930031000_add_notary_list_export_admin_grants';

export async function verifyNotaryListExportMigration() {
  if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL) {
    throw new Error('An isolated test database is required');
  }
  validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL, {
    allowRandomPort: true,
  });
  const migrations = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  if (!migrations.includes(enumTarget) || !migrations.includes(grantTarget)) {
    throw new Error('Notary list export migrations are missing');
  }
  const suffix = randomUUID().replaceAll('-', '');
  const schemas = {
    empty: `nt_export_empty_${suffix}`,
    upgrade: `nt_export_upgrade_${suffix}`,
    failure: `nt_export_failure_${suffix}`,
  };
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const id = Object.fromEntries(
    [
      'department',
      'admin',
      'reader',
      'inactive',
      'adminRole',
      'readerRole',
      'inactiveRole',
      'customer',
      'rights',
      'lead',
      'office',
      'matter',
    ].map((name) => [name, randomUUID()]),
  );

  async function selectSchema(schema) {
    await client.query(`SET search_path TO "${schema}"`);
  }
  async function apply(names) {
    for (const name of names) {
      await client.query(
        await readFile(resolve(migrationRoot, name, 'migration.sql'), 'utf8'),
      );
    }
  }
  async function seedPreviousSchema(label) {
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
      [id.department, `Export ${label}`],
    );
    for (const [userId, kind] of [
      [id.admin, 'admin'],
      [id.reader, 'reader'],
      [id.inactive, 'inactive'],
    ]) {
      await client.query(
        'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
        [userId, `${label}-${kind}-${suffix}`, `Historical ${kind}`],
      );
      await client.query(
        'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
        [randomUUID(), userId, id.department],
      );
    }
    for (const [roleId, name] of [
      [id.adminRole, '自定义部门角色管理者'],
      [id.readerRole, '普通阅读角色'],
      [id.inactiveRole, '停用分配角色'],
    ]) {
      await client.query(
        'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,now())',
        [roleId, id.department, name],
      );
    }
    await client.query(
      `INSERT INTO role_grants(id,role_template_id,action,scope)
      VALUES ($1,$2,'role.manage','DEPARTMENT'),($3,$4,'lead.read','DEPARTMENT'),($5,$6,'role.manage','DEPARTMENT')`,
      [
        randomUUID(),
        id.adminRole,
        randomUUID(),
        id.readerRole,
        randomUUID(),
        id.inactiveRole,
      ],
    );
    for (const [userId, roleId, active] of [
      [id.admin, id.adminRole, true],
      [id.reader, id.readerRole, true],
      [id.inactive, id.inactiveRole, false],
    ]) {
      await client.query(
        'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,active,updated_at) VALUES ($1,$2,$3,$4,$5,now())',
        [randomUUID(), userId, id.department, roleId, active],
      );
    }
    await client.query(
      `INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at)
      VALUES ($1,'Historical Customer','historical customer',$2,$3,now())`,
      [id.customer, id.department, id.admin],
    );
    await client.query(
      `INSERT INTO rights_holders(id,name,department_id,updated_at)
      VALUES ($1,'Historical Rights',$2,now())`,
      [id.rights, id.department],
    );
    await client.query(
      `INSERT INTO leads(id,department_id,business_no,customer_id,rights_holder_id,responsible_user_id,status,case_type,source,platform,found_at,shop_name,need_disclose,version,pushed_at,pushed_by_user_id,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,'WAITING_EVIDENCE_DECISION','CIVIL','ONLINE','TAOBAO',now(),'Historical Shop',false,3,now(),$6,now())`,
      [
        id.lead,
        id.department,
        `NT009-${label}`,
        id.customer,
        id.rights,
        id.admin,
      ],
    );
    await client.query(
      `INSERT INTO notary_offices(id,department_id,name,created_by_user_id)
      VALUES ($1,$2,'Historical Office',$3)`,
      [id.office, id.department, id.admin],
    );
    await client.query(
      `INSERT INTO notary_matters(id,business_no,department_id,source_lead_id,customer_id,rights_holder_id,responsible_user_id,notary_office_id,evidence_mode,batch_purpose,source_snapshot,created_by_user_id,from_lead_version,to_lead_version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ONLINE_PURCHASE','Historical','{}',$7,3,4)`,
      [
        id.matter,
        `NT009-MATTER-${label}`,
        id.department,
        id.lead,
        id.customer,
        id.rights,
        id.admin,
        id.office,
      ],
    );
  }
  async function result() {
    const grants =
      await client.query(`SELECT role_template_id,scope FROM role_grants
      WHERE action='notary.list.export'::permission_action ORDER BY role_template_id`);
    const users = await client.query(
      `SELECT id,display_name,authorization_revision
      FROM user_accounts WHERE id=ANY($1::uuid[]) ORDER BY id`,
      [[id.admin, id.reader, id.inactive]],
    );
    const matter = await client.query(
      'SELECT business_no FROM notary_matters WHERE id=$1',
      [id.matter],
    );
    const roles = await client.query(
      `SELECT id,version FROM role_templates
      WHERE id=ANY($1::uuid[]) ORDER BY id`,
      [[id.adminRole, id.readerRole, id.inactiveRole]],
    );
    return {
      grants: grants.rows,
      users: users.rows,
      roles: roles.rows,
      matter: matter.rows[0]?.business_no,
    };
  }
  function assertUpgrade(state, label) {
    const grantIds = state.grants.map((row) => row.role_template_id).sort();
    if (
      JSON.stringify(grantIds) !==
        JSON.stringify([id.adminRole, id.inactiveRole].sort()) ||
      state.grants.some((row) => row.scope !== 'DEPARTMENT') ||
      state.matter !== `NT009-MATTER-${label}` ||
      state.users.length !== 3 ||
      state.users.find((row) => row.id === id.admin)?.authorization_revision !==
        2 ||
      state.users.find((row) => row.id === id.reader)
        ?.authorization_revision !== 1 ||
      state.users.find((row) => row.id === id.inactive)
        ?.authorization_revision !== 1 ||
      state.roles.find((row) => row.id === id.adminRole)?.version !== 2 ||
      state.roles.find((row) => row.id === id.inactiveRole)?.version !== 2 ||
      state.roles.find((row) => row.id === id.readerRole)?.version !== 1
    ) {
      throw new Error(
        `Notary export upgrade violated grant or historical-data contract (${label})`,
      );
    }
  }
  function runPrisma(schema, args) {
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set('schema', schema);
    const processResult = spawnSync(
      process.execPath,
      [prismaCli, 'migrate', ...args],
      {
        cwd: backendRoot,
        env: { ...process.env, DATABASE_URL: url.href },
        encoding: 'utf8',
        timeout: 60000,
      },
    );
    if (processResult.error)
      throw new Error('Prisma migration subprocess could not complete');
    return { status: processResult.status };
  }

  await client.connect();
  try {
    const database = await client.query('SELECT current_database() AS name');
    if (database.rows[0]?.name !== 'dev_cor_test')
      throw new Error('Unexpected migration database');
    for (const schema of Object.values(schemas))
      await client.query(`CREATE SCHEMA "${schema}"`);

    await selectSchema(schemas.empty);
    await apply(migrations);
    const enumExists = await client.query(
      `SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
      JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname=$1 AND t.typname='permission_action'
      AND e.enumlabel='notary.list.export'`,
      [schemas.empty],
    );
    if (enumExists.rowCount !== 1)
      throw new Error('Empty migration chain omitted export action');

    await selectSchema(schemas.upgrade);
    await apply(migrations.filter((name) => name < enumTarget));
    await seedPreviousSchema('upgrade');
    await apply([enumTarget, grantTarget]);
    assertUpgrade(await result(), 'upgrade');

    await selectSchema(schemas.failure);
    await apply(migrations.filter((name) => name < enumTarget));
    await seedPreviousSchema('failure');
    await apply([enumTarget]);
    await client.query(`CREATE TABLE "_prisma_migrations" (
      "id" VARCHAR(36) NOT NULL PRIMARY KEY, "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT, "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);
    for (const name of migrations.filter((item) => item <= enumTarget)) {
      const sql = await readFile(resolve(migrationRoot, name, 'migration.sql'));
      await client.query(
        `INSERT INTO "_prisma_migrations" (id,checksum,finished_at,migration_name,applied_steps_count)
        VALUES ($1,$2,now(),$3,1)`,
        [randomUUID(), createHash('sha256').update(sql).digest('hex'), name],
      );
    }
    await client.query(`CREATE FUNCTION reject_export_grant() RETURNS trigger AS $$
      BEGIN IF NEW.action='notary.list.export'::permission_action THEN
        RAISE EXCEPTION 'probe reject export grant' USING ERRCODE='23514';
      END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await client.query(`CREATE TRIGGER reject_export_grant_trigger BEFORE INSERT ON role_grants
      FOR EACH ROW EXECUTE FUNCTION reject_export_grant()`);
    const failed = runPrisma(schemas.failure, ['deploy']);
    const unfinished = await client.query(
      `SELECT finished_at,rolled_back_at FROM "_prisma_migrations"
      WHERE migration_name=$1`,
      [grantTarget],
    );
    const beforeRetry = await result();
    if (
      failed.status === 0 ||
      unfinished.rows.length !== 1 ||
      unfinished.rows[0].finished_at !== null ||
      unfinished.rows[0].rolled_back_at !== null ||
      beforeRetry.grants.length !== 0 ||
      beforeRetry.users.some((row) => row.authorization_revision !== 1) ||
      beforeRetry.roles.some((row) => row.version !== 1)
    ) {
      throw new Error(
        'Real Prisma failure did not roll back grant/revision atomically',
      );
    }
    const resolved = runPrisma(schemas.failure, [
      'resolve',
      '--rolled-back',
      grantTarget,
    ]);
    if (resolved.status !== 0)
      throw new Error('Failed migration could not be resolved');
    await client.query(
      'DROP TRIGGER reject_export_grant_trigger ON role_grants',
    );
    await client.query('DROP FUNCTION reject_export_grant()');
    const retried = runPrisma(schemas.failure, ['deploy']);
    if (retried.status !== 0)
      throw new Error('Failed migration could not be retried');
    assertUpgrade(await result(), 'failure');
    return {
      emptyChain: true,
      previousSchemaPreserved: true,
      roleManagerGrantOnly: true,
      readerUnchanged: true,
      affectedRevisionOnly: true,
      failedDeployStatus: failed.status,
      failedLedgerUnfinished: true,
      failedMigrationAtomic: true,
      resolvedAndRetried: true,
    };
  } finally {
    await client.query('RESET search_path').catch(() => undefined);
    for (const schema of Object.values(schemas)) {
      await client
        .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        .catch(() => undefined);
    }
    await client.end();
  }
}
