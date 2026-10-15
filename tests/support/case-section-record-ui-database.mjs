import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  captureTestEnvironment,
  validateBrowserTestDatabaseUrl,
} from '../../scripts/test-environment.mjs';
import {
  createSectionUploadActor,
  ownSectionUploadCase,
  sectionUploadFixture,
  revokeSectionUploadActor,
  sectionUploadSnapshot,
} from './case-section-record-upload-database.mjs';
import { historicalBaselineSecuritySnapshot } from './case-historical-record-edit-database.mjs';

const approved = {
  project: 'dev-cor-ui003-r2',
  container: '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
};
const actors = new Map();
const cases = new Map();
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const tail = [
  '20261015130000_guard_direct_second_remand_child',
  '20261015150000_case_section_record_edits',
  '20261015170000_case_section_record_uploads',
];

// Pure first gate: no capture, Docker, connection, hashing, or fixture side effect.
export function assertSectionRecordUiBinding(environment = process.env) {
  assert.equal(
    environment.NODE_ENV,
    'test',
    'UI acceptance requires test mode',
  );
  assert.equal(
    environment.DEV_COR_TEST_DATABASE_PROJECT,
    approved.project,
    'Wrong UI R2 project',
  );
  assert.equal(
    environment.DEV_COR_TEST_DATABASE_CONTAINER_ID,
    approved.container,
    'Wrong UI R2 full CID',
  );
  const values = [
    environment.DATABASE_URL,
    environment.DEV_COR_TEST_DATABASE_URL,
  ];
  assert.ok(values[0] && values[1], 'Both UI R2 URLs are required');
  assert.ok(values[0] === values[1], 'UI R2 URLs must be byte-identical');
  for (const value of values) {
    assert.ok(
      !value.includes('?') && !value.includes('#'),
      'UI R2 URL cannot have query/fragment',
    );
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error('Invalid UI R2 URL');
    }
    assert.ok(
      ['postgres:', 'postgresql:'].includes(parsed.protocol),
      'Wrong UI database protocol',
    );
    assert.equal(parsed.hostname, '127.0.0.1', 'Wrong UI database host');
    assert.equal(parsed.port, '15438', 'Wrong UI database port');
    assert.equal(parsed.pathname, '/dev_cor_test', 'Wrong UI database name');
    assert.equal(parsed.username, 'dev_cor_test', 'Wrong UI database user');
    assert.ok(parsed.password, 'UI database password is required');
  }
  assert.match(
    environment.npm_config_user_agent ?? '',
    /\bpnpm\/11\.27\.0(?:\s|$)/u,
    'Use the protected project pnpm runner',
  );
  return values[0];
}

async function migrationInputs() {
  const directory = resolve(process.cwd(), 'backend/prisma/migrations');
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  assert.equal(
    names.length,
    157,
    'UI acceptance requires the full 157 source chain',
  );
  assert.deepEqual(
    names.slice(-3),
    tail,
    'Unexpected UI source migration tail',
  );
  return Promise.all(
    names.map(async (name) => ({
      name,
      checksum: createHash('sha256')
        .update(await readFile(resolve(directory, name, 'migration.sql')))
        .digest('hex'),
    })),
  );
}

// Offline injection is solely for the pure gate tests. Runtime uses official capture/validator.
export async function withSectionRecordUiDatabase(operation, offline) {
  const environment = offline?.environment ?? process.env;
  const connectionString = assertSectionRecordUiBinding(environment);
  const captured = (
    offline?.capture ??
    (() => captureTestEnvironment(process.cwd(), { pnpmVersion: '11.27.0' }))
  )();
  const target = (
    offline?.validate ??
    (() => validateBrowserTestDatabaseUrl(connectionString, process.cwd()))
  )();
  assert.ok(
    captured.childEnvironment.DATABASE_URL === connectionString,
    'UI capture target mismatch',
  );
  assert.ok(
    target.connectionString === connectionString,
    'UI validator target mismatch',
  );
  const migrations = await (offline?.migrations ?? migrationInputs)();
  assert.equal(
    migrations.length,
    157,
    'UI source is not the complete 157 chain',
  );
  assert.deepEqual(
    migrations.slice(-3).map((m) => m.name),
    tail,
    'Unexpected UI source migration tail',
  );
  assert.equal(new Set(migrations.map((m) => m.name)).size, 157);
  for (const migration of migrations)
    assert.match(migration.checksum, /^[a-f0-9]{64}$/u);
  const openClient =
    offline?.openClient ??
    ((url) => {
      const requireBackend = createRequire(
        resolve(process.cwd(), 'backend/package.json'),
      );
      const { Client } = requireBackend('pg');
      return new Client({ connectionString: url });
    });
  const client = openClient(connectionString);
  try {
    await client.connect();
    const identity = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema,current_user AS username',
      )
    ).rows;
    assert.deepEqual(
      identity,
      [{ db: 'dev_cor_test', schema: 'public', username: 'dev_cor_test' }],
      'Unexpected UI database identity',
    );
    const applied = (
      await client.query(
        'SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name',
      )
    ).rows;
    assert.equal(
      applied.length,
      157,
      'UI R2 is not migrated to 157; runner approval is required',
    );
    for (const [index, migration] of migrations.entries()) {
      assert.equal(
        applied[index].migration_name,
        migration.name,
        'UI ledger name mismatch',
      );
      assert.equal(
        applied[index].checksum,
        migration.checksum,
        'UI ledger checksum mismatch',
      );
      assert.ok(applied[index].finished_at, 'UI migration is incomplete');
      assert.equal(
        applied[index].rolled_back_at,
        null,
        'UI migration was rolled back',
      );
    }
    return await operation(client);
  } finally {
    await client.end();
  }
}

export async function assertSectionRecordUiRunner() {
  await withSectionRecordUiDatabase(async () => {});
}

export async function createSectionRecordUiActor() {
  await assertSectionRecordUiRunner();
  const actor = await createSectionUploadActor();
  actors.set(actor.userId, actor);
  return actor;
}

export function sectionRecordUiFixture() {
  return sectionUploadFixture();
}

export async function ownSectionRecordUiCase(caseId, actorUserId) {
  assert.match(caseId, uuid);
  assert.ok(actors.has(actorUserId), 'UI case must belong to this run actor');
  await withSectionRecordUiDatabase(async (client) => {
    const result = await client.query(
      'SELECT c.id FROM cases c JOIN case_external_entries e ON e.case_id=c.id WHERE c.id=$1 AND c.department_id=$2 AND e.recorded_by_user_id=$3 AND e.source LIKE $4',
      [
        caseId,
        sectionUploadFixture().departmentId,
        actorUserId,
        sectionUploadFixture().sourcePrefix + '%',
      ],
    );
    assert.equal(
      result.rows.length,
      1,
      'UI source was not appended by this actor',
    );
  });
  await ownSectionUploadCase(caseId, actorUserId);
  cases.set(caseId, actorUserId);
}

export async function revokeSectionRecordUiActor(userId) {
  const owned = actors.get(userId);
  assert.ok(owned, 'Only this run upload actor can be revoked here');
  await assertSectionRecordUiRunner();
  await revokeSectionUploadActor(userId);
}

export async function sectionRecordUiBaselineSecurity() {
  await assertSectionRecordUiRunner();
  return historicalBaselineSecuritySnapshot();
}

export async function sectionRecordUiUploads(caseId) {
  assert.ok(cases.has(caseId), 'Only this run upload case may be inspected');
  await assertSectionRecordUiRunner();
  return (await sectionUploadSnapshot(caseId)).map((row) => ({
    versionId: row.version_id,
    draftId: row.draft_id,
    targetId: row.target_id,
    revision: row.revision,
    firstFreeze: row.first_freeze,
  }));
}

// Frozen workflow facts are compared separately from append-only record corrections.
// No INSERT/UPDATE/DELETE of cases, facts, materials, receipts, migrations, or baseline security.
export async function sectionRecordUiSnapshot(caseId) {
  assert.ok(
    cases.has(caseId),
    'Only this run verified external case may be read',
  );
  return withSectionRecordUiDatabase(async (client) => {
    const frozen = {};
    for (const table of [
      'cases',
      'case_external_entries',
      'case_external_entry_receipts',
      'case_trial_rounds',
      'case_hearing_arrangements',
      'case_hearing_advances',
      'case_hearing_corrections',
      'case_hearing_receipts',
      'case_judgment_facts',
      'case_judgment_versions',
      'case_judgment_receipts',
      'case_judgment_next_steps',
      'case_judgment_next_step_receipts',
      'case_execution_mailings',
      'case_execution_mailing_receipts',
      'case_execution_filings',
      'case_execution_filing_receipts',
      'case_execution_finishes',
      'case_execution_finish_receipts',
      'case_closures',
      'case_closure_versions',
      'case_closure_documents',
      'case_closure_receipts',
      'case_archives',
      'case_archive_versions',
      'case_archive_receipts',
    ]) {
      const column = table === 'cases' ? 'id' : 'case_id';
      frozen[table] = (
        await client.query(
          `SELECT to_jsonb(t) AS row FROM "${table}" t WHERE "${column}"=$1 ORDER BY to_jsonb(t)::text`,
          [caseId],
        )
      ).rows;
    }
    frozen.oldCaseAudits = (
      await client.query(
        "SELECT to_jsonb(a) AS row FROM audit_events a WHERE resource_type='CASE' AND resource_id=$1 AND action NOT LIKE '%.record-corrected' ORDER BY id",
        [caseId],
      )
    ).rows;
    const corrections = {};
    for (const table of [
      'case_execution_mailing_record_corrections',
      'case_execution_filing_record_corrections',
      'case_execution_finish_record_corrections',
      'case_hearing_record_corrections',
      'case_judgment_record_corrections',
      'case_closure_record_corrections',
      'case_section_record_edit_receipts',
    ]) {
      corrections[table] = (
        await client.query(
          `SELECT to_jsonb(t) AS row FROM "${table}" t WHERE case_id=$1 ORDER BY to_jsonb(t)::text`,
          [caseId],
        )
      ).rows;
    }
    return { frozen, corrections };
  });
}
