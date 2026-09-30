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
const target = '20260930020000_add_notary_list_preference';

export async function verifyNotaryListPreferenceMigration() {
  if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL) {
    throw new Error('An isolated test database is required');
  }
  validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL, {
    allowRandomPort: true,
  });
  const migrations = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  if (migrations.at(-1) !== target) {
    throw new Error('Notary list preference must be the final migration');
  }
  const suffix = randomUUID().replaceAll('-', '');
  const schemas = {
    empty: `notary_pref_empty_${suffix}`,
    upgrade: `notary_pref_upgrade_${suffix}`,
    failure: `notary_pref_failure_${suffix}`,
  };
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const accountId = randomUUID();
  const otherId = randomUUID();

  async function apply(names) {
    for (const name of names) {
      const sql = await readFile(
        resolve(migrationRoot, name, 'migration.sql'),
        'utf8',
      );
      await client.query(sql);
    }
  }

  async function selectSchema(schema) {
    await client.query(`SET search_path TO "${schema}"`);
  }

  async function tableExists(schema) {
    const result = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name='notary_list_preferences'`,
      [schema],
    );
    return result.rowCount === 1;
  }

  function runPrisma(schema, args) {
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set('schema', schema);
    const result = spawnSync(
      process.execPath,
      [prismaCli, 'migrate', ...args],
      {
        cwd: backendRoot,
        env: { ...process.env, DATABASE_URL: url.href },
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    if (result.error) {
      throw new Error('Prisma migration subprocess could not complete');
    }
    return {
      status: result.status,
      transactionAborted: `${result.stdout}\n${result.stderr}`.includes(
        'current transaction is aborted',
      ),
    };
  }

  await client.connect();
  try {
    const actual = await client.query('SELECT current_database() AS name');
    if (actual.rows[0]?.name !== 'dev_cor_test') {
      throw new Error('Unexpected migration database');
    }
    for (const schema of Object.values(schemas)) {
      await client.query(`CREATE SCHEMA "${schema}"`);
    }

    await selectSchema(schemas.empty);
    await apply(migrations);
    if (!(await tableExists(schemas.empty))) {
      throw new Error(
        'Empty-chain migration did not create the preference table',
      );
    }
    await client.query(
      `INSERT INTO user_accounts (id, external_subject, display_name, updated_at) VALUES ($1, $2, 'A', now())`,
      [accountId, `notary-pref-${suffix}`],
    );
    await client.query(
      `INSERT INTO notary_list_preferences (user_id, column_order, hidden_columns, updated_at) VALUES ($1, $2, $3, now())`,
      [
        accountId,
        ['businessNo', 'stage', 'createdAt', 'sourceLead', 'notaryOffice'],
        ['createdAt'],
      ],
    );
    let foreignKeyCode = null;
    try {
      await client.query(
        `INSERT INTO notary_list_preferences (user_id, column_order, hidden_columns, updated_at) VALUES ($1, $2, $3, now())`,
        [otherId, ['businessNo', 'stage'], []],
      );
    } catch (error) {
      foreignKeyCode = error.code;
    }
    if (foreignKeyCode !== '23503') {
      throw new Error(`Expected FK rejection, got ${foreignKeyCode}`);
    }
    let restrictCode = null;
    try {
      await client.query('DELETE FROM user_accounts WHERE id=$1', [accountId]);
    } catch (error) {
      restrictCode = error.code;
    }
    if (restrictCode !== '23503') {
      throw new Error(
        `Expected account deletion restriction, got ${restrictCode}`,
      );
    }

    await selectSchema(schemas.upgrade);
    await apply(migrations.filter((name) => name < target));
    await client.query(
      `INSERT INTO user_accounts (id, external_subject, display_name, updated_at) VALUES ($1, $2, 'Prior', now())`,
      [accountId, `notary-pref-prior-${suffix}`],
    );
    if (await tableExists(schemas.upgrade)) {
      throw new Error('Preference table existed in previous schema');
    }
    await apply([target]);
    const priorAccount = await client.query(
      'SELECT display_name FROM user_accounts WHERE id=$1',
      [accountId],
    );
    if (
      priorAccount.rows[0]?.display_name !== 'Prior' ||
      !(await tableExists(schemas.upgrade))
    ) {
      throw new Error(
        'Previous-schema upgrade lost the account or preference table',
      );
    }

    await selectSchema(schemas.failure);
    await apply(migrations.filter((name) => name < target));
    await client.query(
      `INSERT INTO user_accounts (id, external_subject, display_name, updated_at) VALUES ($1, $2, 'Failure Prior', now())`,
      [accountId, `notary-pref-failure-${suffix}`],
    );
    await client.query(`CREATE TABLE "_prisma_migrations" (
      "id" VARCHAR(36) NOT NULL PRIMARY KEY,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`);
    for (const name of migrations.filter((item) => item < target)) {
      const sql = await readFile(resolve(migrationRoot, name, 'migration.sql'));
      await client.query(
        `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ($1, $2, now(), $3, 1)`,
        [randomUUID(), createHash('sha256').update(sql).digest('hex'), name],
      );
    }
    await client.query(
      'ALTER TABLE user_accounts RENAME TO prior_user_accounts',
    );
    await client.query(
      'CREATE VIEW user_accounts AS SELECT * FROM prior_user_accounts',
    );
    let failureCode = null;
    await client.query('BEGIN');
    try {
      await client.query(
        'CREATE TABLE "_fk_fault_probe" ("user_id" UUID NOT NULL)',
      );
      await client.query(
        'ALTER TABLE "_fk_fault_probe" ADD CONSTRAINT "_fk_fault_probe_user_fkey" FOREIGN KEY ("user_id") REFERENCES "user_accounts"("id")',
      );
    } catch (error) {
      failureCode = error.code;
    } finally {
      await client.query('ROLLBACK');
    }
    if (failureCode !== '42809') {
      throw new Error('The FK failure setup did not produce SQLSTATE 42809');
    }
    const failedDeploy = runPrisma(schemas.failure, ['deploy']);
    const partialTable = await tableExists(schemas.failure);
    const failedLedger = await client.query(
      `SELECT finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name=$1`,
      [target],
    );
    if (
      failedDeploy.status === 0 ||
      !failedDeploy.transactionAborted ||
      failedLedger.rows.length !== 1 ||
      failedLedger.rows[0].finished_at !== null ||
      failedLedger.rows[0].rolled_back_at !== null ||
      partialTable
    ) {
      throw new Error(
        'Real Prisma failure was not atomic or not recorded as expected',
      );
    }
    const resolved = runPrisma(schemas.failure, [
      'resolve',
      '--rolled-back',
      target,
    ]);
    if (resolved.status !== 0) {
      throw new Error('Failed Prisma migration could not be resolved');
    }
    await client.query('DROP VIEW user_accounts');
    await client.query(
      'ALTER TABLE prior_user_accounts RENAME TO user_accounts',
    );
    const retried = runPrisma(schemas.failure, ['deploy']);
    const preserved = await client.query(
      'SELECT display_name FROM user_accounts WHERE id=$1',
      [accountId],
    );
    if (
      retried.status !== 0 ||
      !(await tableExists(schemas.failure)) ||
      preserved.rows[0]?.display_name !== 'Failure Prior'
    ) {
      throw new Error(
        'Prisma retry did not restore the migration and prior account',
      );
    }
    return {
      emptyChain: true,
      previousSchemaPreserved: true,
      foreignKeyCode,
      restrictCode,
      failureCode,
      failedDeployStatus: failedDeploy.status,
      failedDeployTransactionAborted: failedDeploy.transactionAborted,
      failedLedgerUnfinished:
        failedLedger.rows.length === 1 &&
        failedLedger.rows[0].finished_at === null &&
        failedLedger.rows[0].rolled_back_at === null,
      failedMigrationAtomic: !partialTable,
      resolvedAndRetried: true,
      failurePriorAccountPreserved: true,
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
