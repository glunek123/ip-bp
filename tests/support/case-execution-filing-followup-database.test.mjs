import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  assertExecutionFilingFollowupHistoricalFailure,
  assertExecutionFilingFollowupMigrationLedger,
  assertExecutionFilingFollowupMigrationSource,
  assertExecutionFilingFollowupResolveArtifacts,
} from './case-execution-filing-followup-database.mjs';

const directory = resolve('backend/prisma/migrations');
const migration = '20261016100000_case_execution_filing_followups';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identity = [
  { db: 'dev_cor_test', schema: 'public', username: 'dev_cor_test' },
];

async function currentSource() {
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      checksum: sha256(await readFile(join(directory, name, 'migration.sql'))),
    })),
  );
}

function historicalFixture() {
  const row = {
    id: '9f547970-6eaa-4628-a670-f505590482e9',
    migration_name: migration,
    checksum:
      'e125a3278b0530860b1be49273fc667224451f8a6d35b420bdf14e2b9c684105',
    started_at: '2026-10-16 09:36:04.56343+00',
    finished_at: null,
    rolled_back_at: '2026-10-16 12:00:00.123+00',
    applied_steps_count: 0,
    logs_is_null: true,
  };
  const stdout = Buffer.from(`Migration ${migration} marked as rolled back.\n`);
  const stderr = Buffer.alloc(0);
  const receipt = {
    protocol: 'EF001_PRISMA_ROLLBACK_V1',
    failedMigrationId: row.id,
    migrationName: migration,
    checksum: row.checksum,
    originalStartedAt: row.started_at,
    rolledBackAt: row.rolled_back_at,
    command: [
      'node',
      'node_modules/prisma/build/index.js',
      'migrate',
      'resolve',
      '--rolled-back',
      migration,
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

test('HTTP source guard accepts only the frozen 165 raw SQL chain', async () => {
  const source = await currentSource();
  assert.equal(source.length, 165);
  assertExecutionFilingFollowupMigrationSource(source);
  for (const [index, name, checksum] of [
    [
      155,
      '20261015150000_case_section_record_edits',
      '10760cf6e9969822a6b6a631760645625d227c4541a018560473e34c164953c7',
    ],
    [
      156,
      '20261015170000_case_section_record_uploads',
      '883f2f80b615a0f746adb2ebbb6e17cc24d0ac577a61d236f3bb6375fbc0367d',
    ],
    [
      157,
      '20261016090000_case_record_material_guard_repair',
      'dfe31436055f7ab9bf8d0796c48b3a0dd38a16acf4e5b3554e04e3d299b7b869',
    ],
    [
      158,
      '20261016093000_case_record_material_reference_reuse',
      '628a0fc0a664942896fdd85e3811bfe977702e4924ef33a58f83399a9bf8280e',
    ],
    [
      159,
      '20261016095000_execution_supplement_enum_preparation',
      'f9a18c2d93ac3bb75debac0835eee32dd9896fff267c1fa7275c959bddfeac5f',
    ],
    [
      160,
      migration,
      'e125a3278b0530860b1be49273fc667224451f8a6d35b420bdf14e2b9c684105',
    ],
    [
      161,
      '20261016110000_lead_batch_push',
      '1e267e104e4a7a1b20f1014dfd10506ce1aa831e32a11175e3a4dde2430c9e87',
    ],
    [
      162,
      '20261016115000_fee_proof_category_prepare',
      'a7b80c1143035aa0526fcb6a90857a737e505b692c2ea95efd7ff3f465e9f4d4',
    ],
    [
      163,
      '20261016120000_settlement_demo_alignment',
      'fbb81d7cb424beb9b1bad103a498c2bee66c1e7c15ef806d47631b5685a810e7',
    ],
    [
      164,
      '20261016130000_evidence_demo_alignment',
      'fd138a179438bac39a7bf30bc31373ac4ca2b9eef454ef8229c78ab0a1135de9',
    ],
  ])
    assert.deepEqual(source[index], { name, checksum });

  for (const count of [161, 164])
    assert.throws(() =>
      assertExecutionFilingFollowupMigrationSource(source.slice(0, count)),
    );
  assert.throws(() =>
    assertExecutionFilingFollowupMigrationSource([
      ...source,
      { name: '20261016140000_unapproved', checksum: '0'.repeat(64) },
    ]),
  );
  for (const index of [0, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164]) {
    const changed = source.map((row, i) =>
      i === index ? { ...row, checksum: '0'.repeat(64) } : row,
    );
    assert.throws(() => assertExecutionFilingFollowupMigrationSource(changed));
  }
  for (const index of [0, 155, 160, 164])
    assert.throws(() =>
      assertExecutionFilingFollowupMigrationSource(
        source.filter((_, i) => i !== index),
      ),
    );
  const reordered = source.slice();
  [reordered[162], reordered[163]] = [reordered[163], reordered[162]];
  assert.throws(() => assertExecutionFilingFollowupMigrationSource(reordered));
});

test('HTTP ledger guard requires 165 exact successful rows and one exact resolved failure', async () => {
  const source = await currentSource();
  const success = source.map(({ name, checksum }, i) => ({
    id: `success-${i}`,
    migration_name: name,
    checksum,
    started_at: '2026-10-16T12:00:02Z',
    finished_at: '2026-10-16T12:00:03Z',
    rolled_back_at: null,
    applied_steps_count: 1,
    logs_is_null: true,
  }));
  const { row, receipt, stdout, stderr } = historicalFixture();
  const ledger = [...success, row];
  assertExecutionFilingFollowupHistoricalFailure(row, 'RESOLVED', receipt);
  assertExecutionFilingFollowupResolveArtifacts(receipt, stdout, stderr);
  assertExecutionFilingFollowupMigrationLedger(
    identity,
    ledger,
    source,
    receipt,
  );

  for (const index of [0, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164]) {
    const changed = success.map((entry, i) =>
      i === index ? { ...entry, checksum: '0'.repeat(64) } : entry,
    );
    const changedSource = source.map((entry, i) =>
      i === index ? { ...entry, checksum: '0'.repeat(64) } : entry,
    );
    assert.throws(() =>
      assertExecutionFilingFollowupMigrationLedger(
        identity,
        [...changed, row],
        changedSource,
        receipt,
      ),
    );
    assert.throws(() =>
      assertExecutionFilingFollowupMigrationLedger(
        identity,
        [...changed, row],
        source,
        receipt,
      ),
    );
    assert.throws(() =>
      assertExecutionFilingFollowupMigrationLedger(
        identity,
        [...success.filter((_, i) => i !== index), row],
        source,
        receipt,
      ),
    );
  }
  for (const mutation of [
    { finished_at: null },
    { rolled_back_at: '2026-10-16 12:00:01+00' },
    { migration_name: source[163].name },
  ])
    assert.throws(() =>
      assertExecutionFilingFollowupMigrationLedger(
        identity,
        [...success.slice(0, 164), { ...success[164], ...mutation }, row],
        source,
        receipt,
      ),
    );
  for (const bad of [
    success,
    [...success, { ...row, id: 'different-failure' }],
    [...success, row, row],
    [...success, { ...row, rolled_back_at: null }],
    [...success, { ...row, finished_at: '2026-10-16 12:00:01+00' }],
    [...success, { ...row, started_at: '2026-10-16 09:36:04.563+00' }],
  ])
    assert.throws(() =>
      assertExecutionFilingFollowupMigrationLedger(
        identity,
        bad,
        source,
        receipt,
      ),
    );
  for (const mutation of [
    { failedMigrationId: 'other' },
    { rolledBackAt: '2026-10-16 12:00:00.124+00' },
    { command: ['prisma', 'migrate', 'resolve', '--rolled-back', migration] },
    { commandFinishedAt: '2026-10-16T11:59:59.000Z' },
  ])
    assert.throws(() =>
      assertExecutionFilingFollowupMigrationLedger(identity, ledger, source, {
        ...receipt,
        ...mutation,
      }),
    );
  assert.throws(() =>
    assertExecutionFilingFollowupMigrationLedger(identity, ledger, source),
  );
});
