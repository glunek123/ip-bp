import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from './test-environment.mjs';

const root = resolve(import.meta.dirname, '..');
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const migrationRoot = resolve(root, 'backend/prisma/migrations');
const target = '20260928010000_add_notary_opening_review';

async function testClient() {
  const values = parseEnv(
    await readFile(resolve(root, 'backend/.env.test'), 'utf8'),
  );
  const url = process.env.DEV_COR_TEST_DATABASE_URL ?? values.DATABASE_URL;
  const targetDatabase = validateIsolatedTestDatabaseUrl(url, {
    allowRandomPort: process.env.DEV_COR_TEST_DATABASE_URL !== undefined,
  });
  const client = new Client({
    connectionString: targetDatabase.connectionString,
  });
  await client.connect();
  const { rows } = await client.query('SELECT current_database() AS database');
  assert.equal(rows[0].database, 'dev_cor_test');
  return client;
}

test('opening review migration upgrades the prior schema without rewriting opening facts', async () => {
  const client = await testClient();
  const schema = `nt003_review_${randomUUID().replaceAll('-', '')}`;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const migrations = (await readdir(migrationRoot))
      .filter((name) => /^\d+_/.test(name))
      .sort();
    assert.equal(migrations.at(-1), target);
    for (const name of migrations.filter((name) => name < target)) {
      await client.query(
        await readFile(resolve(migrationRoot, name, 'migration.sql'), 'utf8'),
      );
    }
    const departmentId = randomUUID();
    const userId = randomUUID();
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,NOW())',
      [departmentId, '旧部门'],
    );
    await client.query(
      'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,NOW())',
      [userId, `legacy:${userId}`, '旧办理人'],
    );
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,NOW())',
      [randomUUID(), userId, departmentId],
    );
    const before = await client.query(
      'SELECT id,user_id,department_id FROM department_memberships WHERE user_id=$1',
      [userId],
    );
    await client.query(
      await readFile(resolve(migrationRoot, target, 'migration.sql'), 'utf8'),
    );
    const after = await client.query(
      'SELECT id,user_id,department_id FROM department_memberships WHERE user_id=$1',
      [userId],
    );
    assert.deepEqual(after.rows, before.rows);
    const enumRows = await client.query(
      `SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid=pg_enum.enumtypid JOIN pg_namespace ON pg_namespace.oid=pg_type.typnamespace WHERE pg_namespace.nspname=$1 AND pg_type.typname='notary_matter_stage'`,
      [schema],
    );
    assert.ok(
      enumRows.rows.some(({ enumlabel }) => enumlabel === 'ISSUANCE_DECISION'),
    );
    assert.ok(enumRows.rows.some(({ enumlabel }) => enumlabel === 'ARCHIVED'));
    const tables = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name IN ('notary_opening_review_decisions','notary_opening_review_receipts')`,
      [schema],
    );
    assert.equal(tables.rowCount, 2);
  } finally {
    await client.query('ROLLBACK');
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});

test('decisions and receipts enforce outcomes, actor identity, immutability, and replay keys', async () => {
  const client = await testClient();
  const schema = `nt003_constraints_${randomUUID().replaceAll('-', '')}`;
  const ids = {
    dept: randomUUID(),
    customer: randomUUID(),
    internal: randomUUID(),
    client: randomUUID(),
    otherClient: randomUUID(),
    binding: randomUUID(),
    otherBinding: randomUUID(),
    matter1: randomUUID(),
    matter2: randomUUID(),
    matter3: randomUUID(),
    decision1: randomUUID(),
    decision2: randomUUID(),
  };
  async function rejected(sql, values, code) {
    await client.query('SAVEPOINT negative_case');
    try {
      await client.query(sql, values);
      assert.fail(`expected PostgreSQL ${code}`);
    } catch (error) {
      assert.equal(error.code, code);
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT negative_case');
      await client.query('RELEASE SAVEPOINT negative_case');
    }
  }
  const decisionSql = `INSERT INTO notary_opening_review_decisions
    (id,matter_id,department_id,customer_id,actor_user_id,actor_kind,internal_actor_user_id,customer_account_binding_id,actor_display_name_snapshot,result,reason,archived_at,from_version,to_version)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'审核人',$9,$10,$11,3,4)`;
  const receiptSql = `INSERT INTO notary_opening_review_receipts
    (id,department_id,customer_id,actor_user_id,actor_kind,internal_actor_user_id,customer_account_binding_id,idempotency_key,request_fingerprint,result_matter_id,result_matter_version,review_decision_id,result_snapshot)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,4,$11,'{}'::jsonb)`;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(
      `CREATE TYPE permission_action AS ENUM ('notary.unbox.record')`,
    );
    await client.query(
      `CREATE TYPE notary_matter_stage AS ENUM ('UNBOX_REVIEW')`,
    );
    await client.query(`CREATE TABLE user_accounts(id uuid PRIMARY KEY)`);
    await client.query(
      `CREATE TABLE department_memberships(user_id uuid,department_id uuid,UNIQUE(user_id,department_id))`,
    );
    await client.query(
      `CREATE TABLE customer_account_bindings(id uuid PRIMARY KEY,user_id uuid,customer_id uuid,department_id uuid,CONSTRAINT review_binding_identity UNIQUE(id,user_id,customer_id,department_id))`,
    );
    await client.query(
      `CREATE TABLE notary_matters(id uuid PRIMARY KEY,customer_id uuid,department_id uuid,stage notary_matter_stage,UNIQUE(id,department_id))`,
    );
    await client.query(
      `CREATE TABLE notary_matter_opening(matter_id uuid PRIMARY KEY,department_id uuid,UNIQUE(matter_id,department_id))`,
    );
    await client.query(
      "INSERT INTO notary_matters VALUES ($1,$2,$3,'UNBOX_REVIEW')",
      [ids.matter1, ids.customer, ids.dept],
    );
    await client.query('INSERT INTO notary_matter_opening VALUES ($1,$2)', [
      ids.matter1,
      ids.dept,
    ]);
    const legacyOpening = await client.query(
      'SELECT * FROM notary_matter_opening WHERE matter_id=$1',
      [ids.matter1],
    );
    const migration = await readFile(
      resolve(migrationRoot, target, 'migration.sql'),
      'utf8',
    );
    await client.query(
      'ALTER TABLE customer_account_bindings DROP CONSTRAINT review_binding_identity',
    );
    await assert.rejects(
      client.query(migration),
      (error) => error.code === '42830',
    );
    await client.query('ROLLBACK');
    const rollback = await client.query(
      "SELECT to_regclass('notary_opening_review_decisions') AS decision",
    );
    assert.equal(rollback.rows[0].decision, null);
    const enumRollback = await client.query(
      `SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid=pg_enum.enumtypid JOIN pg_namespace ON pg_namespace.oid=pg_type.typnamespace WHERE pg_namespace.nspname=$1 AND pg_type.typname='notary_matter_stage'`,
      [schema],
    );
    assert.equal(
      enumRollback.rows.some(({ enumlabel }) => enumlabel === 'ARCHIVED'),
      false,
    );
    await client.query(
      'ALTER TABLE customer_account_bindings ADD CONSTRAINT review_binding_identity UNIQUE(id,user_id,customer_id,department_id)',
    );
    await client.query(migration);
    const upgradedOpening = await client.query(
      'SELECT * FROM notary_matter_opening WHERE matter_id=$1',
      [ids.matter1],
    );
    assert.deepEqual(upgradedOpening.rows, legacyOpening.rows);
    await client.query('BEGIN');
    for (const user of [ids.internal, ids.client, ids.otherClient])
      await client.query('INSERT INTO user_accounts VALUES ($1)', [user]);
    await client.query('INSERT INTO department_memberships VALUES ($1,$2)', [
      ids.internal,
      ids.dept,
    ]);
    await client.query(
      'INSERT INTO customer_account_bindings VALUES ($1,$2,$3,$4),($5,$6,$3,$4)',
      [
        ids.binding,
        ids.client,
        ids.customer,
        ids.dept,
        ids.otherBinding,
        ids.otherClient,
      ],
    );
    for (const matter of [ids.matter2, ids.matter3]) {
      await client.query(
        "INSERT INTO notary_matters VALUES ($1,$2,$3,'UNBOX_REVIEW')",
        [matter, ids.customer, ids.dept],
      );
      await client.query('INSERT INTO notary_matter_opening VALUES ($1,$2)', [
        matter,
        ids.dept,
      ]);
    }
    const internalDecision = [
      ids.decision1,
      ids.matter1,
      ids.dept,
      ids.customer,
      ids.internal,
      'INTERNAL',
      ids.internal,
      null,
      'INFRINGEMENT',
      null,
      null,
    ];
    const clientDecision = [
      ids.decision2,
      ids.matter2,
      ids.dept,
      ids.customer,
      ids.client,
      'CLIENT',
      null,
      ids.binding,
      'NO_INFRINGEMENT',
      '确认无侵权',
      new Date(),
    ];
    await client.query(decisionSql, internalDecision);
    await client.query(decisionSql, clientDecision);
    await rejected(
      decisionSql,
      [
        randomUUID(),
        ids.matter3,
        ids.dept,
        ids.customer,
        ids.otherClient,
        'CLIENT',
        null,
        ids.otherBinding,
        'NO_INFRINGEMENT',
        null,
        new Date(),
      ],
      '23514',
    );
    await rejected(
      decisionSql,
      [
        randomUUID(),
        ids.matter3,
        ids.dept,
        ids.customer,
        ids.internal,
        'INTERNAL',
        null,
        null,
        'INFRINGEMENT',
        null,
        null,
      ],
      '23514',
    );
    await rejected(
      decisionSql,
      [
        randomUUID(),
        ids.matter3,
        ids.dept,
        ids.customer,
        ids.otherClient,
        'CLIENT',
        null,
        ids.binding,
        'INFRINGEMENT',
        null,
        null,
      ],
      '23503',
    );
    const internalReceipt = [
      randomUUID(),
      ids.dept,
      ids.customer,
      ids.internal,
      'INTERNAL',
      ids.internal,
      null,
      'request-a',
      'a'.repeat(64),
      ids.matter1,
      ids.decision1,
    ];
    const clientReceipt = [
      randomUUID(),
      ids.dept,
      ids.customer,
      ids.client,
      'CLIENT',
      null,
      ids.binding,
      'request-b',
      'b'.repeat(64),
      ids.matter2,
      ids.decision2,
    ];
    await rejected(
      receiptSql,
      [
        randomUUID(),
        ids.dept,
        ids.customer,
        ids.otherClient,
        'CLIENT',
        null,
        ids.otherBinding,
        'request-c',
        'c'.repeat(64),
        ids.matter1,
        ids.decision1,
      ],
      '23503',
    );
    await client.query(receiptSql, internalReceipt);
    await client.query(receiptSql, clientReceipt);
    await rejected(
      receiptSql,
      [
        randomUUID(),
        ids.dept,
        ids.customer,
        ids.internal,
        'INTERNAL',
        ids.internal,
        null,
        'request-a',
        'd'.repeat(64),
        ids.matter1,
        ids.decision1,
      ],
      '23505',
    );
    await rejected(
      'UPDATE notary_opening_review_decisions SET reason=$1 WHERE id=$2',
      ['changed', ids.decision1],
      '55000',
    );
    await rejected(
      'DELETE FROM notary_opening_review_receipts WHERE review_decision_id=$1',
      [ids.decision1],
      '55000',
    );
    await client.query('ROLLBACK');
  } finally {
    await client.query('ROLLBACK');
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
