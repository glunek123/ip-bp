import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = process.cwd();
const migrationCount = 161;
const predecessorCount = 160;
const predecessor = '20261016100000_case_execution_filing_followups';
const target = '20261016110000_lead_batch_push';
const targetTable = 'lead_batch_push_receipts';
const expectedTuple = Object.freeze({
  project: 'dev-cor-ui003-r2',
  containerId:
    '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
  host: '127.0.0.1',
  port: 15438,
  database: 'dev_cor_test',
});
const pins = Object.freeze({
  '20261015150000_case_section_record_edits':
    '10760cf6e9969822a6b6a631760645625d227c4541a018560473e34c164953c7',
  '20261015170000_case_section_record_uploads':
    '883f2f80b615a0f746adb2ebbb6e17cc24d0ac577a61d236f3bb6375fbc0367d',
  '20261016090000_case_record_material_guard_repair':
    'dfe31436055f7ab9bf8d0796c48b3a0dd38a16acf4e5b3554e04e3d299b7b869',
  '20261016093000_case_record_material_reference_reuse':
    '628a0fc0a664942896fdd85e3811bfe977702e4924ef33a58f83399a9bf8280e',
  [predecessor]:
    'e125a3278b0530860b1be49273fc667224451f8a6d35b420bdf14e2b9c684105',
  [target]: '1e267e104e4a7a1b20f1014dfd10506ce1aa831e32a11175e3a4dde2430c9e87',
});
const failureMarker = 'owned_lead_batch_push_migration_failure';
const expectedNewFunctions = [
  'reject_lead_batch_push_receipt_mutation',
  'validate_lead_batch_push_receipt',
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;

export function admitLeadBatchPushMigration(environment) {
  assert.equal(environment.NODE_ENV, 'test');
  assert.equal(
    environment.DEV_COR_TEST_DATABASE_PROJECT,
    expectedTuple.project,
  );
  assert.equal(
    environment.DEV_COR_TEST_DATABASE_CONTAINER_ID,
    expectedTuple.containerId,
  );
  const values = [
    environment.DATABASE_URL,
    environment.DEV_COR_TEST_DATABASE_URL,
  ];
  for (const value of values) {
    assert.equal(
      typeof value,
      'string',
      'Both explicit database URLs are required',
    );
    assert.equal(value.includes('?') || value.includes('#'), false);
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error('Malformed explicit test database URL');
    }
    assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
    assert.equal(url.hostname, expectedTuple.host);
    assert.equal(url.port, '15438');
    assert.equal(url.pathname, `/${expectedTuple.database}`);
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
    assert.ok(url.username && url.password);
  }
  assert.equal(values[0], values[1], 'Both database URLs must match exactly');
  const pnpmVersion = (environment.npm_config_user_agent ?? '').match(
    /\bpnpm\/([^\s]+)/u,
  )?.[1];
  assert.equal(pnpmVersion, '11.27.0');
  return Object.freeze({
    connectionString: values[0],
    tuple: expectedTuple,
    pnpmVersion,
  });
}

export function assertMigrationIsolation(sql) {
  assert.doesNotMatch(
    sql,
    /\bpublic\b|\bsearch_path\b|session_replication_role|\bdblink\b|\blo_import\b|\blo_export\b/iu,
  );
  assert.doesNotMatch(
    sql,
    /\b(?:CREATE|ALTER|DROP)\s+(?:DATABASE|ROLE|USER|TABLESPACE|EXTENSION|SCHEMA)\b/iu,
  );
  assert.doesNotMatch(sql, /\bCOPY\b|\bset_config\s*\(/iu);
  assert.doesNotMatch(
    sql,
    /\b(?:CREATE(?:\s+OR\s+REPLACE)?\s+(?:TABLE|FUNCTION|VIEW|SEQUENCE)|ALTER\s+(?:TABLE|FUNCTION|SEQUENCE)|DROP\s+(?:TABLE|FUNCTION|VIEW|SEQUENCE)|INSERT\s+INTO|UPDATE|DELETE\s+FROM|REFERENCES|TRUNCATE(?:\s+TABLE)?)\s+"?[a-z_][\w]*"?\s*\./iu,
  );
}

export async function leadBatchPushMigrationPlan(
  directory = resolve(root, 'backend/prisma/migrations'),
) {
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  assert.equal(names.length, migrationCount);
  assert.equal(names.at(-2), predecessor);
  assert.equal(names.at(-1), target);
  const plan = [];
  for (const name of names) {
    const bytes = await readFile(resolve(directory, name, 'migration.sql'));
    const sql = bytes.toString('utf8');
    assertMigrationIsolation(sql);
    plan.push(Object.freeze({ name, sql, sha256: sha256(bytes) }));
  }
  for (const [name, checksum] of Object.entries(pins)) {
    assert.equal(
      plan.find((entry) => entry.name === name)?.sha256,
      checksum,
      `Raw migration source pin mismatch: ${name}`,
    );
  }
  assert.equal(plan.at(-1).sql.startsWith('BEGIN;'), true);
  assert.match(plan.at(-1).sql, /COMMIT;\s*$/u);
  return plan;
}

export function ownedLeadBatchSchema(nonce, kind) {
  assert.match(nonce, /^[a-f0-9]{32}$/u);
  assert.ok(['empty', 'upgrade'].includes(kind));
  return `uxq03_batch_${nonce}_${kind}`;
}

export function assertOwnedLeadBatchSchema(
  name,
  nonce,
  created,
  actualComment,
  expectedComment,
) {
  assert.ok(
    ['empty', 'upgrade'].some(
      (kind) => ownedLeadBatchSchema(nonce, kind) === name,
    ),
  );
  assert.ok(created.has(name), 'Never adopt or drop a preexisting schema');
  assert.equal(actualComment, expectedComment, 'Owned schema marker changed');
}

export function injectLeadBatchMigrationFailure(sql) {
  assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/u);
  return sql.replace(
    /COMMIT;\s*$/u,
    `DO $probe$ BEGIN RAISE EXCEPTION '${failureMarker}' USING ERRCODE='P0001'; END $probe$;\nCOMMIT;`,
  );
}

export function assertLeadBatchMigrationFailure(error) {
  assert.equal(error?.code, 'P0001');
  assert.equal(error?.message, failureMarker);
}

export function assertPublicPredecessorLedger(rows, plan) {
  assert.equal(plan.length, migrationCount);
  assert.equal(rows.length, predecessorCount);
  for (const [index, row] of rows.entries()) {
    assert.equal(row.migration_name, plan[index].name);
    assert.equal(row.checksum, plan[index].sha256);
    assert.ok(row.finished_at);
    assert.equal(row.rolled_back_at, null);
  }
  assert.equal(rows.at(-1).migration_name, predecessor);
}

export function assertPreservedPredecessor(before, after) {
  const exclude = (snapshot) => ({
    relations: snapshot.relations.filter(
      (row) =>
        row.name !== targetTable && !row.name.startsWith(`${targetTable}_`),
    ),
    columns: snapshot.columns.filter((row) => row.table !== targetTable),
    constraints: snapshot.constraints.filter(
      (row) => row.table !== targetTable,
    ),
    functions: snapshot.functions.filter(
      (row) => !expectedNewFunctions.includes(row.name),
    ),
    triggers: snapshot.triggers.filter((row) => row.table !== targetTable),
    indexes: snapshot.indexes.filter(
      (row) => !row.name.startsWith(`${targetTable}_`),
    ),
    types: snapshot.types.filter(
      (row) => row.name !== targetTable && row.name !== `_${targetTable}`,
    ),
    enums: snapshot.enums,
    sequences: snapshot.sequences,
    schema: snapshot.schema,
    acls: snapshot.acls.filter(
      (row) =>
        row.object !== targetTable &&
        !row.object.startsWith(`${targetTable}_`) &&
        !expectedNewFunctions.includes(row.object.split('(')[0]),
    ),
    data: snapshot.data.filter((row) => row.table !== targetTable),
  });
  assert.deepEqual(exclude(after), before);
}

export function splitLeadBatchMigrationPrelude(entry) {
  if (
    !['20261015150000_case_section_record_edits', predecessor].includes(
      entry.name,
    )
  )
    return [entry.sql];
  const boundary = entry.sql.indexOf('\nBEGIN;');
  assert.ok(boundary > 0, `Pinned enum prelude missing: ${entry.name}`);
  const parts = [entry.sql.slice(0, boundary), entry.sql.slice(boundary)];
  assert.equal(
    parts.join(''),
    entry.sql,
    'Migration split must preserve raw bytes',
  );
  assert.match(parts[0], /ALTER TYPE[\s\S]+ADD VALUE/iu);
  return parts;
}

export function snapshotDigest(snapshot) {
  return sha256(JSON.stringify(snapshot));
}

async function catalogSnapshot(client, schema) {
  const query = async (sql) => (await client.query(sql, [schema])).rows;
  const schemaRows = await query(
    `SELECT n.oid::text AS oid,pg_get_userbyid(n.nspowner) AS owner,n.nspacl::text AS acl
     FROM pg_namespace n WHERE n.nspname=$1`,
  );
  const relations = await query(
    `SELECT c.oid::text AS oid,c.relname AS name,c.relkind,pg_get_userbyid(c.relowner) AS owner,c.relacl::text AS acl
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=$1 ORDER BY c.relname`,
  );
  const columns = await query(
    `SELECT c.relname AS table,a.attname AS name,a.atttypid::regtype::text AS type,
            a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default
     FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace
     LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
     WHERE n.nspname=$1 AND a.attnum>0 AND NOT a.attisdropped
     ORDER BY c.relname,a.attnum`,
  );
  const constraints = await query(
    `SELECT c.relname AS table,k.conname AS name,pg_get_constraintdef(k.oid) AS definition
     FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1
     ORDER BY c.relname,k.conname`,
  );
  const functions = await query(
    `SELECT p.oid::text AS oid,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS args,
            pg_get_userbyid(p.proowner) AS owner,pg_get_functiondef(p.oid) AS definition,
            p.proconfig::text AS config,p.proacl::text AS acl
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname=$1 AND p.prokind IN ('f','p') ORDER BY p.proname,args`,
  );
  const triggers = await query(
    `SELECT c.relname AS table,t.tgname AS name,pg_get_triggerdef(t.oid) AS definition
     FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
  );
  const indexes = await query(
    'SELECT indexname AS name,indexdef AS definition FROM pg_indexes WHERE schemaname=$1 ORDER BY indexname',
  );
  const types = await query(
    `SELECT t.oid::text AS oid,t.typname AS name,t.typtype,pg_get_userbyid(t.typowner) AS owner,t.typacl::text AS acl FROM pg_type t
     JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 ORDER BY t.typname`,
  );
  const enums = await query(
    `SELECT t.typname AS name,e.enumlabel AS label,e.enumsortorder AS sort_order
     FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
     JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname=$1
     ORDER BY t.typname,e.enumsortorder`,
  );
  const sequences = [];
  for (const relation of relations.filter((row) => row.relkind === 'S')) {
    const state = (
      await client.query(
        `SELECT last_value::text AS last_value,is_called FROM ${quote(schema)}.${quote(relation.name)}`,
      )
    ).rows[0];
    sequences.push({ name: relation.name, ...state });
  }
  const acls = await query(
    `SELECT 'schema' AS kind,n.nspname AS object,n.nspacl::text AS acl
       FROM pg_namespace n WHERE n.nspname=$1
     UNION ALL
     SELECT 'relation',c.relname,c.relacl::text FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1
     UNION ALL
     SELECT 'function',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',p.proacl::text
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.prokind IN ('f','p')
     ORDER BY kind,object`,
  );
  const data = [];
  for (const relation of relations.filter(
    (row) => row.relkind === 'r' || row.relkind === 'p',
  )) {
    const rows = (
      await client.query(
        `SELECT to_jsonb(r)::text AS row FROM ${quote(schema)}.${quote(relation.name)} r ORDER BY to_jsonb(r)::text`,
      )
    ).rows;
    data.push({
      table: relation.name,
      count: rows.length,
      sha256: sha256(JSON.stringify(rows)),
    });
  }
  return {
    schema: schemaRows[0] ?? null,
    relations,
    columns,
    constraints,
    functions,
    triggers,
    indexes,
    types,
    enums,
    sequences,
    acls,
    data,
  };
}

function safeSchemaName(name) {
  assert.match(name, /^uxq03_batch_[a-f0-9]{32}_(?:empty|upgrade)$/u);
  return quote(name);
}

export async function verifyLeadBatchPushMigration(report = () => undefined) {
  const plan = await leadBatchPushMigrationPlan();
  const environment = process.env;
  const admitted = admitLeadBatchPushMigration(environment);
  const pnpmVersion = admitted.pnpmVersion;
  const { captureTestEnvironment } =
    await import('../../scripts/test-environment.mjs');
  const captured = await captureTestEnvironment(root, { pnpmVersion });
  assert.equal(
    captured.childEnvironment.DATABASE_URL,
    admitted.connectionString,
  );
  assert.equal(
    captured.childEnvironment.DEV_COR_TEST_DATABASE_PROJECT,
    expectedTuple.project,
  );
  assert.equal(
    captured.childEnvironment.DEV_COR_TEST_DATABASE_CONTAINER_ID,
    expectedTuple.containerId,
  );
  const backend = createRequire(resolve(root, 'backend/package.json'));
  const { Client } = backend('pg');
  const client = new Client({ connectionString: admitted.connectionString });
  const nonce = randomUUID().replaceAll('-', '');
  const created = new Set();
  const comment = `uxq03-lead-batch-migration:${nonce}`;
  const schemas = ['empty', 'upgrade'].map((kind) =>
    ownedLeadBatchSchema(nonce, kind),
  );
  const result = {
    source: plan.map(({ name, sha256: hash }) => ({ name, sha256: hash })),
    checks: [],
    publicUnchanged: false,
    cleanedSchemas: 0,
    fingerprint: captured.fingerprint,
  };
  let publicBefore;
  let publicBeforeCleanup;
  let success = false;
  let primaryError;
  await client.connect();

  const verifyOwned = async (name) => {
    const rows = (
      await client.query(
        `SELECT obj_description(oid,'pg_namespace') AS comment FROM pg_namespace WHERE nspname=$1`,
        [name],
      )
    ).rows;
    assert.equal(rows.length, 1);
    assertOwnedLeadBatchSchema(name, nonce, created, rows[0].comment, comment);
  };
  const selectOwned = async (name) => {
    await verifyOwned(name);
    await client.query(
      `SET search_path TO ${safeSchemaName(name)}, pg_catalog`,
    );
    assert.equal(
      (await client.query('SELECT current_schema() AS schema')).rows[0].schema,
      name,
    );
  };
  const createOwned = async (name) => {
    await client.query(`CREATE SCHEMA ${safeSchemaName(name)}`);
    created.add(name);
    await client.query(
      `COMMENT ON SCHEMA ${safeSchemaName(name)} IS '${comment}'`,
    );
    await selectOwned(name);
  };
  const replay = async (name, entries) => {
    await selectOwned(name);
    for (const entry of entries) {
      for (const part of splitLeadBatchMigrationPrelude(entry))
        await client.query(part);
    }
  };

  try {
    assert.deepEqual(
      (
        await client.query(
          'SELECT current_database() AS db,current_schema() AS schema,current_user AS db_user',
        )
      ).rows[0],
      { db: expectedTuple.database, schema: 'public', db_user: 'dev_cor_test' },
    );
    await client.query("SET statement_timeout='120s'; SET lock_timeout='5s'");
    const ledger = (
      await client.query(
        'SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name',
      )
    ).rows;
    assertPublicPredecessorLedger(ledger, plan);
    await client.query('SET search_path TO pg_catalog');
    publicBefore = await catalogSnapshot(client, 'public');
    result.publicDigests = { before: snapshotDigest(publicBefore) };

    await createOwned(schemas[0]);
    await replay(schemas[0], plan);
    const empty = await catalogSnapshot(client, schemas[0]);
    assert.ok(empty.relations.some((row) => row.name === targetTable));
    assert.equal(empty.data.find((row) => row.table === targetTable)?.count, 0);
    result.checks.push('empty-owned-full-161-source-replay');

    await createOwned(schemas[1]);
    await replay(schemas[1], plan.slice(0, predecessorCount));
    const [departmentId, userId, membershipId] = Array.from({ length: 3 }, () =>
      randomUUID(),
    );
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO ${quote(schemas[1])}.departments(id,name,updated_at) VALUES($1,$2,now())`,
      [departmentId, `uxq03 migration ${nonce}`],
    );
    await client.query(
      `INSERT INTO ${quote(schemas[1])}.user_accounts(id,external_subject,display_name,active,account_type,updated_at) VALUES($1,$2,'Migration Fixture',true,'INTERNAL',now())`,
      [userId, `uxq03-migration:${nonce}`],
    );
    await client.query(
      `INSERT INTO ${quote(schemas[1])}.department_memberships(id,user_id,department_id,updated_at) VALUES($1,$2,$3,now())`,
      [membershipId, userId, departmentId],
    );
    await client.query('COMMIT');
    const before160 = await catalogSnapshot(client, schemas[1]);
    const originalTarget = plan.at(-1).sql;
    let caught;
    try {
      await client.query(injectLeadBatchMigrationFailure(originalTarget));
    } catch (error) {
      caught = error;
    }
    await client.query('ROLLBACK');
    assertLeadBatchMigrationFailure(caught);
    assert.deepEqual(await catalogSnapshot(client, schemas[1]), before160);
    assert.equal(
      originalTarget,
      plan.at(-1).sql,
      'Failure injection must not mutate source bytes',
    );
    result.checks.push('owned-160-fixture-ddl-rollback');

    await replay(schemas[1], [plan.at(-1)]);
    const after161 = await catalogSnapshot(client, schemas[1]);
    assertPreservedPredecessor(before160, after161);
    assert.equal(
      after161.data.find((row) => row.table === targetTable)?.count,
      0,
    );
    const newForeignKeys = (
      await client.query(
        `SELECT c.conname AS name, target_n.nspname AS target_schema,
              target.relname AS target_table
       FROM pg_constraint c JOIN pg_class source ON source.oid=c.conrelid
       JOIN pg_namespace source_n ON source_n.oid=source.relnamespace
       JOIN pg_class target ON target.oid=c.confrelid
       JOIN pg_namespace target_n ON target_n.oid=target.relnamespace
       WHERE source_n.nspname=$1 AND source.relname=$2 AND c.contype='f'
       ORDER BY c.conname`,
        [schemas[1], targetTable],
      )
    ).rows;
    assert.equal(newForeignKeys.length, 2);
    assert.deepEqual(newForeignKeys.map((row) => row.target_table).sort(), [
      'department_memberships',
      'departments',
    ]);
    assert.ok(newForeignKeys.every((row) => row.target_schema === schemas[1]));
    result.checks.push(
      'owned-160-minimal-membership-upgrade-failure-and-raw-retry',
    );
    result.fixture =
      'department + internal user + membership only; no lead or business receipt facts';
    success = true;
  } catch (error) {
    primaryError = error;
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    if (publicBefore) {
      try {
        await client.query('SET search_path TO pg_catalog');
        assert.deepEqual(await catalogSnapshot(client, 'public'), publicBefore);
        result.publicUnchanged = true;
      } catch (error) {
        primaryError ??= error;
        success = false;
      }
    }
    if (success && result.publicUnchanged) {
      try {
        await client.query('SET search_path TO pg_catalog');
        publicBeforeCleanup = await catalogSnapshot(client, 'public');
        result.publicDigests.beforeCleanup =
          snapshotDigest(publicBeforeCleanup);
        assert.deepEqual(publicBeforeCleanup, publicBefore);
        for (const name of created) {
          await verifyOwned(name);
          const inbound = (
            await client.query(
              `SELECT count(*)::int AS count FROM pg_depend d
             CROSS JOIN LATERAL pg_identify_object(d.classid,d.objid,d.objsubid) obj
             CROSS JOIN LATERAL pg_identify_object(d.refclassid,d.refobjid,d.refobjsubid) ref
             WHERE d.deptype='n' AND ref.schema=$1 AND obj.schema IS NOT NULL AND obj.schema<>$1`,
              [name],
            )
          ).rows[0].count;
          assert.equal(
            inbound,
            0,
            'Cross-schema dependency; retain owned schema',
          );
        }
        await client.query('BEGIN');
        for (const name of created)
          await client.query(`DROP SCHEMA ${safeSchemaName(name)} CASCADE`);
        await client.query('COMMIT');
        result.cleanedSchemas = created.size;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        primaryError ??= error;
      }
    }
    if (publicBefore) {
      try {
        await client.query('SET search_path TO pg_catalog');
        const publicAfter = await catalogSnapshot(client, 'public');
        assert.deepEqual(publicAfter, publicBefore);
        result.publicDigests.after = snapshotDigest(publicAfter);
        assert.equal(result.publicDigests.before, result.publicDigests.after);
        if (result.publicDigests.beforeCleanup !== undefined) {
          assert.equal(
            result.publicDigests.beforeCleanup,
            result.publicDigests.after,
          );
        }
      } catch (error) {
        primaryError ??= error;
        result.publicUnchanged = false;
      }
    }
    await client.end().catch((error) => {
      primaryError ??= error;
    });
    await report({ ...result });
  }
  if (primaryError) throw primaryError;
  assert.equal(result.cleanedSchemas, 2);
  return result;
}
