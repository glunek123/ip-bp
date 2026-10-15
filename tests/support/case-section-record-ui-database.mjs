import assert from 'node:assert/strict';

const approved = {
  project: 'dev-cor-ui003-r2',
  container: '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
};
const tail = [
  '20261015130000_guard_direct_second_remand_child',
  '20261015150000_case_section_record_edits',
  '20261015170000_case_section_record_uploads',
];
const normalSourcePermissionGaps = Object.freeze([
  'case.complaint.mail',
  'case.filing.submit',
  'case.acceptance.register',
  'case.hearing.schedule',
  'case.execution.submit',
]);

export class SectionRecordUiPermissionPending extends Error {
  code = 'NORMAL_SOURCE_PERMISSION_PENDING';
  finding = 'I-SECTION-UI-GRANT01';
  requiredActions = normalSourcePermissionGaps;
  constructor() {
    super(
      'I-SECTION-UI-GRANT01 / NORMAL_SOURCE_PERMISSION_PENDING: normal lead-to-case preparation is not approved for the required workflow Actions: ' +
        normalSourcePermissionGaps.join(', ') +
        '. Existing A/B user.manage and lawyer.account.manage Grants do not authorize copying them to a new role. No actor, case, capture, database, or HTTP preparation is allowed. External-entry Grant remains on hold.',
    );
    this.name = 'SectionRecordUiPermissionPending';
  }
}

// Unconditional source admission. No environment flag, injected client, alternate
// actor, or partial R2/migration proof can authorize the missing source workflow.
export function assertSectionRecordUiSourceReady() {
  throw new SectionRecordUiPermissionPending();
}

// This pure binding remains independently testable. A valid tuple is NOT source admission.
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

// Pure validation of caller-supplied evidence preserves the exact binding/157
// checks without opening a client, capturing the environment, or granting admission.
export function assertSectionRecordUiDatabaseProof(environment, proof) {
  const connectionString = assertSectionRecordUiBinding(environment);
  assert.ok(
    proof.capturedDatabaseUrl === connectionString,
    'UI capture target mismatch',
  );
  assert.ok(
    proof.validatedDatabaseUrl === connectionString,
    'UI validator target mismatch',
  );
  assert.equal(
    proof.migrations.length,
    157,
    'UI source is not the complete 157 chain',
  );
  assert.deepEqual(
    proof.migrations.slice(-3).map((m) => m.name),
    tail,
    'Unexpected UI source migration tail',
  );
  assert.equal(new Set(proof.migrations.map((m) => m.name)).size, 157);
  for (const migration of proof.migrations)
    assert.match(migration.checksum, /^[a-f0-9]{64}$/u);
  assert.deepEqual(
    proof.identity,
    [{ db: 'dev_cor_test', schema: 'public', username: 'dev_cor_test' }],
    'Unexpected UI database identity',
  );
  assert.equal(
    proof.applied.length,
    157,
    'UI R2 is not migrated to 157; runner approval is required',
  );
  for (const [index, migration] of proof.migrations.entries()) {
    const applied = proof.applied[index];
    assert.equal(
      applied.migration_name,
      migration.name,
      'UI ledger name mismatch',
    );
    assert.equal(
      applied.checksum,
      migration.checksum,
      'UI ledger checksum mismatch',
    );
    assert.ok(applied.finished_at, 'UI migration is incomplete');
    assert.equal(applied.rolled_back_at, null, 'UI migration was rolled back');
  }
}

// All actual preparation/read/write entry points refuse BEFORE any side effect.
// In particular, callers cannot bypass the hold by invoking the old database helper
// with injected offline dependencies. Ownership is never inferred or silently removed:
// no case may be admitted until a normal-source manifest/creator proof is approved.
export async function withSectionRecordUiDatabase() {
  assertSectionRecordUiSourceReady();
}
export async function assertSectionRecordUiRunner() {
  assertSectionRecordUiSourceReady();
}
export async function createSectionRecordUiActor() {
  assertSectionRecordUiSourceReady();
}
export function sectionRecordUiFixture() {
  assertSectionRecordUiSourceReady();
}
export async function ownSectionRecordUiCase() {
  assertSectionRecordUiSourceReady();
}
export async function revokeSectionRecordUiActor() {
  assertSectionRecordUiSourceReady();
}
export async function sectionRecordUiBaselineSecurity() {
  assertSectionRecordUiSourceReady();
}
export async function sectionRecordUiUploads() {
  assertSectionRecordUiSourceReady();
}
export async function sectionRecordUiSnapshot() {
  assertSectionRecordUiSourceReady();
}
