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
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  admitSectionMigration,
  applySectionCompatibility,
  assertMigrationIsolation,
  assertOwnedSectionSchema,
  assertSectionMigrationFailure,
  classifySectionEnumStaging,
  injectSectionMigrationFailure,
  ownedSectionSchema,
  section156Prelude,
  sectionCompatibilityReplacements,
  sectionMigrationPlan,
} from './case-section-record-migration.mjs';

const uploadMigration = '20261015170000_case_section_record_uploads';
const recordMigration = '20261015150000_case_section_record_edits';
const oldRecordHash =
  '87e2a8ee00ac8341419a07192a43227101fc60d182bd5f1006acc1cfe315001b';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function assertTrialDateParameterBindings(sql) {
  const declaration = sql.match(
    /CREATE FUNCTION case_section_trial_date_valid\([\s\S]*?\n\$\$;/u,
  )?.[0];
  assert.ok(declaration, 'Exact trial-date function must exist');
  assert.match(
    declaration,
    /rid uuid, p_kind text, proposed date, advanced boolean\)/u,
  );
  assert.match(
    declaration,
    /WHERE p_kind='JUDGMENT' AND advance\.trial_round_id=rid/u,
  );
  assert.match(declaration, /WHERE p_kind='HEARING' AND j\.case_id=cid/u);
  assert.doesNotMatch(
    declaration,
    /\bkind\b/u,
    'Unqualified kind can bind case_judgment_facts.kind instead of the function argument',
  );
}

function predecessor156Bytes(sql) {
  return sql
    .replace(
      'rid uuid, p_kind text, proposed date',
      'rid uuid, kind text, proposed date',
    )
    .replace("WHERE p_kind='JUDGMENT'", "WHERE kind='JUDGMENT'")
    .replace("WHERE p_kind='HEARING'", "WHERE kind='HEARING'");
}
async function withMigrationFixture(operation) {
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(
    join(temporaryRoot, 'section-migration-bytes-'),
  );
  try {
    const source = resolve('backend/prisma/migrations');
    const names = (await readdir(source)).filter((name) =>
      /^\d{14}_/u.test(name),
    );
    for (const name of names) {
      const bytes = await readFile(join(source, name, 'migration.sql'));
      // Only this owned temporary fixture is normalized to the verified Git blob.
      // Production admission reads/hash-checks raw bytes and rejects CRLF variants.
      const fixture =
        name === uploadMigration
          ? Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'))
          : bytes;
      await mkdir(join(directory, name));
      await writeFile(join(directory, name, 'migration.sql'), fixture);
    }
    return await operation(directory);
  } finally {
    assert.equal(dirname(directory), temporaryRoot);
    assert.ok(basename(directory).startsWith('section-migration-bytes-'));
    await rm(directory, { recursive: true });
  }
}

const admitted = () => ({
  NODE_ENV: 'test',
  DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-ui003-r2',
  DEV_COR_TEST_DATABASE_CONTAINER_ID:
    '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
  DATABASE_URL:
    'postgresql://synthetic:placeholder@127.0.0.1:15438/dev_cor_test',
  DEV_COR_TEST_DATABASE_URL:
    'postgresql://synthetic:placeholder@127.0.0.1:15438/dev_cor_test',
  npm_config_user_agent: 'pnpm/11.27.0 node/v24.21.0',
});

test('pure admission accepts only exact explicit R2 and never captures/connects', () => {
  assert.equal(admitSectionMigration(admitted()).pnpmVersion, '11.27.0');
  for (const [key, value] of [
    ['NODE_ENV', 'development'],
    ['DEV_COR_TEST_DATABASE_PROJECT', 'dev-cor-ui003'],
    ['DEV_COR_TEST_DATABASE_CONTAINER_ID', '45addc'],
    ['DEV_COR_TEST_DATABASE_URL', undefined],
    ['DATABASE_URL', undefined],
    ['npm_config_user_agent', 'npm/11'],
  ]) {
    assert.throws(() => admitSectionMigration({ ...admitted(), [key]: value }));
  }
});

for (const bad of [
  'postgresql://synthetic:placeholder@localhost:15438/dev_cor_test',
  'postgresql://synthetic:placeholder@127.0.0.1:15437/dev_cor_test',
  'postgresql://synthetic:placeholder@127.0.0.1:15436/dev_cor_test',
  'postgresql://synthetic:placeholder@127.0.0.1:15438/dev_cor',
  'postgresql://synthetic:placeholder@127.0.0.1:15438/dev_cor_test?schema=public',
  'postgresql://synthetic:placeholder@127.0.0.1:15438/dev_cor_test?',
  'postgresql://synthetic:placeholder@127.0.0.1:15438/dev_cor_test#x',
  'postgresql://synthetic:placeholder@127.0.0.1:15438/dev_cor_test#',
  'https://synthetic:placeholder@127.0.0.1:15438/dev_cor_test',
  'postgresql://synthetic@127.0.0.1:15438/dev_cor_test',
]) {
  test(`reject URL variant ${bad.replace(/\/\/.*@/u, '//redacted@')}`, () => {
    for (const key of ['DATABASE_URL', 'DEV_COR_TEST_DATABASE_URL']) {
      assert.throws(() => admitSectionMigration({ ...admitted(), [key]: bad }));
    }
  });
}

test('nonce schema ownership refuses public, preexisting, foreign nonce and changed marker', () => {
  const nonce = 'a'.repeat(32);
  const name = ownedSectionSchema(nonce, 'upgrade');
  const created = new Set([name]);
  assertOwnedSectionSchema(name, nonce, created, 'owned', 'owned');
  for (const args of [
    ['public', nonce, created, 'owned', 'owned'],
    [name, nonce, new Set(), 'owned', 'owned'],
    [name, 'b'.repeat(32), created, 'owned', 'owned'],
    [name, nonce, created, 'changed', 'owned'],
  ])
    assert.throws(() => assertOwnedSectionSchema(...args));
  assert.throws(() => ownedSectionSchema('bad";DROP', 'empty'));
  assert.throws(() => ownedSectionSchema(nonce, 'public'));
});

test('source screen blocks cross-schema/cluster writes and disabled integrity', () => {
  for (const sql of [
    'INSERT INTO public.cases VALUES (1)',
    'UPDATE "another"."cases" SET version=1',
    'ALTER TABLE other.cases ADD COLUMN x text',
    'CREATE FUNCTION other.x() RETURNS void',
    'SET search_path TO public',
    'SET session_replication_role=replica',
    'CREATE EXTENSION example',
    'ALTER ROLE example SUPERUSER',
    'DROP SCHEMA example CASCADE',
    "COPY cases FROM PROGRAM 'x'",
    "SELECT set_config('x','x',true)",
  ])
    assert.throws(() => assertMigrationIsolation(sql));
  assertMigrationIsolation(
    'CREATE TABLE "owned_table" (id uuid REFERENCES "another_owned_table"(id));',
  );
});

test('failure injection accepts only exact expected exception and keeps original input intact', () => {
  const sql = 'BEGIN;\nSELECT 1;\nCOMMIT;\n';
  const modified = injectSectionMigrationFailure(sql);
  assert.ok(modified.includes('SELECT 1;'));
  assert.equal(sql, 'BEGIN;\nSELECT 1;\nCOMMIT;\n');
  assertSectionMigrationFailure({
    code: 'P0001',
    message: 'owned_section_migration_failure',
  });
  for (const error of [
    undefined,
    { code: '23514', message: 'owned_section_migration_failure' },
    { code: 'P0001', message: 'unrelated' },
  ])
    assert.throws(() => assertSectionMigrationFailure(error));
  assert.throws(() => injectSectionMigrationFailure('BEGIN; SELECT 1;'));
});

test('enum rollback classification permits exactly append-only 156 staging, never Grant/data claims', () => {
  const before = [
    { type: 'permission_action', label: 'case.read', position: '1' },
  ];
  const added = {
    type: 'permission_action',
    label: 'case.execution.mailing.correct',
    position: '2',
  };
  assert.deepEqual(
    classifySectionEnumStaging(before, [...before, added], true),
    [added.label],
  );
  assert.deepEqual(classifySectionEnumStaging(before, before, true), []);
  assert.throws(() =>
    classifySectionEnumStaging(before, [...before, added], false),
  );
  assert.throws(() => classifySectionEnumStaging(before, [], true));
  assert.throws(() =>
    classifySectionEnumStaging(before, [{ ...before[0], position: '2' }], true),
  );
  assert.throws(() =>
    classifySectionEnumStaging(
      before,
      [...before, { ...added, label: 'case.anything' }],
      true,
    ),
  );
  assert.throws(() =>
    classifySectionEnumStaging(
      before,
      [...before, { ...added, type: 'case_stage' }],
      true,
    ),
  );
});

test('all exact 157 LF candidate sources pass isolation screen; frozen 156 compat changes only date inputs', async () =>
  withMigrationFixture(async (directory) => {
    const plan = await sectionMigrationPlan(directory);
    assert.equal(plan.length, 157);
    assert.equal(
      plan[156].sha256,
      '218b2309215b418c0e6ec3a5c072cb3f16034946002dbf69a6dad07f11f02296',
    );
    const sql = plan[155].sql;
    const { prelude, transaction } = section156Prelude(sql);
    assert.equal(prelude + transaction, sql);
    assert.throws(() =>
      section156Prelude(sql.replace('ADD VALUE IF NOT EXISTS', 'ADD VALUE')),
    );
    const groups = sectionCompatibilityReplacements(sql);
    assert.deepEqual(
      groups.map((group) => group.replacements.length),
      [2, 6, 5, 1],
    );
    for (const { replacements } of groups) {
      const original = [
        'unchanged chain predicates',
        ...replacements.map(({ before }) => before),
        'unchanged branches',
      ].join('\n');
      const expected = [
        'unchanged chain predicates',
        ...replacements.map(({ after }) => after),
        'unchanged branches',
      ].join('\n');
      assert.equal(applySectionCompatibility(original, replacements), expected);
      assert.throws(() =>
        applySectionCompatibility('missing predecessor input', replacements),
      );
    }
    assert.throws(() =>
      sectionCompatibilityReplacements(
        sql.replace(
          'p."proname"=\'check_case_hearing_fact\'',
          'p."proname"=\'wrong\'',
        ),
      ),
    );
  }));

test('reject old CRLF157 raw bytes instead of normalizing them into accepted LF', async () =>
  withMigrationFixture(async (directory) => {
    const path = join(directory, uploadMigration, 'migration.sql');
    const canonical = await readFile(path, 'utf8');
    const boundary = '\n\nCREATE FUNCTION "guard_section_upload_consumption"';
    assert.ok(canonical.includes(boundary));
    const oldBytes = Buffer.from(
      canonical.replace(
        boundary,
        '\n\r\nCREATE FUNCTION "guard_section_upload_consumption"',
      ),
    );
    assert.equal(
      createHash('sha256').update(oldBytes).digest('hex'),
      '05fdbc823d8677f6c0243b4a9183deb22235b6aefa44b82b65e5430dc72f7392',
    );
    await writeFile(path, oldBytes);
    await assert.rejects(
      sectionMigrationPlan(directory),
      (error) =>
        error.code === 'ERR_ASSERTION' &&
        error.expected?.[1] ===
          '218b2309215b418c0e6ec3a5c072cb3f16034946002dbf69a6dad07f11f02296',
    );
  }));

test('reject changed LF157 SQL even when names/count and isolation screen remain valid', async () =>
  withMigrationFixture(async (directory) => {
    const path = join(directory, uploadMigration, 'migration.sql');
    const canonical = await readFile(path);
    await writeFile(
      path,
      Buffer.concat([canonical, Buffer.from('\nSELECT 1;\n')]),
    );
    await assert.rejects(
      sectionMigrationPlan(directory),
      (error) =>
        error.code === 'ERR_ASSERTION' &&
        error.expected?.[1] ===
          '218b2309215b418c0e6ec3a5c072cb3f16034946002dbf69a6dad07f11f02296',
    );
  }));

test('trial-date dispatch references its text argument in both branches, never the judgment-kind column', async () => {
  const sql = await readFile(
    resolve('backend/prisma/migrations', recordMigration, 'migration.sql'),
    'utf8',
  );
  assertTrialDateParameterBindings(sql);
  const old = predecessor156Bytes(sql);
  assert.equal(
    sha256(old),
    oldRecordHash,
    'Only the parameter and its two references may change',
  );
  assert.throws(() => assertTrialDateParameterBindings(old));
  assert.throws(() =>
    assertTrialDateParameterBindings(
      sql.replace("WHERE p_kind='HEARING'", "WHERE kind='HEARING'"),
    ),
  );
  const enumSql = await readFile(
    resolve(
      'backend/prisma/migrations/20261008020000_add_case_judgment_enums/migration.sql',
    ),
    'utf8',
  );
  assert.match(
    enumSql,
    /CREATE TYPE "case_judgment_kind" AS ENUM \('REGISTER', 'CORRECT'\)/u,
  );
});

test('reject original156 bytes after the unpublished parameter-binding fix', async () =>
  withMigrationFixture(async (directory) => {
    const path = join(directory, recordMigration, 'migration.sql');
    const original = predecessor156Bytes(await readFile(path, 'utf8'));
    assert.equal(sha256(original), oldRecordHash);
    await writeFile(path, original);
    await assert.rejects(
      sectionMigrationPlan(directory),
      (error) =>
        error.code === 'ERR_ASSERTION' && error.actual?.[0] === oldRecordHash,
    );
  }));

test('reject altered156 bytes even after the correct parameter binding is present', async () =>
  withMigrationFixture(async (directory) => {
    const path = join(directory, recordMigration, 'migration.sql');
    await writeFile(
      path,
      Buffer.concat([await readFile(path), Buffer.from('\nSELECT 1;\n')]),
    );
    await assert.rejects(
      sectionMigrationPlan(directory),
      (error) => error.code === 'ERR_ASSERTION',
    );
  }));
