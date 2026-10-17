import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  assertApprovedReferenceReuseMigration,
  assertReferenceReuseBinding,
  assertReferenceReuseTransactionBoundary,
  injectReferenceReuseRollbackProbe,
} from './case-record-material-reference-reuse.mjs';

const sourceBytes = readFileSync(
  new URL(
    '../../backend/prisma/migrations/20261016093000_case_record_material_reference_reuse/migration.sql',
    import.meta.url,
  ),
);
const sql = sourceBytes.toString('utf8');

test('0930 raw source is independently pinned and has one complete DDL transaction', () => {
  const hash = createHash('sha256').update(sourceBytes).digest('hex');
  assert.equal(assertApprovedReferenceReuseMigration(sourceBytes, hash), hash);
  assertReferenceReuseTransactionBoundary(sql);
  for (const broken of [
    sql.replace('BEGIN;\n\n', ''),
    sql.replace('\nCOMMIT;\n', '\n'),
    sql.replace('BEGIN;\n\n', 'BEGIN;\n\nBEGIN;\n\n'),
    sql.replace('\nCOMMIT;\n', '\nCOMMIT;\nCOMMIT;\n'),
  ])
    assert.throws(() => assertReferenceReuseTransactionBoundary(broken));
  const changed = Buffer.from(
    sql.replace('ordinary material references', 'all material references'),
  );
  const forgedLedger = createHash('sha256').update(changed).digest('hex');
  assert.throws(() => assertApprovedReferenceReuseMigration(changed));
  assert.throws(() =>
    assertApprovedReferenceReuseMigration(changed, forgedLedger),
  );
  assert.throws(() =>
    assertApprovedReferenceReuseMigration(sourceBytes, forgedLedger),
  );
});

test('owned rollback probe preserves dollar delimiters and every other migration byte', () => {
  const needle =
    'CREATE UNIQUE INDEX "material_references_resource_purpose_version_key"';
  const deliberate =
    "DO $$ BEGIN RAISE EXCEPTION 'deliberate migration rollback proof'; END $$;\n";
  const at = sql.indexOf(needle);
  assert.ok(
    at >
      sql.indexOf(
        'DROP INDEX "material_references_resource_purpose_version_key"',
      ),
  );
  assert.equal(sql.lastIndexOf(needle), at);
  const injected = injectReferenceReuseRollbackProbe(sql);
  assert.equal(
    createHash('sha256').update(injected).digest('hex'),
    createHash('sha256')
      .update(sql.slice(0, at) + deliberate + sql.slice(at))
      .digest('hex'),
  );
  assert.ok(
    injected.includes(
      `DROP INDEX "material_references_resource_purpose_version_key";\n${deliberate}${needle}`,
    ),
  );
  assertReferenceReuseTransactionBoundary(injected);
});

test('reuse is classified by server-side same-transaction correction evidence', () => {
  assert.match(
    sql,
    /ADD COLUMN "is_repeatable_typed_reference" boolean NOT NULL DEFAULT false/u,
  );
  assert.match(
    sql,
    /WHERE "purpose" NOT IN \('JUDGMENT','SECOND_INSTANCE_DOCUMENT','SECOND_INSTANCE_SERVICE','SECOND_INSTANCE_JUDGMENT','EXECUTION_APPLICATION','EXECUTION_FILING_PROOF'\)\s+AND NOT "is_repeatable_typed_reference"/u,
  );
  assert.match(sql, /a\.xmin = pg_current_xact_id\(\)::text::xid/u);
  assert.equal(
    (sql.match(/c\.xmin = pg_current_xact_id\(\)::text::xid/gu) ?? []).length,
    5,
  );
  for (const pair of [
    [
      'case.execution.mailing.record-corrected',
      'case_execution_mailing_record_documents',
    ],
    [
      'case.execution.filing.record-corrected',
      'case_execution_filing_record_documents',
    ],
    [
      'case.execution.finish.record-corrected',
      'case_execution_finish_record_documents',
    ],
    ['case.judgment.record-corrected', 'case_judgment_record_documents'],
    ['case.closure.record-corrected', 'case_closure_record_documents'],
  ]) {
    assert.ok(sql.includes(pair[0]) && sql.includes(pair[1]));
  }
  assert.match(sql, /pg_advisory_xact_lock/u);
  assert.match(
    sql,
    /ordinary material reference already consumed by correction/u,
  );
  assert.match(sql, /material reference classification is immutable/u);
  assert.doesNotMatch(sql, /UPDATE\s+"material_references"\s+SET/iu);
});

test('four old purpose-wide guards are pinned before adding the exact correction branch', () => {
  const guards = [
    [
      '20261012031000_guard_execution_mailing_filing',
      'check_case_execution_filing_reference',
      '89c9b856dd7eea9a9a4da9cf38cbf425',
    ],
    [
      '20261013070100_guard_case_execution_finish',
      'check_case_execution_finish_reference',
      '93a253023e12d75047452f8d49cc161c',
    ],
    [
      '20261013190100_guard_case_closure',
      'check_case_closure_reference',
      'e8632d06bbde700ddb67828136f7a9eb',
    ],
  ];
  for (const [migration, name, hash] of guards) {
    const source = readFileSync(
      new URL(
        `../../backend/prisma/migrations/${migration}/migration.sql`,
        import.meta.url,
      ),
      'utf8',
    );
    const pattern = new RegExp(
      `CREATE FUNCTION "${name}"\\(\\) RETURNS trigger LANGUAGE plpgsql AS \\$\\$([\\s\\S]*?)\\$\\$;`,
      'u',
    );
    const original = source.match(pattern)?.[1];
    assert.ok(original);
    assert.equal(createHash('md5').update(original).digest('hex'), hash);
    assert.ok(sql.includes(`'${name}','${hash}'`));
  }
  const judgmentSource = readFileSync(
    new URL(
      '../../backend/prisma/migrations/20261008028000_guard_case_judgment_reference_inserts/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const judgment = judgmentSource.match(
    /expected_body text := \$body\$([\s\S]*?)\$body\$;/u,
  )?.[1];
  assert.ok(judgment);
  assert.equal(
    createHash('md5').update(judgment).digest('hex'),
    '1399d74e07a16c67aa079c1dfeff7f23',
  );
  assert.ok(
    sql.includes(
      "'check_case_judgment_reference_insert','1399d74e07a16c67aa079c1dfeff7f23'",
    ),
  );
});

test('R2 target rejects mismatch before any capture or connection', () => {
  const correct = {
    NODE_ENV: 'test',
    DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-ui003-r2',
    DEV_COR_TEST_DATABASE_CONTAINER_ID:
      '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
    DATABASE_URL:
      'postgresql://dev_cor_test:dummy@127.0.0.1:15438/dev_cor_test',
    DEV_COR_TEST_DATABASE_URL:
      'postgresql://dev_cor_test:dummy@127.0.0.1:15438/dev_cor_test',
    npm_config_user_agent: 'pnpm/11.27.0',
  };
  assert.equal(assertReferenceReuseBinding(correct), correct.DATABASE_URL);
  for (const suffix of ['?', '#', '?mode=read', '#fragment']) {
    const url = `${correct.DATABASE_URL}${suffix}`;
    assert.throws(
      () =>
        assertReferenceReuseBinding({
          ...correct,
          DATABASE_URL: url,
          DEV_COR_TEST_DATABASE_URL: url,
        }),
      'Raw query and fragment delimiters, including empty tails, must be rejected',
    );
  }
  for (const changes of [
    { DEV_COR_TEST_DATABASE_PROJECT: 'other' },
    { DEV_COR_TEST_DATABASE_CONTAINER_ID: 'short' },
    {
      DEV_COR_TEST_DATABASE_URL:
        'postgresql://dev_cor_test:dummy@127.0.0.1:15439/dev_cor_test',
    },
    { DATABASE_URL: 'postgresql://dev_cor_test:dummy@127.0.0.1:15438/other' },
  ])
    assert.throws(() =>
      assertReferenceReuseBinding({ ...correct, ...changes }),
    );
});
