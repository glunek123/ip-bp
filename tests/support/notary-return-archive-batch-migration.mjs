import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const requireBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { Client } = requireBackend('pg');
const migrationRoot = resolve(process.cwd(), 'backend/prisma/migrations');
const backendRoot = resolve(process.cwd(), 'backend');
const prismaCli = resolve(backendRoot, 'node_modules/prisma/build/index.js');
const target = '20261002010000_add_notary_return_archive_batch_receipt';

export async function verifyNotaryReturnArchiveBatchMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== 'test' || !connectionString)
    throw new Error('An isolated test database is required');
  validateIsolatedTestDatabaseUrl(connectionString, { allowRandomPort: true });
  const migrations = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  if (migrations.length !== 57 || migrations.at(-1) !== target)
    throw new Error('Unexpected migration chain');
  const suffix = randomUUID().replaceAll('-', '');
  const schemas = {
    empty: `nt010_empty_${suffix}`,
    upgrade: `nt010_upgrade_${suffix}`,
    failure: `nt010_failure_${suffix}`,
  };
  const client = new Client({ connectionString });
  async function select(schema) {
    await client.query(`SET search_path TO "${schema}"`);
  }
  async function apply(names) {
    for (const name of names)
      await client.query(
        await readFile(resolve(migrationRoot, name, 'migration.sql'), 'utf8'),
      );
  }
  function prisma(schema, args) {
    const url = new URL(connectionString);
    url.searchParams.set('schema', schema);
    const result = spawnSync(
      process.execPath,
      [prismaCli, 'migrate', ...args],
      {
        cwd: backendRoot,
        env: { ...process.env, DATABASE_URL: url.href },
        encoding: 'utf8',
        timeout: 120000,
      },
    );
    if (result.error)
      throw new Error('Prisma migration subprocess failed to complete');
    return result.status;
  }
  async function exists(schema, table) {
    const result = await client.query(
      'SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2',
      [schema, table],
    );
    return result.rowCount === 1;
  }
  async function insertParent() {
    const department = randomUUID();
    const actor = randomUUID();
    await client.query(
      'INSERT INTO departments (id, name, updated_at) VALUES ($1, $2, now())',
      [department, `NT010-${suffix}`],
    );
    await client.query(
      'INSERT INTO user_accounts (id, external_subject, display_name, updated_at) VALUES ($1, $2, $3, now())',
      [actor, `nt010-${suffix}`, '测试人员'],
    );
    await client.query(
      'INSERT INTO department_memberships (id, user_id, department_id, updated_at) VALUES ($1, $2, $3, now())',
      [randomUUID(), actor, department],
    );
    return { department, actor };
  }
  async function seedLegacyArchive({ department, actor }) {
    const customer = randomUUID();
    const holder = randomUUID();
    const lead = randomUUID();
    const office = randomUUID();
    const matter = randomUUID();
    const review = randomUUID();
    const decision = randomUUID();
    const archive = randomUUID();
    await client.query(
      'INSERT INTO customers (id, name, normalized_name, department_id, responsible_user_id, updated_at) VALUES ($1,$2,$2,$3,$4,now())',
      [customer, `NT010-${suffix}`, department, actor],
    );
    await client.query(
      'INSERT INTO rights_holders (id, name, department_id, updated_at) VALUES ($1,$2,$3,now())',
      [holder, `NT010-${suffix}`, department],
    );
    await client.query(
      `INSERT INTO leads (id, department_id, business_no, customer_id, rights_holder_id,
      responsible_user_id, case_type, source, platform, found_at, shop_name, need_disclose, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,'CIVIL','ONLINE','TAOBAO',now(),'迁移保留探针',false,now())`,
      [lead, department, `NT010-L-${lead}`, customer, holder, actor],
    );
    await client.query(
      'INSERT INTO notary_offices (id, department_id, name, created_by_user_id, updated_at) VALUES ($1,$2,$3,$4,now())',
      [office, department, `NT010-${office}`, actor],
    );
    await client.query(
      `INSERT INTO notary_matters (id, business_no, department_id, source_lead_id,
      customer_id, rights_holder_id, responsible_user_id, notary_office_id, stage, version,
      evidence_mode, batch_purpose, source_snapshot, created_by_user_id, from_lead_version, to_lead_version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ARCHIVED',6,'ONLINE_PURCHASE','迁移保留','{}'::jsonb,$7,1,2)`,
      [
        matter,
        `NT010-M-${matter}`,
        department,
        lead,
        customer,
        holder,
        actor,
        office,
      ],
    );
    await client.query(
      `INSERT INTO notary_matter_evidence (matter_id, department_id, evidence_at,
      sample_fee_state, sample_fee_amount, recorded_by_user_id)
      VALUES ($1,$2,current_date,'KNOWN',100.00,$3)`,
      [matter, department, actor],
    );
    await client.query(
      'INSERT INTO notary_matter_opening (matter_id, department_id, recorded_by_user_id, internal_actor_user_id) VALUES ($1,$2,$3,$3)',
      [matter, department, actor],
    );
    await client.query(
      `INSERT INTO notary_opening_review_decisions (id, matter_id, department_id, customer_id,
      actor_user_id, actor_kind, internal_actor_user_id, actor_display_name_snapshot, result, from_version, to_version)
      VALUES ($1,$2,$3,$4,$5,'INTERNAL',$5,'测试运营','INFRINGEMENT',3,4)`,
      [review, matter, department, customer, actor],
    );
    await client.query(
      `INSERT INTO notary_issuance_decisions (id, matter_id, department_id,
      opening_review_decision_id, actor_user_id, actor_display_name_snapshot, decision, from_version, to_version)
      VALUES ($1,$2,$3,$4,$5,'测试运营','NO_ISSUE',4,5)`,
      [decision, matter, department, review, actor],
    );
    await client.query(
      `INSERT INTO notary_return_archives (id, matter_id, department_id,
      issuance_decision_id, actor_user_id, actor_display_name_snapshot, return_choice,
      archive_reason, from_version, to_version)
      VALUES ($1,$2,$3,$4,$5,'测试运营','REFUND_ONLY','迁移前退款',5,6)`,
      [archive, matter, department, decision, actor],
    );
    await client.query(
      `INSERT INTO notary_return_amounts (id, archive_id, matter_id, department_id,
      return_choice, kind, state, amount, party_kind, source_evidence_matter_id)
      VALUES ($1,$2,$3,$4,'REFUND_ONLY','REFUND','KNOWN',5.00,'CUSTOMER',$3)`,
      [randomUUID(), archive, matter, department],
    );
    await client.query(
      `INSERT INTO notary_matter_command_receipts (id, department_id, actor_user_id,
      internal_actor_user_id, action, idempotency_key, request_fingerprint,
      result_matter_id, result_matter_version, result_snapshot)
      VALUES ($1,$2,$3,$3,'notary.return.archive','legacy-key',$4,$5,6,$6::jsonb)`,
      [
        randomUUID(),
        department,
        actor,
        'a'.repeat(64),
        matter,
        JSON.stringify({ id: matter, stage: 'ARCHIVED' }),
      ],
    );
    return matter;
  }
  async function legacyFacts(matter) {
    const result = await client.query(
      `SELECT
      (SELECT count(*)::int FROM notary_return_archives WHERE matter_id=$1) AS archives,
      (SELECT amount::text FROM notary_return_amounts WHERE matter_id=$1 AND kind='REFUND') AS refund,
      (SELECT count(*)::int FROM notary_matter_command_receipts WHERE result_matter_id=$1 AND action='notary.return.archive') AS receipts`,
      [matter],
    );
    return result.rows[0];
  }
  async function rejected(sql, params) {
    try {
      await client.query(sql, params);
      return null;
    } catch (error) {
      return error.code;
    }
  }
  await client.connect();
  try {
    const actual = await client.query('SELECT current_database() AS name');
    if (actual.rows[0]?.name !== 'dev_cor_test')
      throw new Error('Unexpected migration database');
    for (const schema of Object.values(schemas))
      await client.query(`CREATE SCHEMA "${schema}"`);
    await select(schemas.empty);
    await apply(migrations);
    if (!(await exists(schemas.empty, 'notary_return_archive_batch_receipts')))
      throw new Error('Empty migration chain missing batch receipt');
    const { department, actor } = await insertParent();
    const receipt = [
      randomUUID(),
      department,
      actor,
      'key',
      'a'.repeat(64),
      JSON.stringify({ batchId: randomUUID(), items: [] }),
    ];
    const insert =
      'INSERT INTO notary_return_archive_batch_receipts (id, department_id, actor_user_id, idempotency_key, request_fingerprint, result_snapshot) VALUES ($1,$2,$3,$4,$5,$6::jsonb)';
    await client.query(insert, receipt);
    const duplicateCode = await rejected(insert, [
      randomUUID(),
      ...receipt.slice(1),
    ]);
    const badActorCode = await rejected(insert, [
      randomUUID(),
      department,
      randomUUID(),
      'other',
      'a'.repeat(64),
      receipt[5],
    ]);
    const badKeyCode = await rejected(insert, [
      randomUUID(),
      department,
      actor,
      ' ',
      'a'.repeat(64),
      receipt[5],
    ]);
    const mutateCode = await rejected(
      'UPDATE notary_return_archive_batch_receipts SET idempotency_key=$1 WHERE id=$2',
      ['changed', receipt[0]],
    );
    const deleteCode = await rejected(
      'DELETE FROM notary_return_archive_batch_receipts WHERE id=$1',
      [receipt[0]],
    );
    if (
      [duplicateCode, badActorCode, badKeyCode, mutateCode, deleteCode].some(
        (code) => code === null,
      )
    )
      throw new Error('Batch receipt constraints are not enforced');

    await select(schemas.upgrade);
    await apply(migrations.slice(0, -1));
    const upgradeParent = await insertParent();
    const oldMatter = await seedLegacyArchive(upgradeParent);
    const beforeFacts = await legacyFacts(oldMatter);
    await apply(migrations.slice(-1));
    const afterFacts = await legacyFacts(oldMatter);
    if (
      beforeFacts.archives !== 1 ||
      beforeFacts.refund !== '5.00' ||
      beforeFacts.receipts !== 1 ||
      JSON.stringify(afterFacts) !== JSON.stringify(beforeFacts)
    )
      throw new Error('Upgrade changed old archive, refund or single receipt');

    await select(schemas.failure);
    await apply(migrations.slice(0, -1));
    const failureParent = await insertParent();
    const failureMatter = await seedLegacyArchive(failureParent);
    const failureBefore = await legacyFacts(failureMatter);
    await client.query(`CREATE TABLE "_prisma_migrations" (
      "id" VARCHAR(36) NOT NULL PRIMARY KEY, "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT, "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);
    for (const name of migrations.slice(0, -1)) {
      const sql = await readFile(resolve(migrationRoot, name, 'migration.sql'));
      await client.query(
        'INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ($1,$2,now(),$3,1)',
        [randomUUID(), createHash('sha256').update(sql).digest('hex'), name],
      );
    }
    await client.query(
      'CREATE FUNCTION reject_notary_return_archive_batch_receipt_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD; END; $$',
    );
    const failed = prisma(schemas.failure, ['deploy']);
    if (
      failed === 0 ||
      (await exists(schemas.failure, 'notary_return_archive_batch_receipts')) ||
      JSON.stringify(await legacyFacts(failureMatter)) !==
        JSON.stringify(failureBefore)
    )
      throw new Error('Failed Prisma migration left partial receipt table');
    const unfinished = await client.query(
      `SELECT count(*)::int AS count FROM "${schemas.failure}"."_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NULL`,
      [target],
    );
    if (unfinished.rows[0].count !== 1)
      throw new Error('Failed Prisma migration was not recorded');
    await client.query(
      'DROP FUNCTION reject_notary_return_archive_batch_receipt_mutation()',
    );
    if (
      prisma(schemas.failure, ['resolve', '--rolled-back', target]) !== 0 ||
      prisma(schemas.failure, ['deploy']) !== 0 ||
      !(await exists(
        schemas.failure,
        'notary_return_archive_batch_receipts',
      )) ||
      JSON.stringify(await legacyFacts(failureMatter)) !==
        JSON.stringify(failureBefore)
    )
      throw new Error('Failed Prisma migration could not be retried');
    return {
      migrationCount: migrations.length,
      emptyChain: true,
      previousSchemaPreserved: true,
      constraints: {
        duplicateCode,
        badActorCode,
        badKeyCode,
        mutateCode,
        deleteCode,
      },
      failedDeployStatus: failed,
      failedMigrationAtomic: true,
      resolvedAndRetried: true,
    };
  } finally {
    await client.query('RESET search_path').catch(() => undefined);
    for (const schema of Object.values(schemas))
      await client
        .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        .catch(() => undefined);
    await client.end();
  }
}
