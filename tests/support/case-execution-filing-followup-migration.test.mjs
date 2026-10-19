import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  admitExecutionFilingFollowupMigration,
  assertExecutionFilingFollowupFailure,
  assertExecutionFilingFollowupLedger,
  assertOwnedExecutionFilingFollowupSchema,
  classifyExecutionFilingFollowupEnumStaging,
  executionFilingFollowup160Prelude,
  executionFilingFollowupMigrationPlan,
  expectedExecutionFilingFollowupClassifier,
  injectExecutionFilingFollowupFailure,
  ownedExecutionFilingFollowupSchema,
  replayExecutionFilingFollowupMigration,
} from './case-execution-filing-followup-migration.mjs';
import {
  assertExecutionFilingFollowupHistoricalFailure,
  assertExecutionFilingFollowupMigrationSource,
  assertExecutionFilingFollowupMigrationLedger,
  assertExecutionFilingFollowupResolveArtifacts,
} from './case-execution-filing-followup-database.mjs';
import { assertMigrationIsolation } from './case-section-record-migration.mjs';

const directory = resolve('backend/prisma/migrations');
const source160 = '20261016100000_case_execution_filing_followups';
const source159 = '20261016093000_case_record_material_reference_reuse';
const preparation = '20261016095000_execution_supplement_enum_preparation';
const http165Last = '20261016130000_evidence_demo_alignment';
const caseListPreferenceMigration = '20261019120000_case_list_preferences';
const preparationHash =
  'f9a18c2d93ac3bb75debac0835eee32dd9896fff267c1fa7275c959bddfeac5f';
const source160Hash =
  'e125a3278b0530860b1be49273fc667224451f8a6d35b420bdf14e2b9c684105';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const admitted = () => ({
  NODE_ENV: 'test',
  DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-ui003-r2',
  DEV_COR_TEST_DATABASE_CONTAINER_ID:
    '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
  DATABASE_URL:
    'postgresql://dev_cor_test:synthetic@127.0.0.1:15438/dev_cor_test',
  DEV_COR_TEST_DATABASE_URL:
    'postgresql://dev_cor_test:synthetic@127.0.0.1:15438/dev_cor_test',
  npm_config_user_agent: 'pnpm/11.27.0 node/v24.21.0',
});

test('official EF enum preparation is a separate whole migration before the unchanged1000', async () => {
  const sql = await readFile(
    join(directory, source160, 'migration.sql'),
    'utf8',
  );
  const prepared = await readFile(
    join(directory, preparation, 'migration.sql'),
    'utf8',
  );
  const statements = (value) => value.replace(/--[^\n]*/gu, '').trim();
  assert.equal(
    statements(prepared),
    statements(executionFilingFollowup160Prelude(sql).prefix),
  );
  assert.equal(sha256(sql), source160Hash);
  assert.doesNotMatch(
    statements(prepared),
    /\b(?:BEGIN|COMMIT|CREATE|GRANT|INSERT|UPDATE|DELETE)\b/u,
  );
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  assert.deepEqual(names.slice(158, 161), [source159, preparation, source160]);
});

async function withSourceFixture(operation) {
  const temporaryRoot = resolve('.local');
  await mkdir(temporaryRoot, { recursive: true });
  const fixture = await mkdtemp(join(temporaryRoot, 'ef160-source-'));
  try {
    const names = (await readdir(directory))
      .filter((name) => /^\d{14}_/u.test(name))
      .sort();
    assert.equal(names[160], source160);
    assert.equal(names[164], http165Last);
    // The owned migration probe deliberately models the frozen 161-prefix only.
    for (const name of names.slice(0, 161)) {
      await mkdir(join(fixture, name));
      await writeFile(
        join(fixture, name, 'migration.sql'),
        await readFile(join(directory, name, 'migration.sql')),
      );
    }
    return await operation(fixture);
  } finally {
    assert.equal(dirname(fixture), temporaryRoot);
    assert.ok(basename(fixture).startsWith('ef160-source-'));
    await rm(fixture, { recursive: true });
  }
}

async function ownedPlan() {
  return withSourceFixture((fixture) =>
    executionFilingFollowupMigrationPlan(fixture),
  );
}

async function currentPublicSource() {
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort()
    .slice(0, 165);
  assert.equal(names.length, 165);
  assert.equal(names.at(-1), http165Last);
  const source = await Promise.all(
    names.map(async (name) => ({
      name,
      checksum: sha256(await readFile(join(directory, name, 'migration.sql'))),
    })),
  );
  assertExecutionFilingFollowupMigrationSource(source);
  return source;
}

test('default EF plan rejects the new directory while owned161 and HTTP165 stay frozen', async () => {
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  assert.ok(names.includes(caseListPreferenceMigration));
  await assert.rejects(executionFilingFollowupMigrationPlan(), (error) => {
    assert.equal(error.code, 'ERR_ASSERTION');
    assert.equal(error.actual, names.length);
    assert.equal(error.expected, 161);
    return true;
  });
});

test('admission binds the full authorized R2 tuple and protected pnpm entry without side effects', () => {
  assert.equal(
    admitExecutionFilingFollowupMigration(admitted()).pnpmVersion,
    '11.27.0',
  );
  for (const [key, value] of [
    ['NODE_ENV', 'development'],
    ['DEV_COR_TEST_DATABASE_PROJECT', 'dev-cor-ui003'],
    ['DEV_COR_TEST_DATABASE_CONTAINER_ID', '45addc'],
    ['DATABASE_URL', undefined],
    ['DEV_COR_TEST_DATABASE_URL', undefined],
    ['npm_config_user_agent', 'npm/11.27.0'],
    ['npm_config_user_agent', 'pnpm/11.26.0 node/v24.21.0'],
  ]) {
    assert.throws(() =>
      admitExecutionFilingFollowupMigration({ ...admitted(), [key]: value }),
    );
  }
});

for (const bad of [
  'postgresql://dev_cor_test:synthetic@localhost:15438/dev_cor_test',
  'postgresql://dev_cor_test:synthetic@127.0.0.1:15437/dev_cor_test',
  'postgresql://dev_cor_test:synthetic@127.0.0.1:15436/dev_cor_test',
  'postgresql://dev_cor_test:synthetic@127.0.0.1:15438/dev_cor',
  'postgresql://other:synthetic@127.0.0.1:15438/dev_cor_test',
  'postgresql://dev_cor_test@127.0.0.1:15438/dev_cor_test',
  'postgresql://dev_cor_test:synthetic@127.0.0.1:15438/dev_cor_test?schema=public',
  'postgresql://dev_cor_test:synthetic@127.0.0.1:15438/dev_cor_test?',
  'postgresql://dev_cor_test:synthetic@127.0.0.1:15438/dev_cor_test#x',
  'postgresql://dev_cor_test:synthetic@127.0.0.1:15438/dev_cor_test#',
  'https://dev_cor_test:synthetic@127.0.0.1:15438/dev_cor_test',
]) {
  test(`admission rejects URL variant ${bad.replace(/\/\/.*@/u, '//redacted@')}`, () => {
    for (const key of ['DATABASE_URL', 'DEV_COR_TEST_DATABASE_URL'])
      assert.throws(() =>
        admitExecutionFilingFollowupMigration({ ...admitted(), [key]: bad }),
      );
  });
}

test('source plan pins all161 raw migrations including separate0950 and unchanged1000', async () => {
  const plan = await ownedPlan();
  assert.equal(plan.length, 161);
  assert.equal(plan[159].name, preparation);
  assert.equal(plan[159].sha256, preparationHash);
  assert.equal(plan[160].name, source160);
  assert.equal(plan[160].sha256, source160Hash);
  assert.equal(
    sha256(await readFile(join(directory, source160, 'migration.sql'))),
    source160Hash,
  );
  assert.deepEqual(
    plan.slice(155).map((row) => row.sha256),
    [
      '10760cf6e9969822a6b6a631760645625d227c4541a018560473e34c164953c7',
      '883f2f80b615a0f746adb2ebbb6e17cc24d0ac577a61d236f3bb6375fbc0367d',
      'dfe31436055f7ab9bf8d0796c48b3a0dd38a16acf4e5b3554e04e3d299b7b869',
      '628a0fc0a664942896fdd85e3811bfe977702e4924ef33a58f83399a9bf8280e',
      preparationHash,
      source160Hash,
    ],
  );
});

test('1000 prefix inspection preserves bytes without asserting a commit boundary', async () => {
  const sql = await readFile(
    join(directory, source160, 'migration.sql'),
    'utf8',
  );
  const { prefix, transaction } = executionFilingFollowup160Prelude(sql);
  assert.equal(prefix + transaction, sql);
  assert.match(
    prefix,
    /ALTER TYPE "material_category" ADD VALUE IF NOT EXISTS 'EXECUTION_SUPPLEMENT';/u,
  );
  assert.match(transaction, /^\nBEGIN;/u);
  assert.match(transaction, /COMMIT;\s*$/u);
  assert.equal((prefix.match(/ADD VALUE IF NOT EXISTS/gu) ?? []).length, 5);
  assert.throws(() =>
    executionFilingFollowup160Prelude(
      sql.replace("EXECUTION_SUPPLEMENT';", "WRONG';"),
    ),
  );
  assert.throws(() =>
    executionFilingFollowup160Prelude(
      sql.replace('\nBEGIN;', '\nSELECT 1;\nBEGIN;'),
    ),
  );
});

test('fault injection changes only the final transaction commit and validates the failure marker', async () => {
  const sql = await readFile(
    join(directory, source160, 'migration.sql'),
    'utf8',
  );
  const failed = injectExecutionFilingFollowupFailure(sql);
  assert.equal(
    failed.slice(0, sql.lastIndexOf('COMMIT;')),
    sql.slice(0, sql.lastIndexOf('COMMIT;')),
  );
  assert.match(failed, /RAISE EXCEPTION 'owned_ef160_migration_failure'/u);
  assertExecutionFilingFollowupFailure({
    code: 'P0001',
    message: 'owned_ef160_migration_failure',
  });
  assert.throws(() =>
    assertExecutionFilingFollowupFailure({ code: '23514', message: 'other' }),
  );
  assert.throws(() =>
    injectExecutionFilingFollowupFailure(
      executionFilingFollowup160Prelude(sql).transaction,
    ),
  );
});

test('owned schema identity rejects public, preexisting, foreign nonce and marker drift', () => {
  const nonce = 'a'.repeat(32);
  const name = ownedExecutionFilingFollowupSchema(nonce, 'upgrade');
  assertOwnedExecutionFilingFollowupSchema(
    name,
    nonce,
    new Set([name]),
    'owned',
    'owned',
  );
  for (const args of [
    ['public', nonce, new Set([name]), 'owned', 'owned'],
    [name, nonce, new Set(), 'owned', 'owned'],
    [name, 'b'.repeat(32), new Set([name]), 'owned', 'owned'],
    [name, nonce, new Set([name]), 'changed', 'owned'],
  ])
    assert.throws(() => assertOwnedExecutionFilingFollowupSchema(...args));
  assert.throws(() => ownedExecutionFilingFollowupSchema('bad";DROP', 'empty'));
});

test('only the five committed preparation labels may remain after a failed whole1000', () => {
  const before = [
    { type: 'permission_action', label: 'case.read', position: '1' },
  ];
  const added = [
    ['permission_action', 'case.execution.feedback.record'],
    ['permission_action', 'case.execution.feedback.correct'],
    ['permission_action', 'case.execution.supplement.submit'],
    ['permission_action', 'case.execution.supplement.correct'],
    ['material_category', 'EXECUTION_SUPPLEMENT'],
  ].map(([type, label], index) => ({
    type,
    label,
    position: String(index + 2),
  }));
  assert.equal(
    classifyExecutionFilingFollowupEnumStaging(before, [...before, ...added])
      .length,
    5,
  );
  assert.throws(() =>
    classifyExecutionFilingFollowupEnumStaging(before, [
      ...before,
      ...added.slice(1),
    ]),
  );
  assert.throws(() =>
    classifyExecutionFilingFollowupEnumStaging(before, [
      ...before,
      ...added,
      { type: 'permission_action', label: 'unexpected', position: '7' },
    ]),
  );
  assert.throws(() =>
    classifyExecutionFilingFollowupEnumStaging(before, [
      { ...before[0], position: '99' },
      ...added,
    ]),
  );
});

test('classifier transform uses the real 159 prosrc and requires the frozen predecessor MD5', async () => {
  const sql159 = await readFile(
    join(directory, source159, 'migration.sql'),
    'utf8',
  );
  const sql160 = await readFile(
    join(directory, source160, 'migration.sql'),
    'utf8',
  );
  const body = sql159.match(
    /CREATE FUNCTION "classify_case_record_material_reference"\(\) RETURNS trigger\s+LANGUAGE plpgsql AS \$\$([\s\S]*?)\$\$;/u,
  )?.[1];
  assert.ok(body);
  assert.equal(
    createHash('md5').update(body).digest('hex'),
    'bf5e9e373c2414498831a34ab5f7f034',
  );
  const changed = expectedExecutionFilingFollowupClassifier(body, sql160);
  assert.ok(
    changed.includes(
      "event_action IN ('case.execution.supplement.submitted','case.execution.supplement.corrected')",
    ),
  );
  assert.ok(
    changed.includes(
      "'case.closure.record-corrected',\n          'case.execution.supplement.submitted',",
    ),
  );
  assert.throws(() =>
    expectedExecutionFilingFollowupClassifier(body + ' ', sql160),
  );
});

const originalFailure = () => ({
  id: '9f547970-6eaa-4628-a670-f505590482e9',
  migration_name: source160,
  checksum: source160Hash,
  started_at: '2026-10-16 09:36:04.56343+00',
  finished_at: null,
  rolled_back_at: null,
  applied_steps_count: 0,
  logs_is_null: true,
});

test('owned ledger gate requires public159 plus only the exact unresolved original failure', async () => {
  const plan = await ownedPlan();
  const identity = [
    { db: 'dev_cor_test', schema: 'public', username: 'dev_cor_test' },
  ];
  const applied = [
    ...plan.slice(0, 159).map(({ name, sha256 }) => ({
      migration_name: name,
      checksum: sha256,
      finished_at: 'finished',
      rolled_back_at: null,
    })),
    originalFailure(),
  ];
  assertExecutionFilingFollowupLedger(identity, applied, plan);
  assert.throws(() =>
    assertExecutionFilingFollowupLedger(identity, applied.slice(0, -1), plan),
  );
  assert.throws(() =>
    assertExecutionFilingFollowupLedger(
      identity,
      [
        ...applied,
        {
          ...applied[0],
          migration_name: plan[159].name,
          checksum: plan[159].sha256,
        },
      ],
      plan,
    ),
  );
  assert.throws(() =>
    assertExecutionFilingFollowupLedger(
      identity,
      applied.map((row, i) =>
        i === 158 ? { ...row, checksum: '0'.repeat(64) } : row,
      ),
      plan,
    ),
  );
  assert.throws(() =>
    assertExecutionFilingFollowupLedger(
      [{ ...identity[0], schema: 'other' }],
      applied,
      plan,
    ),
  );
});

test('source plan refuses altered160 LF bytes while prefix and migration count still look valid', async () =>
  withSourceFixture(async (fixture) => {
    const path = join(fixture, source160, 'migration.sql');
    await writeFile(
      path,
      Buffer.concat([await readFile(path), Buffer.from('\nSELECT 1;\n')]),
    );
    await assert.rejects(
      executionFilingFollowupMigrationPlan(fixture),
      (error) =>
        error.code === 'ERR_ASSERTION' && error.expected?.[5] === source160Hash,
    );
  }));

test('source plan refuses a CRLF160 variant without SQL meaning changes', async () =>
  withSourceFixture(async (fixture) => {
    const path = join(fixture, source160, 'migration.sql');
    const bytes = await readFile(path, 'utf8');
    await writeFile(path, bytes.replace('\nBEGIN;', '\r\nBEGIN;'));
    await assert.rejects(executionFilingFollowupMigrationPlan(fixture));
  }));

test('source plan and ledger both refuse synchronized raw and ledger checksum edits for 156 through 159', async () => {
  const plan = await ownedPlan();
  const applied = [
    ...plan.slice(0, 159).map(({ name, sha256 }) => ({
      migration_name: name,
      checksum: sha256,
      finished_at: 'finished',
      rolled_back_at: null,
    })),
    originalFailure(),
  ];
  for (const index of [155, 156, 157, 158]) {
    await withSourceFixture(async (fixture) => {
      const path = join(fixture, plan[index].name, 'migration.sql');
      const raw = await readFile(path);
      const changed = Buffer.concat([raw, Buffer.from('\n-- byte change\n')]);
      await writeFile(path, changed);
      const alteredChecksum = sha256(changed);
      const synchronizedLedger = applied.map((row, rowIndex) =>
        rowIndex === index ? { ...row, checksum: alteredChecksum } : row,
      );

      await assert.rejects(executionFilingFollowupMigrationPlan(fixture));
      assert.throws(() =>
        assertExecutionFilingFollowupLedger(
          [{ db: 'dev_cor_test', schema: 'public', username: 'dev_cor_test' }],
          synchronizedLedger,
          plan,
        ),
      );
    });
  }
});

test('migration isolation export rejects public and search_path fallback tokens in actual source bytes', async () => {
  const source = await readFile(
    join(directory, source160, 'migration.sql'),
    'utf8',
  );
  for (const token of ['public', 'search_path']) {
    const injected = `${source}\n-- ${token} fallback\n`;
    assert.throws(() => assertMigrationIsolation(injected));
  }
});

test('source plan refuses count159,160 and162 instead of the exact161 chain', async () => {
  await withSourceFixture(async (fixture) => {
    await rm(join(fixture, source160), { recursive: true });
    await assert.rejects(executionFilingFollowupMigrationPlan(fixture));
  });
  await withSourceFixture(async (fixture) => {
    await rm(join(fixture, preparation), { recursive: true });
    await rm(join(fixture, source160), { recursive: true });
    await assert.rejects(executionFilingFollowupMigrationPlan(fixture));
  });
  await withSourceFixture(async (fixture) => {
    const name = '20261016110000_unapproved';
    await mkdir(join(fixture, name));
    await writeFile(join(fixture, name, 'migration.sql'), 'SELECT 1;\n');
    await assert.rejects(executionFilingFollowupMigrationPlan(fixture));
  });
});

test('EF query boundary sends preparation and original1000 whole, including the failure probe prefix', async () => {
  const plan = await ownedPlan();
  const calls = [];
  const queryBoundary = {
    async query(sql) {
      calls.push(sql);
    },
  };
  await replayExecutionFilingFollowupMigration(queryBoundary, plan[159]);
  await replayExecutionFilingFollowupMigration(queryBoundary, plan[160]);
  assert.deepEqual(calls, [plan[159].sql, plan[160].sql]);
  assert.equal(sha256(calls[1]), source160Hash);
  calls.length = 0;
  const failed = injectExecutionFilingFollowupFailure(plan[160].sql);
  await replayExecutionFilingFollowupMigration(queryBoundary, {
    ...plan[160],
    sql: failed,
  });
  assert.deepEqual(calls, [failed]);
  assert.ok(
    calls[0].startsWith(
      executionFilingFollowup160Prelude(plan[160].sql).prefix,
    ),
  );
});

test('the official deploy entry remains the protected Prisma CLI, not the owned SQL replay', async () => {
  const rootPackage = JSON.parse(await readFile('package.json', 'utf8'));
  const backendPackage = JSON.parse(
    await readFile('backend/package.json', 'utf8'),
  );
  const officialEntry = await readFile(
    'scripts/run-test-migration.mjs',
    'utf8',
  );
  assert.equal(
    rootPackage.scripts['db:test:migrate:deploy'],
    'pnpm --filter @dev-cor/backend db:migrate:deploy:test',
  );
  assert.equal(
    backendPackage.scripts['db:migrate:deploy:test'],
    'node ../scripts/run-test-migration.mjs',
  );
  assert.ok(officialEntry.includes('node_modules/prisma/build/index.js'));
  assert.match(officialEntry, /'migrate',\s*'deploy'/u);
  assert.ok(officialEntry.includes('env: environment.childEnvironment'));
  assert.ok(officialEntry.includes('const lock = acquireLock()'));
  assert.doesNotMatch(officialEntry, /client\.query|\.split\(/u);
});

test('owned admission rejects any mutation or extra row of the observed unresolved failure', async () => {
  const plan = await ownedPlan();
  const identity = [
    { db: 'dev_cor_test', schema: 'public', username: 'dev_cor_test' },
  ];
  const successful = plan.slice(0, 159).map(({ name, sha256 }) => ({
    migration_name: name,
    checksum: sha256,
    finished_at: 'finished',
    rolled_back_at: null,
  }));
  for (const mutation of [
    { id: 'another-failed-id' },
    { checksum: '0'.repeat(64) },
    { migration_name: preparation },
    { started_at: '2026-10-16T09:36:04.564Z' },
    { finished_at: 'finished' },
    { rolled_back_at: '2026-10-16T10:00:00Z' },
    { applied_steps_count: 1 },
    { logs_is_null: false },
    { logs_is_null: undefined },
  ])
    assert.throws(() =>
      assertExecutionFilingFollowupLedger(
        identity,
        [...successful, { ...originalFailure(), ...mutation }],
        plan,
      ),
    );
  assert.throws(() =>
    assertExecutionFilingFollowupLedger(identity, successful, plan),
  );
  assert.throws(() =>
    assertExecutionFilingFollowupLedger(
      identity,
      [...successful, originalFailure(), originalFailure()],
      plan,
    ),
  );
});

test('the historical failure start retains exact timestamp precision rather than Date rounding', () => {
  assertExecutionFilingFollowupHistoricalFailure(
    { ...originalFailure(), started_at: '2026-10-16 09:36:04.56343+00' },
    'UNRESOLVED',
  );
  for (const startedAt of [
    '2026-10-16 09:36:04.563429+00',
    '2026-10-16 09:36:04.563431+00',
    '2026-10-16 09:36:04.563+00',
    '2026-10-16T09:36:04.563Z',
  ])
    assert.throws(() =>
      assertExecutionFilingFollowupHistoricalFailure(
        { ...originalFailure(), started_at: startedAt },
        'UNRESOLVED',
      ),
    );
});

// In-memory synthetic receipt only. This never creates the runner's real receipt file.
function resolvedFixture() {
  const row = {
    ...originalFailure(),
    rolled_back_at: '2026-10-16 12:00:00.123+00',
  };
  const stdout = Buffer.from(`Migration ${source160} marked as rolled back.\n`),
    stderr = Buffer.alloc(0);
  const receipt = {
    protocol: 'EF001_PRISMA_ROLLBACK_V1',
    failedMigrationId: row.id,
    migrationName: row.migration_name,
    checksum: row.checksum,
    originalStartedAt: row.started_at,
    rolledBackAt: row.rolled_back_at,
    command: [
      'node',
      'node_modules/prisma/build/index.js',
      'migrate',
      'resolve',
      '--rolled-back',
      source160,
    ],
    cwd: 'backend',
    exitCode: 0,
    commandStartedAt: '2026-10-16T11:59:59.000Z',
    commandFinishedAt: '2026-10-16T12:00:01.000Z',
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
  };
  return { row, receipt, stdout, stderr };
}

test('HTTP165 readiness retains exactly one original officially resolved failure and exact CLI artifacts', async () => {
  const source = await currentPublicSource();
  const successful = source.map(({ name, checksum }, i) => ({
    id: `successful-${i}`,
    migration_name: name,
    checksum,
    started_at: '2026-10-16T12:00:02Z',
    finished_at: '2026-10-16T12:00:03Z',
    rolled_back_at: null,
    applied_steps_count: 1,
    logs_is_null: true,
  }));
  const identity = [
    { db: 'dev_cor_test', schema: 'public', username: 'dev_cor_test' },
  ];
  const f = resolvedFixture(),
    ledger = [...successful, f.row];
  assertExecutionFilingFollowupHistoricalFailure(f.row, 'RESOLVED', f.receipt);
  assertExecutionFilingFollowupResolveArtifacts(f.receipt, f.stdout, f.stderr);
  assertExecutionFilingFollowupMigrationLedger(
    identity,
    ledger,
    source,
    f.receipt,
  );
  for (const badLedger of [
    successful,
    [...successful, originalFailure()],
    [...ledger, { ...f.row, id: 'unexpected-history' }],
    [...ledger, f.row],
  ])
    assert.throws(() =>
      assertExecutionFilingFollowupMigrationLedger(
        identity,
        badLedger,
        source,
        f.receipt,
      ),
    );
  assert.throws(() =>
    assertExecutionFilingFollowupMigrationLedger(identity, ledger, source),
  );
  for (const mutation of [
    { failedMigrationId: 'another' },
    { checksum: '0'.repeat(64) },
    { migrationName: preparation },
    { originalStartedAt: '2026-10-16T09:36:04.564Z' },
    { originalStartedAt: '2026-10-16 09:36:04.563429+00' },
    { originalStartedAt: '2026-10-16 09:36:04.563431+00' },
    { originalStartedAt: '2026-10-16 09:36:04.563+00' },
    { originalStartedAt: '2026-10-16T09:36:04.563Z' },
    { rolledBackAt: '2026-10-16 12:00:00.124+00' },
    { command: ['prisma', 'migrate', 'resolve', '--applied', source160] },
    { exitCode: 1 },
    { commandFinishedAt: '2026-10-16T12:00:00Z' },
    { commandStartedAt: '2026-10-16T12:00:01Z' },
  ])
    assert.throws(() =>
      assertExecutionFilingFollowupMigrationLedger(identity, ledger, source, {
        ...f.receipt,
        ...mutation,
      }),
    );
  for (const [out, err] of [
    [Buffer.from('tampered'), f.stderr],
    [f.stdout, Buffer.from('tampered')],
  ])
    assert.throws(() =>
      assertExecutionFilingFollowupResolveArtifacts(f.receipt, out, err),
    );
  const notSuccessful = Buffer.from(`Migration ${source160} failed`);
  assert.throws(() =>
    assertExecutionFilingFollowupResolveArtifacts(
      { ...f.receipt, stdoutSha256: sha256(notSuccessful) },
      notSuccessful,
      f.stderr,
    ),
  );
  for (const count of [161, 164, 166]) {
    const wrongSource =
      count < 165
        ? source.slice(0, count)
        : [
            ...source,
            { name: '20261016140000_unapproved', checksum: '0'.repeat(64) },
          ];
    assert.throws(() =>
      assertExecutionFilingFollowupMigrationSource(wrongSource),
    );
    assert.throws(() =>
      assertExecutionFilingFollowupMigrationLedger(
        identity,
        ledger,
        wrongSource,
        f.receipt,
      ),
    );
  }
  for (const index of [155, 156, 157, 158, 159, 160, 161, 162, 163, 164]) {
    const wrongSource = source.map((entry, i) =>
      i === index ? { ...entry, checksum: '0'.repeat(64) } : entry,
    );
    const wrongLedger = ledger.map((entry, i) =>
      i === index ? { ...entry, checksum: '0'.repeat(64) } : entry,
    );
    assert.throws(() =>
      assertExecutionFilingFollowupMigrationLedger(
        identity,
        wrongLedger,
        wrongSource,
        f.receipt,
      ),
    );
  }
});

test('source plan refuses0950 byte tampering or CRLF even when its five statements remain', async () => {
  await withSourceFixture(async (fixture) => {
    const path = join(fixture, preparation, 'migration.sql');
    const bytes = await readFile(path, 'utf8');
    await writeFile(path, bytes + '\n-- changed\n');
    await assert.rejects(executionFilingFollowupMigrationPlan(fixture));
    await writeFile(path, bytes.replaceAll('\n', '\r\n'));
    await assert.rejects(executionFilingFollowupMigrationPlan(fixture));
  });
});
