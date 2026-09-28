import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { captureTestEnvironment } from '../../../../scripts/test-environment.mjs';

const root = resolve(import.meta.dirname, '../../../..');
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const environment = captureTestEnvironment(root, { pnpmVersion: '11.27.0' });
const migrationRoot = resolve(root, 'backend/prisma/migrations');
const target = '20260928050000_add_notary_certificates_and_cases';
const migrations = readdirSync(migrationRoot)
  .filter((name) => /^\d{14}_/.test(name))
  .sort();
assert.equal(migrations.at(-1), target);
const client = new Client({
  connectionString: environment.childEnvironment.DATABASE_URL,
});
await client.connect();
try {
  assert.equal(
    (await client.query('SELECT current_database() AS name')).rows[0].name,
    'dev_cor_test',
  );
  for (const mode of ['empty', 'upgrade']) {
    const schema = `nt005_${mode}_${randomBytes(8).toString('hex')}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    try {
      await client.query(`SET search_path TO "${schema}"`);
      for (const name of migrations.filter((name) => name < target))
        await client.query(
          readFileSync(resolve(migrationRoot, name, 'migration.sql'), 'utf8'),
        );
      const department = randomUUID();
      if (mode === 'upgrade')
        await client.query(
          'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
          [department, 'NT005 legacy'],
        );
      const migration = readFileSync(
        resolve(migrationRoot, target, 'migration.sql'),
        'utf8',
      );
      if (mode === 'upgrade') {
        await client.query('CREATE TABLE cases(probe integer)');
        await assert.rejects(client.query(migration));
        await client.query('ROLLBACK');
        const partial = await client.query(
          `SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name='notary_certificates'`,
          [schema],
        );
        assert.equal(partial.rowCount, 0);
        await client.query('DROP TABLE cases');
      }
      await client.query(migration);
      const tables = await client.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name IN ('notary_certificates','notary_certificate_fees','cases','case_number_counters')`,
        [schema],
      );
      assert.equal(tables.rowCount, 4);
      const enumValues = await client.query(
        `SELECT t.typname,e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typname IN ('permission_action','material_category','case_stage','certificate_fee_category')`,
        [schema],
      );
      for (const value of [
        'case.read',
        'NOTARY_CERTIFICATE',
        'NOTARY_DISCLOSURE',
        'PENDING_MATCH',
        'NOTARY',
        'INVESTIGATION',
        'DISCLOSURE',
      ])
        assert.ok(
          enumValues.rows.some((row) => row.enumlabel === value),
          value,
        );
      const constraints = await client.query(
        `SELECT conname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1 AND t.relname IN ('cases','notary_certificate_fees')`,
        [schema],
      );
      for (const name of [
        'cases_matter_fkey',
        'cases_certificate_fkey',
        'cases_owner_fkey',
        'notary_certificate_fees_amount_check',
      ])
        assert.ok(
          constraints.rows.some((row) => row.conname === name),
          name,
        );
      if (mode === 'upgrade') {
        const preserved = await client.query(
          'SELECT name FROM departments WHERE id=$1',
          [department],
        );
        assert.equal(preserved.rows[0].name, 'NT005 legacy');
      }
      console.log(`NT005 ${mode} migration probe passed`);
    } finally {
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
  }
} finally {
  await client.end();
}
