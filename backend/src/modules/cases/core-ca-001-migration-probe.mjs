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
const target = '20260929020000_add_case_matching';
const correction = '20260929021000_reconcile_case_match_grants';
const factsCorrection = '20260929022000_correct_case_match_facts';
const migrations = readdirSync(migrationRoot)
  .filter((name) => /^\d{14}_/.test(name))
  .sort();
assert.deepEqual(migrations.slice(-3), [target, correction, factsCorrection]);
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
    const schema = `ca001_${mode}_${randomBytes(8).toString('hex')}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    try {
      await client.query(`SET search_path TO "${schema}"`);
      for (const name of migrations.filter((name) => name < target))
        await client.query(
          readFileSync(resolve(migrationRoot, name, 'migration.sql'), 'utf8'),
        );
      const legacyDepartment = randomUUID();
      if (mode === 'upgrade')
        await client.query(
          'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
          [legacyDepartment, 'CA001 prior department'],
        );
      const roles = {};
      if (mode === 'upgrade') {
        for (const [label, action, scope] of [
          ['adminOnly', 'role.manage', 'DEPARTMENT'],
          ['selfEditor', 'lead.edit', 'SELF'],
          ['teamEditor', 'lead.edit', 'TEAM'],
          ['departmentEditor', 'lead.edit', 'DEPARTMENT'],
          ['manual', null, null],
        ]) {
          const roleId = randomUUID();
          const userId = randomUUID();
          roles[label] = { roleId, userId };
          await client.query(
            'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,now())',
            [roleId, legacyDepartment, label],
          );
          if (action)
            await client.query(
              'INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,$3,$4)',
              [randomUUID(), roleId, action, scope],
            );
          await client.query(
            'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
            [userId, `ca001:${userId}`, label],
          );
          await client.query(
            'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
            [randomUUID(), userId, legacyDepartment],
          );
          await client.query(
            'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,updated_at) VALUES ($1,$2,$3,$4,now())',
            [randomUUID(), userId, legacyDepartment, roleId],
          );
        }
      }
      const migration = readFileSync(
        resolve(migrationRoot, target, 'migration.sql'),
        'utf8',
      );
      if (mode === 'upgrade') {
        await client.query('CREATE TABLE lawyer_profiles (probe integer)');
        await assert.rejects(
          client.query(migration),
          (error) => error.code === '42P07',
        );
        await client.query('ROLLBACK');
        assert.equal(
          (
            await client.query(
              `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND table_name='cases' AND column_name='matched_at'`,
              [schema],
            )
          ).rows[0].n,
          0,
        );
        await client.query('DROP TABLE lawyer_profiles');
      }
      await client.query(migration);
      let beforeCorrection;
      let manualGrantId;
      if (mode === 'upgrade') {
        manualGrantId = randomUUID();
        await client.query(
          "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,'case.match','DEPARTMENT')",
          [manualGrantId, roles.manual.roleId],
        );
        beforeCorrection = {};
        for (const [label, role] of Object.entries(roles)) {
          beforeCorrection[label] = (
            await client.query(
              'SELECT authorization_revision FROM user_accounts WHERE id=$1',
              [role.userId],
            )
          ).rows[0].authorization_revision;
        }
      }
      await client.query(
        readFileSync(
          resolve(migrationRoot, correction, 'migration.sql'),
          'utf8',
        ),
      );
      const factsMigration = readFileSync(
        resolve(migrationRoot, factsCorrection, 'migration.sql'),
        'utf8',
      );
      let knownLawyerId;
      if (mode === 'upgrade') {
        knownLawyerId = randomUUID();
        await client.query(
          'INSERT INTO lawyer_profiles(id,department_id,full_name,law_firm) VALUES ($1,$2,$3,$4)',
          [knownLawyerId, legacyDepartment, '已有律师', '已有律所'],
        );
        await client.query('ALTER TABLE cases ADD COLUMN matched_on DATE');
        await assert.rejects(
          client.query(factsMigration),
          (error) => error.code === '42701',
        );
        await client.query('ROLLBACK');
        assert.equal(
          (
            await client.query(
              `SELECT is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name='lawyer_profiles' AND column_name='law_firm'`,
              [schema],
            )
          ).rows[0].is_nullable,
          'NO',
        );
        await client.query('ALTER TABLE cases DROP COLUMN matched_on');
      }
      await client.query(factsMigration);
      const matchedOnColumn = await client.query(
        `SELECT data_type,is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name='cases' AND column_name='matched_on'`,
        [schema],
      );
      assert.deepEqual(matchedOnColumn.rows[0], {
        data_type: 'date',
        is_nullable: 'YES',
      });
      if (mode === 'upgrade') {
        const known = await client.query(
          'SELECT full_name,law_firm FROM lawyer_profiles WHERE id=$1',
          [knownLawyerId],
        );
        assert.deepEqual(known.rows[0], {
          full_name: '已有律师',
          law_firm: '已有律所',
        });
        const blank = randomUUID();
        await client.query(
          'INSERT INTO lawyer_profiles(id,department_id,full_name,law_firm) VALUES ($1,$2,$3,NULL)',
          [blank, legacyDepartment, '律所未知律师'],
        );
        assert.equal(
          (
            await client.query(
              'SELECT law_firm FROM lawyer_profiles WHERE id=$1',
              [blank],
            )
          ).rows[0].law_firm,
          null,
        );
        await assert.rejects(
          client.query(
            'INSERT INTO lawyer_profiles(id,department_id,full_name,law_firm) VALUES ($1,$2,$3,$4)',
            [randomUUID(), legacyDepartment, '非法律所', '  '],
          ),
          (error) => error.code === '23514',
        );
      }
      const tables = await client.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name IN ('case_defendants','lawyer_profiles','case_lawyer_assignments','case_match_receipts')`,
        [schema],
      );
      assert.equal(tables.rowCount, 4);
      const stages = await client.query(
        `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typname='case_stage'`,
        [schema],
      );
      assert.ok(
        stages.rows.some((row) => row.enumlabel === 'WAITING_COMPLAINT'),
      );
      if (mode === 'upgrade') {
        assert.equal(
          (
            await client.query('SELECT name FROM departments WHERE id=$1', [
              legacyDepartment,
            ])
          ).rows[0].name,
          'CA001 prior department',
        );
        for (const [label, expectedScopes] of [
          ['adminOnly', []],
          ['selfEditor', ['SELF']],
          ['teamEditor', ['TEAM']],
          ['departmentEditor', ['DEPARTMENT']],
          ['manual', ['DEPARTMENT']],
        ]) {
          const grants = await client.query(
            "SELECT id,scope FROM role_grants WHERE role_template_id=$1 AND action='case.match' ORDER BY scope",
            [roles[label].roleId],
          );
          assert.deepEqual(
            grants.rows.map((row) => row.scope),
            expectedScopes,
            label,
          );
          if (label === 'manual')
            assert.equal(grants.rows[0].id, manualGrantId);
          const revision = (
            await client.query(
              'SELECT authorization_revision FROM user_accounts WHERE id=$1',
              [roles[label].userId],
            )
          ).rows[0].authorization_revision;
          assert.equal(
            revision,
            beforeCorrection[label] +
              (['adminOnly', 'teamEditor', 'departmentEditor'].includes(label)
                ? 1
                : 0),
            `${label} revision`,
          );
        }
      }
      console.log(`CA001 ${mode} migration probe passed`);
    } finally {
      await client.query('ROLLBACK');
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
  }
} finally {
  await client.end();
}
