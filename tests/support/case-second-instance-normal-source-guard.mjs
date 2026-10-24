import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const root = process.cwd();
const directory = resolve(root, 'backend/prisma/migrations');
const latest = '20261025090000_case_second_instance_normal_source_guard';
const normalCaseId = '6207fe05-f6bb-47a9-a16e-9fd1c5abfc16';
const externalCaseId = '03d8967c-d550-4c47-a73a-186755049a7c';
const quote = (value) => `"${value.replaceAll('"', '""')}"`;

async function source() {
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  assert.equal(names.length, 177);
  assert.equal(names.at(-1), latest);
  return Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(resolve(directory, name, 'migration.sql'), 'utf8'),
    })),
  );
}

async function functionDefinition(client) {
  const rows = (
    await client.query(
      `SELECT pg_get_functiondef(p.oid) AS definition
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=current_schema()
          AND p.proname='check_case_second_instance_final' AND p.pronargs=0`,
    )
  ).rows;
  assert.equal(rows.length, 1);
  return rows[0].definition;
}

async function otherGuards(client) {
  return (
    await client.query(
      `SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS args,
              pg_get_functiondef(p.oid) AS definition
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=current_schema()
          AND p.proname <> 'check_case_second_instance_final'
        ORDER BY p.proname,args`,
    )
  ).rows;
}

async function triggerDefinitions(client) {
  return (
    await client.query(
      `SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition,
              t.tgenabled
         FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema() AND NOT t.tgisinternal
        ORDER BY c.relname,t.tgname`,
    )
  ).rows;
}

async function publicSnapshot(client) {
  await client.query('SET search_path TO pg_catalog');
  const totals = (
    await client.query(
      `SELECT (SELECT count(*)::int FROM public._prisma_migrations) AS migrations,
              (SELECT count(*)::int FROM public.cases) AS cases,
              (SELECT count(*)::int FROM public.case_second_instance_progresses) AS progresses,
              (SELECT count(*)::int FROM public.case_second_instance_receipts) AS receipts`,
    )
  ).rows[0];
  const ledger = (
    await client.query(
      `SELECT migration_name,finished_at IS NOT NULL AS finished,
              rolled_back_at IS NOT NULL AS rolled_back
         FROM public._prisma_migrations
        ORDER BY migration_name,started_at`,
    )
  ).rows;
  const cases = (
    await client.query(
      `SELECT id,business_no,stage::text,version,current_trial_round_id,
              current_judgment_next_step_id,current_second_instance_progress_id,
              current_second_instance_result_id
         FROM public.cases
        WHERE id IN ($1::uuid,$2::uuid)
        ORDER BY id`,
      [normalCaseId, externalCaseId],
    )
  ).rows;
  assert.equal(cases.length, 2);
  return { totals, ledger, cases };
}

function assertPublicLedger(snapshot, entries) {
  const { ledger, totals } = snapshot;
  assert.equal(ledger.length, totals.migrations);
  assert.ok(ledger.length === 176 || ledger.length === 177);
  assert.ok(ledger.every((row) => row.finished && !row.rolled_back));
  assert.deepEqual(
    ledger.map((row) => row.migration_name),
    entries.slice(0, ledger.length).map((entry) => entry.name),
  );
  const latestRows = ledger.filter((row) => row.migration_name === latest);
  if (ledger.length === 176) {
    assert.equal(latestRows.length, 0);
  } else {
    assert.equal(ledger.at(-1).migration_name, latest);
    assert.deepEqual(latestRows, [
      { migration_name: latest, finished: true, rolled_back: false },
    ]);
  }
}

async function publicProbeFacts(client) {
  const rows = (
    await client.query(
      `SELECT c.business_no,c.id AS case_id,c.department_id,
              actual.id AS choice_id,actual.trial_round_id,
              actual.external_entry_id AS choice_external_entry_id,
              judgment.external_entry_id AS judgment_external_entry_id,
              entry.id AS external_entry_id
         FROM public.cases c
         JOIN public.case_judgment_next_steps actual
           ON actual.case_id=c.id AND actual.department_id=c.department_id
         JOIN public.case_judgment_facts judgment
           ON judgment.id=actual.judgment_id AND judgment.case_id=c.id
           AND judgment.department_id=c.department_id
           AND judgment.trial_round_id=actual.trial_round_id
         LEFT JOIN public.case_external_entries entry
           ON entry.case_id=c.id AND entry.department_id=c.department_id
        WHERE c.id IN ($1::uuid,$2::uuid)
          AND actual.next='APPEAL'
          AND NOT EXISTS (
            SELECT 1 FROM public.case_judgment_next_step_revocations revocation
             WHERE revocation.choice_id=actual.id)
        ORDER BY c.id,actual.to_version DESC`,
      [normalCaseId, externalCaseId],
    )
  ).rows;
  const normal = rows.find(
    (row) => row.case_id === normalCaseId && !row.external_entry_id,
  );
  const external = rows.find(
    (row) =>
      row.case_id === externalCaseId &&
      row.external_entry_id &&
      row.choice_external_entry_id === row.external_entry_id &&
      row.judgment_external_entry_id === row.external_entry_id,
  );
  assert.ok(normal, 'Normal source must retain a real APPEAL choice');
  assert.equal(normal.choice_external_entry_id, null);
  assert.equal(normal.judgment_external_entry_id, null);
  assert.ok(
    external,
    'External source must retain a true-source APPEAL choice',
  );
  return { normal, external };
}

function sourceClause(definition, predecessor) {
  const message = 'external real appeal requires true source choice/judgment';
  const marker = definition.indexOf(message);
  assert.ok(marker > 0, 'Source guard exception is absent');
  assert.equal(definition.indexOf(message, marker + message.length), -1);
  const start = definition.lastIndexOf('IF ', marker);
  const end = definition.indexOf('END IF;', marker) + 'END IF;'.length;
  assert.ok(start >= 0 && end >= marker);
  const clause = definition.slice(start, end);
  assert.match(clause, /NEW\."choice_id"/u);
  assert.match(clause, /NEW\."trial_round_id"/u);
  assert.match(clause, /NEW\."case_id"/u);
  assert.match(clause, /NEW\."department_id"/u);
  if (!predecessor) {
    assert.match(clause, /target_case/u);
    assert.match(clause, /target_department/u);
  }
  assert.doesNotMatch(clause, /\$source_probe\$/u);
  assert.equal((clause.match(/RAISE EXCEPTION/gu) ?? []).length, 1);
  return clause;
}

function uuid(value) {
  assert.match(value, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu);
  return `'${value}'::uuid`;
}

async function probeSourceClause(client, clause, fact, expectedCode) {
  const statement = `DO $source_probe$
DECLARE
  NEW public.case_second_instance_progresses%ROWTYPE;
  target_case uuid := ${uuid(fact.targetCase)};
  target_department uuid := ${uuid(fact.targetDepartment)};
BEGIN
  NEW."case_id" := ${uuid(fact.caseId)};
  NEW."department_id" := ${uuid(fact.departmentId)};
  NEW."trial_round_id" := ${uuid(fact.trialRoundId)};
  NEW."choice_id" := ${uuid(fact.choiceId)};
  ${clause}
END;
$source_probe$;`;
  await client.query('BEGIN READ ONLY');
  try {
    await client.query('SET LOCAL search_path TO public, pg_catalog');
    assert.equal(
      (await client.query('SELECT current_schema() AS schema')).rows[0].schema,
      'public',
    );
    let errorCode = null;
    try {
      await client.query(statement);
    } catch (error) {
      errorCode = error.code ?? null;
    }
    assert.equal(errorCode, expectedCode);
  } finally {
    await client.query('ROLLBACK');
  }
}

function probeFact(row) {
  return {
    targetCase: row.case_id,
    targetDepartment: row.department_id,
    caseId: row.case_id,
    departmentId: row.department_id,
    trialRoundId: row.trial_round_id,
    choiceId: row.choice_id,
  };
}

async function sourceRegression(
  client,
  definition,
  facts,
  predecessor = false,
) {
  const clause = sourceClause(definition, predecessor);
  const normal = probeFact(facts.normal);
  const external = probeFact(facts.external);
  await probeSourceClause(client, clause, normal, predecessor ? '23514' : null);
  await probeSourceClause(client, clause, external, null);
  if (predecessor) return { normal: '23514', external: 'accepted' };
  await probeSourceClause(
    client,
    clause,
    { ...external, choiceId: randomUUID() },
    '23514',
  );
  await probeSourceClause(
    client,
    clause,
    { ...external, choiceId: facts.normal.choice_id },
    '23514',
  );
  await probeSourceClause(
    client,
    clause,
    { ...external, departmentId: randomUUID() },
    '23514',
  );
  return {
    normal: 'accepted',
    external: 'accepted',
    wrongChoice: '23514',
    crossCase: '23514',
    wrongDepartment: '23514',
  };
}

async function replay(client, entries) {
  for (const entry of entries) {
    try {
      await client.query(entry.sql);
    } catch (error) {
      throw new Error(
        `Migration ${entry.name} failed (${error.code ?? 'unknown'})`,
        {
          cause: error,
        },
      );
    }
  }
}

async function scenario(client, name, entries, kind, facts) {
  assert.match(name, /^ca008_guard_[0-9a-f]{32}_(upgrade|empty)$/u);
  const exists = await client.query(
    'SELECT 1 FROM pg_namespace WHERE nspname=$1',
    [name],
  );
  assert.equal(exists.rowCount, 0, 'Refuse to adopt an existing schema');
  await client.query(`CREATE SCHEMA ${quote(name)}`);
  try {
    await client.query(`SET search_path TO ${quote(name)}, pg_catalog`);
    assert.equal(
      (await client.query('SELECT current_schema() AS name')).rows[0].name,
      name,
    );
    await replay(client, kind === 'empty' ? entries : entries.slice(0, -1));
    if (kind === 'empty') {
      const definition = await functionDefinition(client);
      assert.match(
        definition,
        /IF EXISTS \(SELECT 1 FROM "case_external_entries" entry/u,
      );
      const probes = await sourceRegression(client, definition, facts);
      return { kind, migrations: entries.length, finalGuard: true, probes };
    }
    const before = await functionDefinition(client);
    const otherBefore = await otherGuards(client);
    const triggersBefore = await triggerDefinitions(client);
    assert.match(
      before,
      /external real appeal requires true source choice\/judgment/u,
    );
    assert.ok(triggersBefore.length > 0);
    const predecessorProbes = await sourceRegression(
      client,
      before,
      facts,
      true,
    );

    // The injected error follows the original SQL in the same transaction.
    // A failed transaction must restore the exact predecessor function.
    await client.query('BEGIN');
    let failure;
    try {
      await client.query(entries.at(-1).sql);
      await client.query('SELECT 1 / 0');
    } catch (error) {
      failure = error;
    } finally {
      await client.query('ROLLBACK');
    }
    assert.equal(failure?.code, '22012');
    assert.equal(await functionDefinition(client), before);
    assert.deepEqual(await otherGuards(client), otherBefore);
    assert.deepEqual(await triggerDefinitions(client), triggersBefore);

    await client.query(entries.at(-1).sql);
    const after = await functionDefinition(client);
    assert.notEqual(after, before);
    assert.match(
      after,
      /IF EXISTS \(SELECT 1 FROM "case_external_entries" entry/u,
    );
    assert.deepEqual(await otherGuards(client), otherBefore);
    assert.deepEqual(await triggerDefinitions(client), triggersBefore);
    const probes = await sourceRegression(client, after, facts);
    return {
      kind,
      migrations: entries.length,
      finalGuard: true,
      rollback: true,
      predecessorProbes,
      probes,
    };
  } finally {
    await client.query('SET search_path TO pg_catalog');
    await client.query(`DROP SCHEMA ${quote(name)} CASCADE`);
    assert.equal(
      (
        await client.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [
          name,
        ])
      ).rowCount,
      0,
    );
  }
}

// Source probes execute only the extracted IF clause against read-only public facts.
// The full trigger and save transaction are verified by separate application tests.
export async function verifyCaseSecondInstanceNormalSourceMigration() {
  assert.equal(process.env.CA008_OWNED_PG_APPROVED, '15439/dev_cor_test');
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, process.env.DEV_COR_TEST_DATABASE_URL);
  const target = validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL, {
    allowRandomPort: true,
  });
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.port, 15439);
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/dev_cor_test');
  const entries = await source();
  const { Client } = createRequire(resolve(root, 'backend/package.json'))('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema,current_user AS username',
      )
    ).rows[0];
    assert.equal(identity.db, 'dev_cor_test');
    assert.equal(identity.schema, 'public');
    assert.equal(identity.username, 'dev_cor_test');
    const publicBefore = await publicSnapshot(client);
    assertPublicLedger(publicBefore, entries);
    const facts = await publicProbeFacts(client);
    const nonce = randomUUID().replaceAll('-', '');
    const upgrade = await scenario(
      client,
      `ca008_guard_${nonce}_upgrade`,
      entries,
      'upgrade',
      facts,
    );
    const empty = await scenario(
      client,
      `ca008_guard_${nonce}_empty`,
      entries,
      'empty',
      facts,
    );
    assert.deepEqual(await publicSnapshot(client), publicBefore);
    return { upgrade, empty, publicUnchanged: true };
  } finally {
    await client.end();
  }
}
