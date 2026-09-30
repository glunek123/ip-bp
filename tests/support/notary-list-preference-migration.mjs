import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const requireFromBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { Client } = requireFromBackend('pg');
const migrationRoot = resolve(process.cwd(), 'backend/prisma/migrations');
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
      'ALTER TABLE user_accounts RENAME TO prior_user_accounts',
    );
    await client.query(
      'CREATE VIEW user_accounts AS SELECT * FROM prior_user_accounts',
    );
    let failureCode = null;
    try {
      await client.query('BEGIN');
      await apply([target]);
      await client.query('COMMIT');
    } catch (error) {
      failureCode = error.code;
      await client.query('ROLLBACK');
    }
    if (failureCode === null || (await tableExists(schemas.failure))) {
      throw new Error('Failed migration left a partial preference table');
    }
    return {
      emptyChain: true,
      previousSchemaPreserved: true,
      foreignKeyCode,
      restrictCode,
      failureCode,
      failedMigrationAtomic: true,
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
