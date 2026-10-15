import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  captureTestEnvironment,
  validateBrowserTestDatabaseUrl,
} from '../../scripts/test-environment.mjs';

const root = process.cwd();
const suffix = [
  '20261015130000_guard_direct_second_remand_child',
  '20261015150000_case_section_record_edits',
  '20261015170000_case_section_record_uploads',
];
const hashes = [
  '10760cf6e9969822a6b6a631760645625d227c4541a018560473e34c164953c7',
  // Unpublished157 groups the SQL CASE inside its PLpgSQL IF condition.
  // Hash raw LF bytes; never normalize a runtime migration to make it pass.
  '883f2f80b615a0f746adb2ebbb6e17cc24d0ac577a61d236f3bb6375fbc0367d',
];
const functionNames = [
  'check_case_hearing_fact',
  'check_case_acceptance_correction_final',
  'check_case_second_acceptance_dates',
  'check_case_second_acceptance_dependent_date',
];
const enumLabels = [
  'case.execution.mailing.correct',
  'case.execution.filing.correct',
  'case.execution.finish.correct',
];
const marker = 'owned_section_migration_failure';
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const digest = (value) =>
  createHash('sha256')
    .update(
      typeof value === 'string' || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest('hex');

// This module is inert on import. Admission precedes capture, pg import and connection.
export function admitSectionMigration(environment) {
  assert.equal(environment.NODE_ENV, 'test');
  assert.equal(environment.DEV_COR_TEST_DATABASE_PROJECT, 'dev-cor-ui003-r2');
  assert.equal(
    environment.DEV_COR_TEST_DATABASE_CONTAINER_ID,
    '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
  );
  const urls = [
    environment.DATABASE_URL,
    environment.DEV_COR_TEST_DATABASE_URL,
  ];
  for (const value of urls) {
    assert.ok(value, 'Both explicit database URLs are required');
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error('Malformed explicit test database URL');
    }
    assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '15438');
    assert.equal(url.pathname, '/dev_cor_test');
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
    assert.ok(
      url.username && url.password,
      'Explicit test credentials required',
    );
    assert.equal(value.includes('?') || value.includes('#'), false);
  }
  assert.ok(urls[0] === urls[1], 'Both database URLs must match exactly');
  const pnpmVersion = (environment.npm_config_user_agent ?? '').match(
    /\bpnpm\/([^\s]+)/u,
  )?.[1];
  assert.ok(
    pnpmVersion,
    'Use pnpm test:e2e and its existing exclusive resource lock',
  );
  return { connectionString: urls[0], pnpmVersion };
}

export function assertMigrationIsolation(sql) {
  // Conservative source screen, followed by actual catalog/data snapshots at runtime.
  // Comments are screened too: a future source change requires deliberate review.
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
    /\b(?:CREATE(?:\s+OR\s+REPLACE)?\s+(?:TABLE|TYPE|FUNCTION|VIEW|SEQUENCE)|ALTER\s+(?:TABLE|TYPE|FUNCTION|SEQUENCE)|DROP\s+(?:TABLE|TYPE|FUNCTION|VIEW|SEQUENCE)|INSERT\s+INTO|UPDATE|DELETE\s+FROM|REFERENCES|TRUNCATE(?:\s+TABLE)?)\s+"?[a-z_][\w]*"?\s*\./iu,
  );
}

export async function sectionMigrationPlan(
  directory = resolve(root, 'backend/prisma/migrations'),
) {
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  assert.equal(names.length, 157);
  assert.deepEqual(names.slice(-3), suffix);
  const plan = [];
  for (const name of names) {
    const bytes = await readFile(resolve(directory, name, 'migration.sql'));
    const sql = bytes.toString('utf8');
    assertMigrationIsolation(sql);
    plan.push({ name, sql, sha256: digest(bytes) });
  }
  assert.deepEqual(
    plan.slice(-2).map((entry) => entry.sha256),
    hashes,
  );
  return plan;
}

export function ownedSectionSchema(nonce, kind) {
  assert.match(nonce, /^[a-f0-9]{32}$/u);
  assert.ok(['empty', 'upgrade'].includes(kind));
  return `s156157_${nonce}_${kind}`;
}

export function assertOwnedSectionSchema(
  name,
  nonce,
  created,
  actualComment,
  expectedComment,
) {
  assert.ok(
    ['empty', 'upgrade'].some(
      (kind) => ownedSectionSchema(nonce, kind) === name,
    ),
  );
  assert.ok(created.has(name), 'Never adopt or drop a preexisting schema');
  assert.equal(
    actualComment,
    expectedComment,
    'Schema ownership marker changed',
  );
}

export function injectSectionMigrationFailure(sql) {
  assert.match(sql, /\bBEGIN;/u);
  assert.match(sql, /\bCOMMIT;\s*$/u);
  return sql.replace(
    /COMMIT;\s*$/u,
    `DO $probe$ BEGIN RAISE EXCEPTION '${marker}'; END $probe$;\nCOMMIT;`,
  );
}

export function assertSectionMigrationFailure(error) {
  assert.equal(error?.code, 'P0001');
  assert.equal(error?.message, marker);
}

export function section156Prelude(sql) {
  const begin = sql.indexOf('\nBEGIN;');
  assert.ok(begin > 0);
  const prelude = sql.slice(0, begin);
  const statements = prelude
    .replace(/--[^\n]*/gu, '')
    .trim()
    .split(';')
    .filter((part) => part.trim());
  assert.deepEqual(
    statements.map((part) => part.trim()),
    enumLabels.map(
      (label) =>
        `ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS '${label}'`,
    ),
  );
  return { prelude, transaction: sql.slice(begin) };
}

export function sectionCompatibilityReplacements(sql) {
  const blocks = [...sql.matchAll(/DO \$compat\$([\s\S]*?)\$compat\$;/gu)];
  assert.equal(blocks.length, 4);
  return blocks.map(([whole, body], index) => {
    assert.ok(body.includes(`p."proname"='${functionNames[index]}'`));
    const replacements = [
      ...whole.matchAll(
        /definition:=replace\(definition,\$old\$([\s\S]*?)\$old\$,\$new\$([\s\S]*?)\$new\$\);/gu,
      ),
    ].map((match) => ({ before: match[1], after: match[2] }));
    assert.equal(replacements.length, [2, 6, 5, 1][index]);
    return { name: functionNames[index], replacements };
  });
}

export function applySectionCompatibility(definition, replacements) {
  let expected = definition;
  for (const { before, after } of replacements) {
    assert.ok(
      expected.includes(before),
      'Missing frozen predecessor function input',
    );
    expected = expected.replaceAll(before, after);
  }
  return expected;
}

export function classifySectionEnumStaging(before, after, allow156) {
  const old = new Map(before.map((row) => [`${row.type}:${row.label}`, row]));
  const current = new Map(
    after.map((row) => [`${row.type}:${row.label}`, row]),
  );
  for (const [key, row] of old) assert.deepEqual(current.get(key), row);
  const additions = after.filter((row) => !old.has(`${row.type}:${row.label}`));
  for (const row of additions) {
    assert.ok(
      allow156 &&
        row.type === 'permission_action' &&
        enumLabels.includes(row.label),
    );
  }
  return additions.map((row) => row.label);
}

async function enums(client, schema) {
  return (
    await client.query(
      'SELECT t.typname AS type,e.enumlabel AS label,e.enumsortorder::text AS position FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 ORDER BY t.typname,e.enumsortorder',
      [schema],
    )
  ).rows;
}

async function structure(client, schema) {
  // Excludes enum labels deliberately: 156 stages three append-only values before BEGIN.
  const queries = [
    'SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname',
    'SELECT c.relname,a.attname,a.atttypid::regtype::text AS type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum',
    'SELECT c.relname,k.conname,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname,k.conname',
    'SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 ORDER BY p.proname,arguments',
    'SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY c.relname,t.tgname',
    'SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=$1 ORDER BY indexname',
    'SELECT typname,typtype FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 ORDER BY typname',
  ];
  const rows = [];
  for (const sql of queries)
    rows.push((await client.query(sql, [schema])).rows);
  return digest(rows);
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
    summaries.push({ table, count: rows.length, sha256: digest(rows) });
  }
  return summaries;
}

async function snapshot(client, schema) {
  const projection = await columns(client, schema);
  return {
    structure: await structure(client, schema),
    enums: await enums(client, schema),
    data: await data(client, schema, projection),
  };
}

async function functions(client, schema) {
  const rows = (
    await client.query(
      'SELECT p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname=ANY($2::text[]) ORDER BY p.proname',
      [schema, functionNames],
    )
  ).rows;
  assert.equal(rows.length, 4);
  return new Map(rows.map((row) => [row.proname, row.definition]));
}

async function seed(client, nonce) {
  // Legal DRAFT preparation only; no fabricated admission, Case, audit or frozen ref.
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
  const bytes = Buffer.from(`%PDF-1.4\nowned migration ${nonce}\n%%EOF\n`);
  await client.query('BEGIN');
  try {
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES($1,$2,now())',
      [department, `migration-${nonce}`],
    );
    await client.query(
      "INSERT INTO user_accounts(id,external_subject,display_name,active,account_type,updated_at) VALUES($1,$2,'Migration Owner',true,'INTERNAL',now())",
      [user, `migration:${nonce}`],
    );
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES($1,$2,$3,now())',
      [membership, user, department],
    );
    await client.query(
      'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES($1,$2,$3,now())',
      [role, department, `migration:${nonce}`],
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
        `migration-owned/${nonce}`,
        bytes.length,
        digest(bytes),
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
  const metadata = async () => {
    const row = (
      await client.query(
        'SELECT size_bytes::text AS size,sha256 FROM content_versions WHERE id=$1',
        [version],
      )
    ).rows[0];
    assert.deepEqual(row, {
      size: String(bytes.length),
      sha256: digest(bytes),
    });
    return { size: bytes.length, sha256: digest(bytes) };
  };
  await metadata();
  return metadata;
}

/** Runner only: use the protected pnpm test:e2e entry, with a DB-only config.
 * No nested lock acquisition: scripts/run-e2e.mjs holds the standard resource lock.
 * Does not migrate public or create public fixtures. Synthetic bytes stay in memory.
 */
export async function verifyCaseSectionRecordMigration(report = () => {}) {
  const admitted = admitSectionMigration(process.env);
  const plan = await sectionMigrationPlan();
  const captured = captureTestEnvironment(root, {
    pnpmVersion: admitted.pnpmVersion,
  });
  const validated = validateBrowserTestDatabaseUrl(
    admitted.connectionString,
    root,
  );
  assert.ok(validated.connectionString === admitted.connectionString);
  assert.ok(
    captured.childEnvironment.DATABASE_URL === admitted.connectionString,
  );
  const backend = createRequire(resolve(root, 'backend/package.json'));
  const { Client } = backend('pg');
  const client = new Client({ connectionString: admitted.connectionString });
  const nonce = randomUUID().replaceAll('-', '');
  const created = new Set();
  const comment = `s156157-owned:${nonce}`;
  const result = {
    fingerprint: captured.fingerprint,
    source: plan.map(({ name, sha256 }) => ({ name, sha256 })),
    checks: [],
    enumStaging: [],
    fixture:
      'ACL + DRAFT customer + file metadata and memory bytes; excludes Case histories and stored blobs',
    reusedSuites: [
      'case-execution-record-edit.spec.ts',
      'case-historical-record-edit.spec.ts',
      'case-section-record-upload.spec.ts',
      'hearing-effective-date-bridge.spec.ts',
    ],
    publicUnchanged: false,
    cleanedSchemas: 0,
    publicDigests: {},
  };
  let publicBefore;
  let failure;
  const errors = [];
  await client.connect();
  const verifyOwned = async (name) => {
    const actual = (
      await client.query(
        "SELECT obj_description(oid,'pg_namespace') AS comment FROM pg_namespace WHERE nspname=$1",
        [name],
      )
    ).rows;
    assert.equal(actual.length, 1);
    assertOwnedSectionSchema(name, nonce, created, actual[0].comment, comment);
  };
  const selectOwned = async (name) => {
    await verifyOwned(name);
    await client.query(`SET search_path TO ${quote(name)}, pg_catalog`);
    assert.equal(
      (await client.query('SELECT current_schema() AS schema')).rows[0].schema,
      name,
    );
  };
  const createOwned = async (kind) => {
    const name = ownedSectionSchema(nonce, kind);
    await client.query(`CREATE SCHEMA ${quote(name)}`);
    created.add(name);
    await client.query(`COMMENT ON SCHEMA ${quote(name)} IS '${comment}'`);
    await selectOwned(name);
    return name;
  };
  const replay = async (entries) => {
    for (const entry of entries) {
      try {
        if (entry.name === suffix[1]) {
          // Preserve every original byte, but make the source's staging boundary
          // explicit in protocol messages; a single simple-query message would
          // absorb pre-BEGIN statements into the later transaction.
          const split = section156Prelude(entry.sql);
          assert.equal(split.prelude + split.transaction, entry.sql);
          await client.query(split.prelude);
          await client.query(split.transaction);
        } else {
          await client.query(entry.sql);
        }
      } catch {
        throw new Error(`Owned schema replay failed: ${entry.name}`);
      }
    }
  };
  try {
    assert.deepEqual(
      (
        await client.query(
          'SELECT current_database() AS db,current_schema() AS schema',
        )
      ).rows[0],
      { db: 'dev_cor_test', schema: 'public' },
    );
    await client.query("SET statement_timeout='120s'; SET lock_timeout='5s'");
    const ledger = (
      await client.query(
        'SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name',
      )
    ).rows;
    assert.equal(
      ledger.length,
      155,
      'R2 must remain at exact public predecessor155',
    );
    for (const [index, row] of ledger.entries()) {
      assert.equal(row.migration_name, plan[index].name);
      assert.equal(row.checksum, plan[index].sha256);
      assert.ok(row.finished_at);
      assert.equal(row.rolled_back_at, null);
    }
    await client.query('SET search_path TO pg_catalog');
    publicBefore = await snapshot(client, 'public');
    result.publicDigests.before = digest(publicBefore);
    const empty = await createOwned('empty');
    await replay(plan);
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema=$1 AND table_name='content_versions' AND column_name='case_section_record_upload_draft_id'",
          [empty],
        )
      ).rows[0].count,
      1,
    );
    result.checks.push('empty-original-chain157');
    const upgrade = await createOwned('upgrade');
    await replay(plan.slice(0, 155));
    const checkBytes = await seed(client, nonce);
    const oldColumns = await columns(client, upgrade);
    const oldData = await data(client, upgrade, oldColumns);
    const oldFunctions = await functions(client, upgrade);
    for (const [index, entry] of plan.slice(-2).entries()) {
      const before = await snapshot(client, upgrade);
      let transactionalSql = entry.sql;
      if (index === 0) {
        // Explicitly exercise the nontransactional staging boundary as a separate
        // simple-query message. This is a SQL risk probe, not Prisma deploy evidence.
        const split = section156Prelude(entry.sql);
        await client.query(split.prelude);
        transactionalSql = split.transaction;
      }
      let caught;
      try {
        await client.query(injectSectionMigrationFailure(transactionalSql));
      } catch (error) {
        caught = error;
      }
      await client.query('ROLLBACK');
      assertSectionMigrationFailure(caught);
      const after = await snapshot(client, upgrade);
      assert.equal(
        after.structure,
        before.structure,
        'Failed transaction changed owned tables/functions/DDL',
      );
      assert.deepEqual(
        after.data,
        before.data,
        'Failed transaction changed owned data/ACL',
      );
      const labels = classifySectionEnumStaging(
        before.enums,
        after.enums,
        index === 0,
      );
      if (index === 0) assert.deepEqual(new Set(labels), new Set(enumLabels));
      result.enumStaging.push({
        migration: entry.name,
        labels,
        execution:
          index === 0
            ? 'original pre-BEGIN enum prefix committed separately, original transaction suffix with injected failure; not Prisma deploy evidence'
            : 'original SQL with failure inserted before final COMMIT',
      });
      // Retry every unchanged original byte, using the same explicit staging
      // boundary as empty replay. Never remove enum labels or edit migration SQL.
      await replay([entry]);
      assert.deepEqual(await data(client, upgrade, oldColumns), oldData);
      result.checks.push(
        `${index + 156}-controlled-failure-and-original-retry`,
      );
      if (index === 0) {
        const updated = await functions(client, upgrade);
        for (const { name, replacements } of sectionCompatibilityReplacements(
          entry.sql,
        )) {
          assert.equal(
            updated.get(name),
            applySectionCompatibility(oldFunctions.get(name), replacements),
            `Unexpected branch change in ${name}`,
          );
        }
        result.checks.push('four-functions-exact-literal-date-replacements');
      }
    }
    result.memoryFile = await checkBytes();
    // Every FK created while replaying must bind inside its owned schema.
    for (const name of created) {
      const leaks = (
        await client.query(
          "SELECT count(*)::int AS count FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class target ON target.oid=k.confrelid JOIN pg_namespace target_n ON target_n.oid=target.relnamespace WHERE n.nspname=$1 AND k.contype='f' AND target_n.nspname<>$1",
          [name],
        )
      ).rows[0].count;
      assert.equal(leaks, 0);
    }
    result.checks.push(
      'old155-projected-data-acl-file-metadata-preserved',
      'owned-foreign-keys',
    );
  } catch (error) {
    failure = error;
  } finally {
    try {
      await client.query('ROLLBACK');
    } catch {
      errors.push(new Error('Owned connection rollback failed'));
    }
    let publicSafe = false;
    try {
      await client.query('SET search_path TO pg_catalog');
      if (publicBefore) {
        const current = await snapshot(client, 'public');
        result.publicDigests.beforeCleanup = digest(current);
        assert.deepEqual(
          current,
          publicBefore,
          'Public changed before cleanup; retain owned schemas',
        );
        publicSafe = true;
      }
    } catch {
      errors.push(
        new Error(
          'Public changed before cleanup; retain owned schemas for runner inspection',
        ),
      );
    }
    for (const name of created) {
      try {
        assert.ok(
          publicSafe,
          'No destructive cleanup without unchanged public snapshot',
        );
        await verifyOwned(name);
        await client.query('SET search_path TO pg_catalog');
        // CASCADE must not reach a normal dependency in any other schema.
        const inbound = (
          await client.query(
            "SELECT count(*)::int AS count FROM pg_depend d CROSS JOIN LATERAL pg_identify_object(d.classid,d.objid,d.objsubid) obj CROSS JOIN LATERAL pg_identify_object(d.refclassid,d.refobjid,d.refobjsubid) ref WHERE d.deptype='n' AND ref.schema=$1 AND obj.schema IS NOT NULL AND obj.schema<>$1",
            [name],
          )
        ).rows[0].count;
        assert.equal(
          inbound,
          0,
          'Cross-schema dependent object; retain owned schema',
        );
        await client.query(`DROP SCHEMA ${quote(name)} CASCADE`);
        result.cleanedSchemas += 1;
      } catch {
        errors.push(
          new Error(
            `Owned schema cleanup failed: ${name}; retain for runner inspection`,
          ),
        );
      }
    }
    try {
      await client.query('SET search_path TO pg_catalog');
      if (publicBefore) {
        const publicAfter = await snapshot(client, 'public');
        result.publicDigests.after = digest(publicAfter);
        assert.deepEqual(
          publicAfter,
          publicBefore,
          'Public schema/data/ACL/ledger changed',
        );
        result.publicUnchanged = true;
      }
    } catch {
      errors.push(
        new Error(
          'Public before/after verification failed; stop runner progression',
        ),
      );
    }
    try {
      await client.end();
    } catch {
      errors.push(new Error('Owned connection close failed'));
    }
    await report(result);
  }
  if (failure || errors.length)
    throw new AggregateError(
      [...(failure ? [failure] : []), ...errors],
      'Section migration probe failed; inspect attached sanitized evidence',
    );
  assert.equal(result.cleanedSchemas, 2);
  return result;
}
