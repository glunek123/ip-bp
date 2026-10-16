import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import {
  captureTestEnvironment,
  validateBrowserTestDatabaseUrl,
} from '../../scripts/test-environment.mjs';
import {
  assertMigrationIsolation,
  section156Prelude,
} from './case-section-record-migration.mjs';

/* global __filename */
const root =
  typeof __filename === 'string'
    ? resolve(dirname(__filename), '../..')
    : resolve(process.cwd());
const suffix = [
  '20261015130000_guard_direct_second_remand_child',
  '20261015150000_case_section_record_edits',
  '20261015170000_case_section_record_uploads',
  '20261016090000_case_record_material_guard_repair',
  '20261016093000_case_record_material_reference_reuse',
  '20261016100000_case_execution_filing_followups',
];
const frozen = [
  '10760cf6e9969822a6b6a631760645625d227c4541a018560473e34c164953c7',
  '883f2f80b615a0f746adb2ebbb6e17cc24d0ac577a61d236f3bb6375fbc0367d',
  'dfe31436055f7ab9bf8d0796c48b3a0dd38a16acf4e5b3554e04e3d299b7b869',
  '628a0fc0a664942896fdd85e3811bfe977702e4924ef33a58f83399a9bf8280e',
  'e125a3278b0530860b1be49273fc667224451f8a6d35b420bdf14e2b9c684105',
];
const additions = [
  ['permission_action', 'case.execution.feedback.record'],
  ['permission_action', 'case.execution.feedback.correct'],
  ['permission_action', 'case.execution.supplement.submit'],
  ['permission_action', 'case.execution.supplement.correct'],
  ['material_category', 'EXECUTION_SUPPLEMENT'],
];
const newTables = [
  'case_execution_filing_feedbacks',
  'case_execution_filing_supplements',
  'case_execution_filing_supplement_documents',
  'case_execution_filing_followup_receipts',
];
const newColumns = [
  ['upload_drafts', 'execution_supplement_filing_id'],
  ['upload_drafts', 'execution_supplement_revision'],
  ['upload_drafts', 'execution_supplement_target_id'],
  ['content_versions', 'execution_supplement_upload_draft_id'],
];
const classifier = 'classify_case_record_material_reference';
const oldClassifierMd5 = 'bf5e9e373c2414498831a34ab5f7f034';
const marker = 'owned_ef160_migration_failure';
const quote = (value) => `"${value.replaceAll('"', '""')}"`;
const hash = (value) =>
  createHash('sha256')
    .update(
      typeof value === 'string' || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest('hex');

// Pure admission precedes test-environment capture, pg loading and any socket.
export function admitExecutionFilingFollowupMigration(env) {
  assert.equal(env.NODE_ENV, 'test');
  assert.equal(env.DEV_COR_TEST_DATABASE_PROJECT, 'dev-cor-ui003-r2');
  assert.equal(
    env.DEV_COR_TEST_DATABASE_CONTAINER_ID,
    '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
  );
  assert.ok(
    env.DATABASE_URL && env.DATABASE_URL === env.DEV_COR_TEST_DATABASE_URL,
  );
  const raw = env.DATABASE_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Malformed explicit R2 test URL');
  }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '15438');
  assert.equal(url.pathname, '/dev_cor_test');
  assert.equal(decodeURIComponent(url.username), 'dev_cor_test');
  assert.ok(url.password);
  assert.ok(!raw.includes('?') && !raw.includes('#'));
  assert.equal(url.href, raw);
  const pnpmVersion = env.npm_config_user_agent?.match(/^pnpm\/([^\s]+)/u)?.[1];
  assert.equal(
    pnpmVersion,
    '11.27.0',
    'Use the protected pnpm test:e2e resource lock',
  );
  return { connectionString: raw, pnpmVersion };
}

export async function executionFilingFollowupMigrationPlan(
  directory = resolve(root, 'backend/prisma/migrations'),
) {
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  assert.equal(names.length, 160);
  assert.deepEqual(names.slice(-6), suffix);
  const entries = [];
  for (const name of names) {
    const bytes = await readFile(resolve(directory, name, 'migration.sql'));
    const sql = bytes.toString('utf8');
    assertMigrationIsolation(sql);
    entries.push({ name, sha256: hash(bytes), sql });
  }
  assert.deepEqual(
    entries.slice(155).map(({ sha256 }) => sha256),
    frozen,
  );
  executionFilingFollowup160Prelude(entries[159].sql);
  return entries;
}

export function executionFilingFollowup160Prelude(sql) {
  const begin = sql.indexOf('\nBEGIN;');
  assert.ok(begin > 0);
  const prefix = sql.slice(0, begin);
  const statements = prefix
    .replace(/--[^\n]*/gu, '')
    .trim()
    .split(';')
    .filter((part) => part.trim());
  assert.deepEqual(
    statements.map((part) => part.trim()),
    additions.map(
      ([type, value]) =>
        `ALTER TYPE "${type}" ADD VALUE IF NOT EXISTS '${value}'`,
    ),
  );
  const transaction = sql.slice(begin);
  assert.match(transaction, /^\nBEGIN;/u);
  assert.match(transaction, /COMMIT;\s*$/u);
  assert.equal(prefix + transaction, sql);
  return { prefix, transaction };
}

export function ownedExecutionFilingFollowupSchema(nonce, kind) {
  assert.match(nonce, /^[a-f0-9]{32}$/u);
  assert.ok(['empty', 'upgrade'].includes(kind));
  return `ef160_${nonce}_${kind}`;
}

export function assertOwnedExecutionFilingFollowupSchema(
  name,
  nonce,
  created,
  actual,
  expected,
) {
  assert.ok(
    ['empty', 'upgrade'].some(
      (kind) => ownedExecutionFilingFollowupSchema(nonce, kind) === name,
    ),
  );
  assert.ok(created.has(name), 'Never adopt a preexisting schema');
  assert.equal(actual, expected, 'Owned schema marker changed');
}

export function injectExecutionFilingFollowupFailure(transaction) {
  assert.match(transaction, /^\nBEGIN;/u);
  assert.match(transaction, /COMMIT;\s*$/u);
  return transaction.replace(
    /COMMIT;\s*$/u,
    `DO $probe$ BEGIN RAISE EXCEPTION '${marker}'; END $probe$;\nCOMMIT;`,
  );
}

export function assertExecutionFilingFollowupFailure(error) {
  assert.equal(error?.code, 'P0001');
  assert.equal(error?.message, marker);
}

export function classifyExecutionFilingFollowupEnumStaging(before, after) {
  const original = new Map(
    before.map((row) => [`${row.type}:${row.label}`, row]),
  );
  const current = new Map(
    after.map((row) => [`${row.type}:${row.label}`, row]),
  );
  for (const [key, row] of original) assert.deepEqual(current.get(key), row);
  const staged = after.filter(
    (row) => !original.has(`${row.type}:${row.label}`),
  );
  assert.deepEqual(
    new Set(staged.map(({ type, label }) => `${type}:${label}`)),
    new Set(additions.map(([type, label]) => `${type}:${label}`)),
  );
  assert.equal(staged.length, additions.length);
  return staged.map(({ type, label }) => ({ type, label }));
}

export function expectedExecutionFilingFollowupClassifier(oldBody, sql) {
  assert.equal(
    createHash('md5').update(oldBody).digest('hex'),
    oldClassifierMd5,
  );
  const proofNeedle = '  IF event_action IN (\n';
  const fallbackNeedle = "          'case.closure.record-corrected'\n";
  const match = sql.match(/proof_branch:=\$proof\$([\s\S]*?)\$proof\$;/u);
  assert.ok(match);
  for (const needle of [proofNeedle, fallbackNeedle])
    assert.equal(oldBody.split(needle).length, 2);
  const branch = match[1].replace(/^\n/u, '');
  assert.match(branch, /case\.execution\.supplement\.submitted/u);
  return oldBody
    .replace(proofNeedle, branch)
    .replace(
      fallbackNeedle,
      "          'case.closure.record-corrected',\n          'case.execution.supplement.submitted',\n          'case.execution.supplement.corrected'\n",
    );
}

export function assertExecutionFilingFollowupLedger(identity, applied, plan) {
  assert.deepEqual(identity, [
    { db: 'dev_cor_test', schema: 'public', username: 'dev_cor_test' },
  ]);
  assert.equal(plan.length, 160);
  assert.equal(
    applied.length,
    159,
    'Public must remain at exact predecessor159',
  );
  for (const [index, row] of applied.entries()) {
    assert.equal(row.migration_name, plan[index].name);
    assert.equal(row.checksum, plan[index].sha256);
    assert.ok(row.finished_at);
    assert.equal(row.rolled_back_at, null);
  }
}

async function enums(client, schema) {
  return (
    await client.query(
      'SELECT t.typname AS type,e.enumlabel AS label,e.enumsortorder::text AS position FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 ORDER BY t.typname,e.enumsortorder',
      [schema],
    )
  ).rows;
}

async function columns(client, schema) {
  return (
    await client.query(
      'SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 ORDER BY table_name,ordinal_position',
      [schema],
    )
  ).rows.reduce((map, row) => {
    (map[row.table_name] ??= []).push(row.column_name);
    return map;
  }, Object.create(null));
}

async function data(client, schema, projection) {
  const summaries = [];
  for (const [table, names] of Object.entries(projection)) {
    const selected = names.map(quote).join(',');
    const rows = (
      await client.query(
        `SELECT to_jsonb(r)::text AS row FROM (SELECT ${selected} FROM ${quote(schema)}.${quote(table)}) r ORDER BY to_jsonb(r)::text`,
      )
    ).rows;
    summaries.push({ table, count: rows.length, sha256: hash(rows) });
  }
  return summaries;
}

async function snapshot(client, schema) {
  const structureQueries = [
    "SELECT n.nspname,n.nspowner::text,n.nspacl::text,obj_description(n.oid,'pg_namespace') AS comment FROM pg_namespace n WHERE n.nspname=$1",
    'SELECT c.relname,c.relkind,c.relowner::text,c.relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname',
    'SELECT c.relname,a.attname,a.atttypid::regtype::text AS type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum',
    'SELECT c.relname,k.conname,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname,k.conname',
    'SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition,p.proowner::text,p.proacl::text,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 ORDER BY p.proname,arguments',
    'SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY c.relname,t.tgname',
    'SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=$1 ORDER BY indexname',
    'SELECT typname,typtype FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 ORDER BY typname',
    'SELECT schemaname,sequencename,sequenceowner,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value FROM pg_sequences WHERE schemaname=$1 ORDER BY sequencename',
    'SELECT migration_name,checksum,finished_at::text,rolled_back_at::text FROM public._prisma_migrations ORDER BY migration_name',
  ];
  const structure = [];
  for (const sql of structureQueries)
    structure.push(
      (
        await client.query(
          sql,
          sql.includes('public._prisma_migrations') ? [] : [schema],
        )
      ).rows,
    );
  const projection = await columns(client, schema);
  return {
    structure: hash(structure),
    enums: await enums(client, schema),
    data: await data(client, schema, projection),
    projection,
  };
}

async function classifierRow(client, schema) {
  const rows = (
    await client.query(
      'SELECT p.oid::text,p.proowner::text,p.proacl::text,p.proconfig,p.prosrc,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname=$2 AND p.pronargs=0',
      [schema, classifier],
    )
  ).rows;
  assert.equal(rows.length, 1);
  return rows[0];
}

async function seed159(client, nonce) {
  // Minimal legal owned ACL + DRAFT customer + material metadata; bytes never leave memory.
  const [
    department,
    user,
    membership,
    role,
    grant,
    assignment,
    customer,
    material,
    version,
  ] = Array.from({ length: 9 }, () => randomUUID());
  const bytes = Buffer.from(`%PDF-1.4\nowned EF160 ${nonce}\n%%EOF\n`);
  await client.query('BEGIN');
  try {
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES($1,$2,now())',
      [department, `ef160-${nonce}`],
    );
    await client.query(
      "INSERT INTO user_accounts(id,external_subject,display_name,active,account_type,updated_at) VALUES($1,$2,'Migration Owner',true,'INTERNAL',now())",
      [user, `ef160:${nonce}`],
    );
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES($1,$2,$3,now())',
      [membership, user, department],
    );
    await client.query(
      'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES($1,$2,$3,now())',
      [role, department, `ef160:${nonce}`],
    );
    await client.query(
      "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES($1,$2,'case.read','DEPARTMENT')",
      [grant, role],
    );
    await client.query(
      'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,updated_at) VALUES($1,$2,$3,$4,now())',
      [assignment, user, department, role],
    );
    await client.query(
      "INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,profile_status,updated_at) VALUES($1,'Migration Customer','Migration Customer',$2,$3,'DRAFT',now())",
      [customer, department, user],
    );
    await client.query(
      "INSERT INTO materials(id,department_id,owner_type,owner_id,category,purpose,updated_at) VALUES($1,$2,'CUSTOMER',$3,'CUSTOMER_IDENTITY','IDENTITY_FULL',now())",
      [material, department, customer],
    );
    await client.query(
      "INSERT INTO content_versions(id,material_id,storage_key,original_filename,mime_type,size_bytes,sha256,uploaded_by) VALUES($1,$2,$3,'synthetic.pdf','application/pdf',$4,$5,$6)",
      [
        version,
        material,
        `ef160-owned/${nonce}`,
        bytes.length,
        hash(bytes),
        user,
      ],
    );
    await client.query(
      'UPDATE materials SET current_version_id=$1,updated_at=now() WHERE id=$2',
      [version, material],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  return { id: version, size: bytes.length, sha256: hash(bytes) };
}

async function assertFixtureMetadata(client, fixture) {
  const row = (
    await client.query(
      'SELECT size_bytes::text AS size,sha256 FROM content_versions WHERE id=$1',
      [fixture.id],
    )
  ).rows[0];
  assert.deepEqual(row, { size: String(fixture.size), sha256: fixture.sha256 });
}

async function assert160Shape(client, schema, expected) {
  const current = await columns(client, schema);
  for (const table of newTables)
    assert.equal(Object.hasOwn(current, table), expected);
  for (const [table, column] of newColumns)
    assert.equal(current[table]?.includes(column), expected);
}

/** Runner only. Use the protected pnpm E2E entry with a DB-only Playwright config. */
export async function verifyCaseExecutionFilingFollowupMigration(
  report = () => {},
) {
  const admission = admitExecutionFilingFollowupMigration(process.env);
  const plan = await executionFilingFollowupMigrationPlan();
  const captured = captureTestEnvironment(root, {
    pnpmVersion: admission.pnpmVersion,
  });
  const target = validateBrowserTestDatabaseUrl(
    admission.connectionString,
    root,
  );
  assert.equal(target.connectionString, admission.connectionString);
  assert.equal(
    captured.childEnvironment.DATABASE_URL,
    admission.connectionString,
  );
  const { Client } = createRequire(resolve(root, 'backend/package.json'))('pg');
  const client = new Client({ connectionString: admission.connectionString });
  const nonce = randomUUID().replaceAll('-', '');
  const created = new Set();
  const comment = `ef160-owned:${nonce}`;
  const result = {
    fingerprint: captured.fingerprint,
    source: plan.map(({ name, sha256 }) => ({ name, sha256 })),
    checks: [],
    enumStaging: [],
    fixture:
      'Minimal ACL, DRAFT customer and material metadata from in-memory bytes; excludes Case histories and stored blobs',
    publicUnchanged: false,
    cleanedSchemas: 0,
    publicDigests: {},
  };
  let publicBefore;
  let failure;
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const identity = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema,current_user AS username',
      )
    ).rows;
    const applied = (
      await client.query(
        'SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name',
      )
    ).rows;
    assertExecutionFilingFollowupLedger(identity, applied, plan);
    await client.query("SET statement_timeout='120s'; SET lock_timeout='5s'");
    await client.query('SET search_path TO pg_catalog');
    publicBefore = await snapshot(client, 'public');
    result.publicDigests.before = hash(publicBefore);
    const verifyOwned = async (name) => {
      const rows = (
        await client.query(
          "SELECT obj_description(oid,'pg_namespace') AS comment FROM pg_namespace WHERE nspname=$1",
          [name],
        )
      ).rows;
      assert.equal(rows.length, 1);
      assertOwnedExecutionFilingFollowupSchema(
        name,
        nonce,
        created,
        rows[0].comment,
        comment,
      );
    };
    const selectOwned = async (name) => {
      await verifyOwned(name);
      await client.query(`SET search_path TO ${quote(name)}, pg_catalog`);
      assert.equal(
        (await client.query('SELECT current_schema() AS schema')).rows[0]
          .schema,
        name,
      );
    };
    const createOwned = async (kind) => {
      const name = ownedExecutionFilingFollowupSchema(nonce, kind);
      await client.query(`CREATE SCHEMA ${quote(name)}`);
      created.add(name);
      await client.query(`COMMENT ON SCHEMA ${quote(name)} IS '${comment}'`);
      await selectOwned(name);
      return name;
    };
    const replay = async (entries) => {
      for (const entry of entries) {
        if (entry.name === suffix[1]) {
          const { prelude, transaction } = section156Prelude(entry.sql);
          assert.equal(prelude + transaction, entry.sql);
          await client.query(prelude);
          await client.query(transaction);
        } else if (entry.name === suffix[5]) {
          const { prefix, transaction } = executionFilingFollowup160Prelude(
            entry.sql,
          );
          await client.query(prefix);
          await client.query(transaction);
        } else {
          await client.query(entry.sql);
        }
      }
    };
    const empty = await createOwned('empty');
    await replay(plan);
    await assert160Shape(client, empty, true);
    result.checks.push('empty-original-chain160');

    const upgrade = await createOwned('upgrade');
    await replay(plan.slice(0, 159));
    await assert160Shape(client, upgrade, false);
    const fixture = await seed159(client, nonce);
    await assertFixtureMetadata(client, fixture);
    const before = await snapshot(client, upgrade);
    const oldFunction = await classifierRow(client, upgrade);
    assert.equal(
      createHash('md5').update(oldFunction.prosrc).digest('hex'),
      oldClassifierMd5,
    );
    const { prefix, transaction } = executionFilingFollowup160Prelude(
      plan[159].sql,
    );
    await client.query(prefix);
    let caught;
    try {
      await client.query(injectExecutionFilingFollowupFailure(transaction));
    } catch (error) {
      caught = error;
    }
    await client.query('ROLLBACK');
    assertExecutionFilingFollowupFailure(caught);
    const afterFailure = await snapshot(client, upgrade);
    assert.equal(afterFailure.structure, before.structure);
    assert.deepEqual(afterFailure.data, before.data);
    await assert160Shape(client, upgrade, false);
    assert.deepEqual(await classifierRow(client, upgrade), oldFunction);
    result.enumStaging = classifyExecutionFilingFollowupEnumStaging(
      before.enums,
      afterFailure.enums,
    );
    result.checks.push(
      '160-controlled-failure-atomic-ddl-and-original-byte-retry',
    );

    await replay([plan[159]]);
    await assert160Shape(client, upgrade, true);
    const updated = await classifierRow(client, upgrade);
    assert.deepEqual(
      [updated.oid, updated.proowner, updated.proacl, updated.proconfig],
      [
        oldFunction.oid,
        oldFunction.proowner,
        oldFunction.proacl,
        oldFunction.proconfig,
      ],
    );
    assert.equal(
      updated.prosrc,
      expectedExecutionFilingFollowupClassifier(
        oldFunction.prosrc,
        plan[159].sql,
      ),
    );
    assert.deepEqual(
      await data(client, upgrade, before.projection),
      before.data,
    );
    await assertFixtureMetadata(client, fixture);
    result.memoryFile = { size: fixture.size, sha256: fixture.sha256 };
    result.checks.push(
      '159-classifier-exact-body-and-oid-owner-acl-config',
      '159-data-acl-and-file-metadata-preserved',
    );
    for (const name of created) {
      const leaks = (
        await client.query(
          "SELECT count(*)::int AS count FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class target ON target.oid=k.confrelid JOIN pg_namespace target_n ON target_n.oid=target.relnamespace WHERE n.nspname=$1 AND k.contype='f' AND target_n.nspname<>$1",
          [name],
        )
      ).rows[0].count;
      assert.equal(leaks, 0);
    }
    result.checks.push('owned-foreign-keys');

    await client.query('SET search_path TO pg_catalog');
    const beforeCleanup = await snapshot(client, 'public');
    result.publicDigests.beforeCleanup = hash(beforeCleanup);
    assert.deepEqual(
      beforeCleanup,
      publicBefore,
      'Public changed before cleanup; retain owned schemas',
    );
    for (const name of created) {
      await verifyOwned(name);
      const inbound = (
        await client.query(
          "SELECT count(*)::int AS count FROM pg_depend d CROSS JOIN LATERAL pg_identify_object(d.classid,d.objid,d.objsubid) obj CROSS JOIN LATERAL pg_identify_object(d.refclassid,d.refobjid,d.refobjsubid) ref WHERE d.deptype='n' AND ref.schema=$1 AND obj.schema IS NOT NULL AND obj.schema<>$1",
          [name],
        )
      ).rows[0].count;
      assert.equal(inbound, 0, 'Cross-schema dependency; retain owned schemas');
    }
    await client.query('BEGIN');
    try {
      for (const name of created)
        await client.query(`DROP SCHEMA ${quote(name)} CASCADE`);
      await client.query('COMMIT');
      result.cleanedSchemas = created.size;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    const afterCleanup = await snapshot(client, 'public');
    result.publicDigests.after = hash(afterCleanup);
    assert.deepEqual(
      afterCleanup,
      publicBefore,
      'Public changed after cleanup',
    );
    result.publicUnchanged = true;
    await report(result);
  } catch (error) {
    failure = error;
    if (connected && publicBefore) {
      try {
        await client.query('ROLLBACK');
        await client.query('SET search_path TO pg_catalog');
        const current = await snapshot(client, 'public');
        result.publicDigests.after = hash(current);
        assert.deepEqual(
          current,
          publicBefore,
          'Public changed on failed probe',
        );
        result.publicUnchanged = true;
        await report(result);
      } catch (preservationError) {
        failure = new AggregateError(
          [error, preservationError],
          'Failed EF160 probe could not prove public preservation',
        );
      }
    }
  } finally {
    if (connected) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* original failure remains */
      }
      try {
        await client.end();
      } catch (error) {
        failure ??= error;
      }
    }
  }
  if (failure)
    throw new Error(
      'EF160 owned migration probe failed; owned schemas retained when cleanup was not reached',
      { cause: failure },
    );
  assert.equal(result.cleanedSchemas, 2);
  return result;
}
