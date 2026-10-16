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
} from './case-execution-filing-followup-migration.mjs';
import { assertMigrationIsolation } from './case-section-record-migration.mjs';

const directory = resolve('backend/prisma/migrations');
const source160 = '20261016100000_case_execution_filing_followups';
const source159 = '20261016093000_case_record_material_reference_reuse';
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

async function withSourceFixture(operation) {
  const temporaryRoot = resolve('.local');
  const fixture = await mkdtemp(join(temporaryRoot, 'ef160-source-'));
  try {
    const names = (await readdir(directory))
      .filter((name) => /^\d{14}_/u.test(name))
      .sort();
    assert.equal(names.length, 160);
    for (const name of names) {
      await mkdir(join(fixture, name));
      await writeFile(
        join(fixture, name, 'migration.sql'),
        await readFile(join(directory, name, 'migration.sql')),
      );
    }
    await operation(fixture);
  } finally {
    assert.equal(dirname(fixture), temporaryRoot);
    assert.ok(basename(fixture).startsWith('ef160-source-'));
    await rm(fixture, { recursive: true });
  }
}

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

test('source plan pins all 160 original bytes and independently frozen 156 through 160', async () => {
  const plan = await executionFilingFollowupMigrationPlan();
  assert.equal(plan.length, 160);
  assert.equal(plan[159].name, source160);
  assert.equal(plan[159].sha256, source160Hash);
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
      source160Hash,
    ],
  );
});

test('160 prefix is five original enum statements, separate from the original transaction bytes', async () => {
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
  const transaction = executionFilingFollowup160Prelude(sql).transaction;
  const failed = injectExecutionFilingFollowupFailure(transaction);
  assert.equal(
    failed.slice(0, transaction.lastIndexOf('COMMIT;')),
    transaction.slice(0, transaction.lastIndexOf('COMMIT;')),
  );
  assert.match(failed, /RAISE EXCEPTION 'owned_ef160_migration_failure'/u);
  assertExecutionFilingFollowupFailure({
    code: 'P0001',
    message: 'owned_ef160_migration_failure',
  });
  assert.throws(() =>
    assertExecutionFilingFollowupFailure({ code: '23514', message: 'other' }),
  );
  assert.throws(() => injectExecutionFilingFollowupFailure(sql));
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

test('only the five permitted append-only labels may remain after a failed 160 transaction', () => {
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

test('pure ledger gate requires exact public159 predecessor and all applied source checksums', async () => {
  const plan = await executionFilingFollowupMigrationPlan();
  const identity = [
    { db: 'dev_cor_test', schema: 'public', username: 'dev_cor_test' },
  ];
  const applied = plan.slice(0, 159).map(({ name, sha256 }) => ({
    migration_name: name,
    checksum: sha256,
    finished_at: 'finished',
    rolled_back_at: null,
  }));
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
        error.code === 'ERR_ASSERTION' && error.expected?.[4] === source160Hash,
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
  const plan = await executionFilingFollowupMigrationPlan();
  const applied = plan.slice(0, 159).map(({ name, sha256 }) => ({
    migration_name: name,
    checksum: sha256,
    finished_at: 'finished',
    rolled_back_at: null,
  }));
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

test('source plan refuses count159 and count161, even with a valid160 tail', async () => {
  await withSourceFixture(async (fixture) => {
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
