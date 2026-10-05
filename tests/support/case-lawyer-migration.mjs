import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const backend = resolve(import.meta.dirname, '../../backend');
const requireBackend = createRequire(resolve(backend, 'package.json'));
const { Client } = requireBackend('pg');
const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('DATABASE_URL is required');
const url = new URL(baseUrl);
if (
  url.hostname !== '127.0.0.1' ||
  url.port !== '55433' ||
  url.pathname !== '/dev_cor_test' ||
  url.username !== 'dev_cor_test' ||
  url.search
)
  throw new Error('The isolated test database URL is required');

const migrationsPath = resolve(backend, 'prisma/migrations');
const migrationNames = readdirSync(migrationsPath)
  .filter((name) => /^20\d+_/.test(name))
  .sort();
if (
  migrationNames.length !== 71 ||
  !migrationNames[67].includes('lawyer_identity_enums') ||
  !migrationNames[68].includes('lawyer_accounts_and_actor_paths') ||
  !migrationNames[69].includes('fix_lawyer_actor_case_variable') ||
  !migrationNames[70].includes('reject_lawyer_internal_membership')
)
  throw new Error(
    'Expected exactly 67 previous migrations and 4 lawyer migrations',
  );

const client = new Client({ connectionString: baseUrl });
await client.connect();
const temporaryRoot = mkdtempSync(join(tmpdir(), 'dev-cor-lawyer-migration-'));
const prisma = resolve(backend, 'node_modules/prisma/build/index.js');
const schemaFile = resolve(backend, 'prisma/schema.prisma');

function runPrisma(schema, config, args, expectSuccess) {
  const schemaUrl = new URL(baseUrl);
  schemaUrl.searchParams.set('schema', schema);
  const result = spawnSync(
    process.execPath,
    [prisma, ...args, ...(config ? ['--config', config] : [])],
    {
      cwd: backend,
      env: { ...process.env, DATABASE_URL: schemaUrl.href },
      encoding: 'utf8',
    },
  );
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.replaceAll(
    schemaUrl.password,
    '[REDACTED]',
  );
  if (expectSuccess !== (result.status === 0) || result.error) {
    process.stdout.write(output);
    throw new Error(
      `Prisma ${args.join(' ')} returned ${result.error?.message ?? result.status}`,
    );
  }
  if (!expectSuccess && !output.includes('failed')) {
    process.stdout.write(output);
    throw new Error(
      'Expected a migration failure, but the failure was not reported',
    );
  }
}

async function withSchema(label, run) {
  const schema = `case_lawyer_${randomBytes(8).toString('hex')}`;
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  try {
    await run(schema);
    console.log(`${label}: passed`);
  } finally {
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
  }
}

async function expectSqlError(sql, params, code) {
  try {
    await client.query(sql, params);
  } catch (error) {
    if (error.code === code) return;
    throw error;
  }
  throw new Error(`Expected SQLSTATE ${code}`);
}

async function verifySqlActorGuards() {
  const departmentId = randomUUID();
  const otherDepartmentId = randomUUID();
  const userId = randomUUID();
  const profileId = randomUUID();
  const bindingId = randomUUID();
  const roleId = randomUUID();
  await client.query(
    'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now()),($3,$4,now())',
    [departmentId, '律师测试部门', otherDepartmentId, '外部门'],
  );
  await client.query(
    'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,now())',
    [roleId, departmentId, '内部模板'],
  );
  await client.query('BEGIN');
  await client.query(
    "INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,$2,$3,'LAWYER',now())",
    [userId, `lawyer-test-${userId}`, '同名律师'],
  );
  await client.query(
    'INSERT INTO lawyer_profiles(id,department_id,full_name,law_firm) VALUES ($1,$2,$3,$4)',
    [profileId, departmentId, '同名律师', '测试律所'],
  );
  await client.query(
    'INSERT INTO lawyer_account_bindings(id,user_id,department_id,profile_id,updated_at) VALUES ($1,$2,$3,$4,now())',
    [bindingId, userId, departmentId, profileId],
  );
  await client.query('COMMIT');

  await expectSqlError(
    'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
    [randomUUID(), userId, departmentId],
    '23514',
  );
  await expectSqlError(
    'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,updated_at) VALUES ($1,$2,$3,$4,now())',
    [randomUUID(), userId, departmentId, roleId],
    '23514',
  );
  const foreignProfileId = randomUUID();
  await client.query(
    'INSERT INTO lawyer_profiles(id,department_id,full_name,law_firm) VALUES ($1,$2,$3,$4)',
    [foreignProfileId, otherDepartmentId, '同名律师', '外部门律所'],
  );
  await expectSqlError(
    'INSERT INTO lawyer_account_bindings(id,user_id,department_id,profile_id,updated_at) VALUES ($1,$2,$3,$4,now())',
    [randomUUID(), userId, otherDepartmentId, foreignProfileId],
    '23514',
  );
  await expectSqlError(
    'INSERT INTO audit_events(id,department_id,actor_user_id,lawyer_account_binding_id,resource_type,resource_id,action) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [
      randomUUID(),
      departmentId,
      userId,
      bindingId,
      'customer',
      randomUUID(),
      'lawyer-account.password-reset',
    ],
    '23514',
  );
  await expectSqlError(
    'INSERT INTO audit_events(id,department_id,actor_user_id,resource_type,resource_id,action) VALUES ($1,$2,$3,$4,$5,$6)',
    [
      randomUUID(),
      departmentId,
      userId,
      'CASE',
      randomUUID(),
      'case.complaint.submitted',
    ],
    '23503',
  );
  await expectSqlError(
    'INSERT INTO upload_drafts(id,department_id,actor_user_id,lawyer_account_binding_id,owner_type,owner_id,category,purpose,original_filename,declared_mime_type,expires_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now())',
    [
      randomUUID(),
      departmentId,
      userId,
      bindingId,
      'NOTARY_MATTER',
      randomUUID(),
      'MAIL_RECEIPT',
      'MAIL_RECEIPT',
      'forged.pdf',
      'application/pdf',
    ],
    '23514',
  );

  const sameNameUser = randomUUID();
  await client.query('BEGIN');
  await client.query(
    "INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,$2,$3,'LAWYER',now())",
    [sameNameUser, `lawyer-test-${sameNameUser}`, '同名律师'],
  );
  const sameNameProfile = randomUUID();
  await client.query(
    'INSERT INTO lawyer_profiles(id,department_id,full_name,law_firm) VALUES ($1,$2,$3,$4)',
    [sameNameProfile, departmentId, '同名律师', '测试律所'],
  );
  await client.query(
    'INSERT INTO lawyer_account_bindings(id,user_id,department_id,profile_id,updated_at) VALUES ($1,$2,$3,$4,now())',
    [randomUUID(), sameNameUser, departmentId, sameNameProfile],
  );
  await client.query('COMMIT');
  const count = await client.query(
    "SELECT COUNT(*)::int AS count FROM user_accounts WHERE display_name = '同名律师' AND account_type = 'LAWYER'",
  );
  if (count.rows[0].count !== 2)
    throw new Error('Same-name accounts were merged');
}

function temporaryConfig(names, suffix, corruptIndex = -1) {
  const root = join(temporaryRoot, suffix);
  const migrations = join(root, 'migrations');
  mkdirSync(migrations, { recursive: true });
  for (const name of names)
    cpSync(join(migrationsPath, name), join(migrations, name), {
      recursive: true,
    });
  if (corruptIndex >= 0) {
    const targetSql = join(
      migrations,
      migrationNames[corruptIndex],
      'migration.sql',
    );
    writeFileSync(
      targetSql,
      'BEGIN;\nCREATE TABLE "lawyer_migration_rollback_probe" ("id" int);\nSELECT 1 / 0;\nCOMMIT;\n',
    );
  }
  const config = join(root, 'prisma.config.ts');
  writeFileSync(
    config,
    `export default { schema: ${JSON.stringify(schemaFile)}, migrations: { path: ${JSON.stringify(migrations)} }, datasource: { url: process.env.DATABASE_URL ?? '' } };\n`,
  );
  return config;
}

try {
  await withSchema('empty database with 71 migrations', async (schema) => {
    runPrisma(schema, null, ['migrate', 'deploy'], true);
    const result = await client.query(
      `SELECT COUNT(*)::int AS count FROM "${schema}"."_prisma_migrations" WHERE finished_at IS NOT NULL`,
    );
    if (result.rows[0].count !== 71)
      throw new Error('Empty migration count mismatch');
    await verifySqlActorGuards();
  });

  const previousConfig = temporaryConfig(
    migrationNames.slice(0, 67),
    'previous67',
  );
  await withSchema('previous 67 to lawyer migrations', async (schema) => {
    runPrisma(schema, previousConfig, ['migrate', 'deploy'], true);
    const before = await client.query(
      `SELECT COUNT(*)::int AS count FROM "${schema}"."_prisma_migrations" WHERE finished_at IS NOT NULL`,
    );
    if (before.rows[0].count !== 67)
      throw new Error('Previous migration count mismatch');
    runPrisma(schema, null, ['migrate', 'deploy'], true);
    const after = await client.query(
      `SELECT COUNT(*)::int AS count FROM "${schema}"."_prisma_migrations" WHERE finished_at IS NOT NULL`,
    );
    if (after.rows[0].count !== 71)
      throw new Error('Upgrade migration count mismatch');
  });

  for (const targetIndex of [67, 68, 69, 70]) {
    const failedConfig = temporaryConfig(
      migrationNames,
      `failed-${targetIndex}`,
      targetIndex,
    );
    await withSchema(
      `migration ${targetIndex + 1} failure atomicity and forward retry`,
      async (schema) => {
        runPrisma(schema, failedConfig, ['migrate', 'deploy'], false);
        const probe = await client.query('SELECT to_regclass($1) AS found', [
          `${schema}.lawyer_migration_rollback_probe`,
        ]);
        if (probe.rows[0].found !== null)
          throw new Error('Failed migration left a table behind');
        const failed = await client.query(
          `SELECT COUNT(*)::int AS count FROM "${schema}"."_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NULL`,
          [migrationNames[targetIndex]],
        );
        if (failed.rows[0].count !== 1)
          throw new Error('Failed migration was not recorded');
        runPrisma(
          schema,
          null,
          ['migrate', 'resolve', '--rolled-back', migrationNames[targetIndex]],
          true,
        );
        runPrisma(schema, null, ['migrate', 'deploy'], true);
        const completed = await client.query(
          `SELECT COUNT(*)::int AS count FROM "${schema}"."_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL`,
          [migrationNames[targetIndex]],
        );
        if (completed.rows[0].count !== 1)
          throw new Error('Forward retry did not complete');
      },
    );
  }
} finally {
  await client.end();
  rmSync(temporaryRoot, { recursive: true, force: true });
}
