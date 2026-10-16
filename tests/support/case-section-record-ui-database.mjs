import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const approved = {
  project: 'dev-cor-ui003-r2',
  container: '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
};
const tail = [
  '20261015130000_guard_direct_second_remand_child',
  '20261015150000_case_section_record_edits',
  '20261015170000_case_section_record_uploads',
  '20261016090000_case_record_material_guard_repair',
];
const repairChecksum =
  'dfe31436055f7ab9bf8d0796c48b3a0dd38a16acf4e5b3554e04e3d299b7b869';
const authorizedActions = Object.freeze([
  'case.complaint.mail',
  'case.filing.submit',
  'case.acceptance.register',
  'case.hearing.schedule',
  'case.execution.submit',
  'case.external-entry.create',
  'case.execution.mailing.correct',
  'case.execution.filing.correct',
  'case.execution.finish.correct',
]);
const primary = Object.freeze({
  userId: 'edc8bf6f-6660-41f6-8418-f72f87443a1c',
  roleId: '51c34a8b-fb00-45b1-ab9f-d077d59d4878',
  departmentId: '10000000-0000-4000-8000-000000000001',
  assignmentId: '8bed4da1-c61e-40d9-bd78-170380421ce8',
  membershipId: '36ea4166-dce8-48bd-bb9b-216222f0ea2a',
});
const originHash =
  'f61ab7550209b531a7dc66d9a32bc5b023b47014feccda9730b17c3a4ca26d83';
const privateHash =
  'd9367f33ac67ad2353648ade02b3c110aaa1785a51944207882de56e34a94de1';
const privatePath =
  'C:\\Users\\97830\\AppData\\Local\\Temp\\dev-cor-h-actor-recovery-83ac59ee-1b96-4fde-b1b8-534061a36ed0\\actor.private.json';
const approvalMessages = [
  'Sentinel_fdf4b7a29e488191a3002876ccc91fa7',
  'Sentinel_99c7388c6e608191a8cf0379ef2f1f39',
];
const insertedGrants = [
  ['c45f5968-f1b1-4b7f-9958-fe95224e63ec', 'case.complaint.mail'],
  ['ccee168c-b7c1-4f0c-a045-cf6aa1cea7a8', 'case.filing.submit'],
  ['031911aa-9794-415a-b4ea-6dd6e5a050e9', 'case.acceptance.register'],
  ['604ac717-4e8e-46fc-9eb2-9946a06c2063', 'case.external-entry.create'],
  ['221b4dfd-6ad6-48aa-933e-5cc48d31e07c', 'case.execution.mailing.correct'],
  ['e8a738ff-28fa-435b-a81f-6850e15248b6', 'case.execution.filing.correct'],
  ['4fdb897a-36af-4c40-971b-dfc247c6422f', 'case.execution.finish.correct'],
].map(([id, action]) => ({
  id,
  action,
  role_template_id: primary.roleId,
  scope: 'DEPARTMENT',
}));
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const digest = (value) => sha(JSON.stringify(canonical(value)));
const grant = (value) => ({
  id: value.id,
  role_template_id: value.role_template_id,
  action: value.action,
  scope: value.scope,
});
const sortedGrants = (values) =>
  values.map(grant).sort((a, b) => a.id.localeCompare(b.id));
const actors = new Map();
const cases = new Map();
let terminal = false;
let terminalObjectsHash;

export class SectionRecordUiPermissionPending extends Error {
  code = 'NORMAL_SOURCE_PERMISSION_PENDING';
  finding = 'I-SECTION-UI-GRANT01';
  requiredActions = authorizedActions;
  constructor() {
    super(
      'I-SECTION-UI-GRANT01 / NORMAL_SOURCE_PERMISSION_PENDING: the nine Actions are user-authorized, but execution requires the exact runner-sealed H actor, current 42 Grants, candidate/R2 proof and original credential. No factory or environment flag can supply missing evidence.',
    );
    this.name = 'SectionRecordUiPermissionPending';
  }
}

// Pure validation. A positive unit fixture is evidence-shape validation only.
export function validateSectionRecordUiAdmission(
  input,
  origin,
  credential,
  candidate,
  receipt,
) {
  assert.ok(input && typeof input === 'object');
  assert.deepEqual(
    Object.keys(input).sort(),
    [
      'version',
      'runId',
      'candidate',
      'environment',
      'actor',
      'fixture',
      'authorizationMessages',
      'originSha256',
      'credentialProofSha256',
      'objectsSha256',
      'currentGrants',
      'insertedGrantIds',
      'liveCheckedAt',
      'terminal',
    ].sort(),
  );
  assert.equal(input.version, 1);
  assert.match(input.runId, uuid);
  assert.deepEqual(input.candidate, candidate);
  assert.match(candidate.commit, /^[a-f0-9]{40}$/u);
  assert.match(candidate.tree, /^[a-f0-9]{40}$/u);
  assert.deepEqual(input.environment, {
    ...approved,
    host: '127.0.0.1',
    port: 15438,
    database: 'dev_cor_test',
    schema: 'public',
    migrations: 158,
  });
  assert.deepEqual(input.authorizationMessages, approvalMessages);
  assert.equal(input.originSha256, originHash);
  assert.deepEqual(
    origin.allAddedObjects.user_accounts.map((row) => row.id),
    [primary.userId],
  );
  assert.deepEqual(
    origin.allAddedObjects.role_templates.map((row) => row.id),
    [primary.roleId],
  );
  assert.equal(origin.newCases.length, 0);
  assert.equal(origin.newLeadIds.length, 0);
  assert.equal(origin.newGrants.length, 35);
  const credentialId = origin.allAddedObjects.local_credentials[0].id;
  assert.equal(credentialId, 'f695cb82-e0d1-4dcc-9135-d1e3c75ecc8b');
  assert.equal(
    origin.allAddedObjects.role_assignments[0].id,
    primary.assignmentId,
  );
  assert.equal(
    origin.allAddedObjects.department_memberships[0].id,
    primary.membershipId,
  );
  assert.deepEqual(input.actor, { ...primary, credentialId });
  assert.deepEqual(input.fixture, {
    customerId: '50000000-0000-4000-8000-000000000002',
    rightsHolderId: '60000000-0000-4000-8000-000000000001',
  });
  assert.equal(input.terminal, false);
  assert.ok(
    typeof input.liveCheckedAt === 'string' &&
      Number.isFinite(Date.parse(input.liveCheckedAt)),
  );
  assert.match(input.objectsSha256, /^[a-f0-9]{64}$/u);
  assert.match(input.credentialProofSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(
    Object.keys(credential).sort(),
    [
      'actorId',
      'credentialId',
      'originalCredentialUnchanged',
      'passwordVerifiedAgainstExistingHash',
      'privateFilePath',
      'privateFileSha256',
      'secretsInEvidence',
      'HTTPPerformed',
      'newPrivateCopyCreated',
    ].sort(),
  );
  assert.equal(credential.actorId, primary.userId);
  assert.equal(credential.credentialId, credentialId);
  assert.equal(credential.originalCredentialUnchanged, true);
  assert.equal(credential.passwordVerifiedAgainstExistingHash, true);
  assert.equal(credential.privateFileSha256, privateHash);
  assert.equal(credential.privateFilePath, privatePath);
  assert.equal(credential.secretsInEvidence, false);
  assert.equal(credential.HTTPPerformed, false);
  assert.equal(credential.newPrivateCopyCreated, false);
  const current = sortedGrants(input.currentGrants),
    original = sortedGrants(origin.newGrants);
  assert.equal(current.length, 42);
  assert.equal(new Set(current.map((item) => item.id)).size, 42);
  assert.equal(new Set(current.map((item) => item.action)).size, 42);
  for (const item of current) {
    assert.match(item.id, uuid);
    assert.equal(item.role_template_id, primary.roleId);
    assert.equal(item.scope, 'DEPARTMENT');
  }
  for (const item of original)
    assert.deepEqual(
      current.find((row) => row.id === item.id),
      item,
    );
  const additions = current.filter(
    (row) => !original.some((item) => item.id === row.id),
  );
  assert.deepEqual(sortedGrants(additions), sortedGrants(insertedGrants));
  const missing = authorizedActions.filter(
    (action) => !original.some((item) => item.action === action),
  );
  assert.equal(missing.length, 7);
  assert.deepEqual(
    additions.map((row) => row.action).sort(),
    [...missing].sort(),
  );
  assert.deepEqual(
    [...input.insertedGrantIds].sort(),
    additions.map((row) => row.id).sort(),
  );
  assert.equal(new Set(input.insertedGrantIds).size, 7);
  assert.equal(
    receipt.result,
    'PASS_ORIGINAL_R2_RESUMED_AND_MAIN_WRITE_ROLE42',
  );
  assert.equal(receipt.actorId, primary.userId);
  assert.equal(receipt.roleId, primary.roleId);
  assert.equal(receipt.departmentId, primary.departmentId);
  assert.equal(receipt.four.sourceMessage, approvalMessages[0]);
  assert.equal(receipt.three.sourceMessage, approvalMessages[1]);
  assert.deepEqual(
    sortedGrants([...receipt.four.inserted, ...receipt.three.inserted]),
    sortedGrants(additions),
  );
  assert.equal(receipt.only7RoleGrantsAdded, true);
  assert.equal(receipt.all149TablesPreviousRowsPreserved, true);
  assert.equal(receipt.passwordVerifiedAgainstUnchangedHash, true);
  assert.equal(receipt.credentialReset, false);
  assert.equal(receipt.actorRecreated, false);
  assert.equal(receipt.otherRolesChanged, false);
  return input;
}

function readAdmission(root, allowTerminal = false) {
  try {
    if (terminal && !allowTerminal) throw new Error('Terminal actor');
    const base = resolve(root, '.local/ui003-evidence');
    const input = JSON.parse(
      readFileSync(resolve(base, 'section-record-ui-run.json'), 'utf8'),
    );
    const candidate = {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
    };
    assert.equal(
      execFileSync(
        'git',
        ['status', '--porcelain', '--untracked-files=normal'],
        { cwd: root, encoding: 'utf8' },
      ).trim(),
      '',
    );
    const originBytes = readFileSync(resolve(base, 'ui-actor-origin.json'));
    const originManifestBytes = readFileSync(
      resolve(base, 'ui-origin-manifest.json'),
    );
    assert.equal(
      sha(originManifestBytes),
      'a5307e17af39d842c1ed01b59acae261de8eee16a5454685a8d9137978c340af',
    );
    const originEntry = JSON.parse(
      originManifestBytes.toString('utf8'),
    ).files.filter((item) => item.path === 'H-owned-object-delta.json');
    assert.equal(originEntry.length, 1);
    assert.equal(originEntry[0].sha256, originHash);
    assert.equal(originEntry[0].bytes, originBytes.length);
    const credentialBytes = readFileSync(
      resolve(base, 'ui-credential-proof.json'),
    );
    assert.equal(sha(originBytes), originHash);
    assert.equal(sha(credentialBytes), input.credentialProofSha256);
    const receiptBytes = readFileSync(resolve(base, 'ui-grant-receipt.json'));
    assert.equal(
      sha(receiptBytes),
      'df1b29f2e618d7c54f0e6960d5c03a39fb2a6ca03cfcf6e8e347457cc7f6bed0',
    );
    validateSectionRecordUiAdmission(
      input,
      JSON.parse(originBytes.toString('utf8')),
      JSON.parse(credentialBytes.toString('utf8')),
      candidate,
      JSON.parse(receiptBytes.toString('utf8')),
    );
    assert.ok(
      existsSync(privatePath),
      'Original private credential is unavailable',
    );
    if (!(terminal && allowTerminal)) {
      assert.ok(
        !existsSync(
          resolve(base, `section-record-ui-terminal-${input.runId}.json`),
        ),
        'Existing actor is terminal or revocation is unresolved',
      );
    }
    return input;
  } catch {
    throw new SectionRecordUiPermissionPending();
  }
}
export function assertSectionRecordUiSourceReady(root = process.cwd()) {
  readAdmission(root);
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

// Pure validation of caller-supplied evidence preserves the exact binding/158
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
    158,
    'UI source is not the complete 158 chain',
  );
  assert.deepEqual(
    proof.migrations.slice(-4).map((m) => m.name),
    tail,
    'Unexpected UI source migration tail',
  );
  assert.equal(new Set(proof.migrations.map((m) => m.name)).size, 158);
  for (const migration of proof.migrations)
    assert.match(migration.checksum, /^[a-f0-9]{64}$/u);
  assert.equal(
    proof.migrations[157].checksum,
    repairChecksum,
    'UI material guard repair source bytes changed',
  );
  assert.deepEqual(
    proof.identity,
    [{ db: 'dev_cor_test', schema: 'public', username: 'dev_cor_test' }],
    'Unexpected UI database identity',
  );
  assert.equal(
    proof.applied.length,
    158,
    'UI R2 is not migrated to 158; runner approval is required',
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

async function objects(client) {
  const result = {};
  for (const [name, table, column, id] of [
    ['user', 'user_accounts', 'id', primary.userId],
    ['role', 'role_templates', 'id', primary.roleId],
    ['assignments', 'role_assignments', 'user_id', primary.userId],
    ['memberships', 'department_memberships', 'user_id', primary.userId],
    ['credential', 'local_credentials', 'user_id', primary.userId],
  ])
    result[name] = (
      await client.query(
        `SELECT to_jsonb(t) AS row FROM "${table}" t WHERE "${column}"=$1 ORDER BY id`,
        [id],
      )
    ).rows.map((entry) => entry.row);
  return result;
}

async function withDatabase(operation, allowTerminal = false) {
  const root = process.cwd();
  const admission = readAdmission(root, allowTerminal);
  const connectionString = assertSectionRecordUiBinding();
  // Runtime imports are reached only after exact sealed manifest admission.
  const { captureTestEnvironment, validateBrowserTestDatabaseUrl } =
    await import('../../scripts/test-environment.mjs');
  const captured = captureTestEnvironment(root, { pnpmVersion: '11.27.0' });
  const target = validateBrowserTestDatabaseUrl(connectionString, root);
  const directory = resolve(root, 'backend/prisma/migrations');
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  const migrations = await Promise.all(
    names.map(async (name) => ({
      name,
      checksum: sha(await readFile(resolve(directory, name, 'migration.sql'))),
    })),
  );
  const requireBackend = createRequire(resolve(root, 'backend/package.json'));
  const { Client } = requireBackend('pg');
  const client = new Client({ connectionString });
  try {
    await client.connect();
    assertSectionRecordUiDatabaseProof(process.env, {
      capturedDatabaseUrl: captured.childEnvironment.DATABASE_URL,
      validatedDatabaseUrl: target.connectionString,
      migrations,
      identity: (
        await client.query(
          'SELECT current_database() AS db,current_schema() AS schema,current_user AS username',
        )
      ).rows,
      applied: (
        await client.query(
          'SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name',
        )
      ).rows,
    });
    const current = await objects(client);
    assert.ok(
      Object.values(current).every((rows) => rows.length === 1),
      'Existing H identity relationships changed',
    );
    assert.ok(
      current.user[0].active &&
        current.role[0].active &&
        current.memberships[0].active,
      'Inactive H identity',
    );
    assert.ok(
      current.assignments[0].id === primary.assignmentId &&
        current.memberships[0].id === primary.membershipId &&
        current.credential[0].id === admission.actor.credentialId,
      'Existing H relationship changed',
    );
    assert.ok(
      current.role[0].department_id === primary.departmentId &&
        current.assignments[0].user_id === primary.userId &&
        current.assignments[0].role_template_id === primary.roleId &&
        current.assignments[0].department_id === primary.departmentId &&
        current.memberships[0].user_id === primary.userId &&
        current.memberships[0].department_id === primary.departmentId &&
        current.credential[0].user_id === primary.userId,
      'Existing H relationship mismatch',
    );
    assert.equal(
      current.assignments[0].active,
      !(terminal && allowTerminal),
      'H assignment state changed',
    );
    assert.ok(
      digest(current) ===
        (terminal && allowTerminal
          ? terminalObjectsHash
          : admission.objectsSha256),
      'Existing H identity fingerprint changed',
    );
    const grants = (
      await client.query(
        'SELECT id,role_template_id,action::text AS action,scope::text AS scope FROM role_grants WHERE role_template_id=$1 ORDER BY id',
        [primary.roleId],
      )
    ).rows;
    assert.deepEqual(
      sortedGrants(grants),
      sortedGrants(admission.currentGrants),
      'H current Grants differ from approved42',
    );
    return await operation(client, admission);
  } finally {
    await client.end();
  }
}
export async function withSectionRecordUiDatabase(operation) {
  return withDatabase(operation);
}
export async function assertSectionRecordUiRunner() {
  await withDatabase(async () => {});
}
let scenario;
export async function createSectionRecordUiActor(scenarioId) {
  await assertSectionRecordUiRunner();
  assert.ok(
    typeof scenarioId === 'string' && scenarioId.length > 0,
    'UI scenario identity required',
  );
  scenario = sha(scenarioId);
  // Only the runner executing this fixture reads its original Temp credential.
  // Neither config admission nor offline tests read/copy the private payload.
  const bytes = readFileSync(privatePath);
  assert.ok(sha(bytes) === privateHash, 'Original private credential changed');
  const credential = JSON.parse(bytes.toString('utf8'));
  assert.ok(
    credential.actorId === primary.userId &&
      credential.roleId === primary.roleId &&
      credential.departmentId === primary.departmentId,
    'Original private identity changed',
  );
  assert.ok(
    typeof credential.username === 'string' &&
      /^historical-record-[a-f0-9-]{36}$/u.test(credential.username) &&
      typeof credential.password === 'string' &&
      credential.password.length > 0,
    'Original credential unavailable',
  );
  const actor = Object.freeze({
    ...primary,
    ...credential,
    ...readAdmission(process.cwd()).fixture,
  });
  actors.set(actor.userId, actor);
  return actor;
}
export function sectionRecordUiFixture() {
  const admission = readAdmission(process.cwd());
  assert.ok(
    actors.has(primary.userId) && scenario,
    'Restore the existing actor first',
  );
  return {
    ...admission.fixture,
    ...primary,
    sourcePrefix: `section-record-ui:${admission.runId}:${scenario}:`,
  };
}
async function assertOwned(client, caseId) {
  const owned = cases.get(caseId);
  assert.ok(owned, 'Only this run verified case may be read');
  const rows = (
    await client.query(
      'SELECT c.id FROM cases c JOIN case_external_entries e ON e.case_id=c.id WHERE c.id=$1 AND c.department_id=$2 AND e.recorded_by_user_id=$3 AND e.source=$4',
      [caseId, primary.departmentId, primary.userId, owned.source],
    )
  ).rows;
  assert.equal(rows.length, 1, 'UI exact source ownership changed');
}
export async function ownSectionRecordUiCase(caseId, actorUserId, source) {
  assertSectionRecordUiSourceReady();
  assert.match(caseId, uuid);
  assert.equal(actorUserId, primary.userId);
  assert.ok(actors.has(actorUserId), 'Only restored H primary is allowed');
  assert.ok(
    typeof source === 'string' &&
      source.startsWith(sectionRecordUiFixture().sourcePrefix),
    'Wrong run/scenario source',
  );
  await withDatabase(async (client) => {
    const rows = (
      await client.query(
        'SELECT c.id FROM cases c JOIN case_external_entries e ON e.case_id=c.id WHERE c.id=$1 AND c.department_id=$2 AND e.recorded_by_user_id=$3 AND e.source=$4',
        [caseId, primary.departmentId, actorUserId, source],
      )
    ).rows;
    assert.equal(
      rows.length,
      1,
      'UI source was not appended by exact run actor',
    );
  });
  cases.set(caseId, { source });
}
export async function revokeSectionRecordUiActor(userId) {
  assertSectionRecordUiSourceReady();
  assert.equal(userId, primary.userId);
  assert.ok(
    actors.has(userId) && !terminal,
    'Only restored primary may become terminal',
  );
  await withDatabase(async (client, admission) => {
    // Persist intent before the write. A lost/failed result cannot silently make
    // another process reuse this shared identity or restore its assignment.
    writeFileSync(
      resolve(
        process.cwd(),
        '.local/ui003-evidence',
        `section-record-ui-terminal-${admission.runId}.json`,
      ),
      JSON.stringify({
        runId: admission.runId,
        ...primary,
        candidate: admission.candidate,
        state: 'REVOCATION_REQUESTED_VERIFY_OUTCOME',
      }),
      { flag: 'wx' },
    );
    terminal = true;
    const result = await client.query(
      'UPDATE role_assignments SET active=false,version=version+1,updated_at=now() WHERE id=$1 AND user_id=$2 AND role_template_id=$3 AND department_id=$4 AND active=true',
      [primary.assignmentId, userId, primary.roleId, primary.departmentId],
    );
    assert.equal(result.rowCount, 1, 'Exact primary assignment was not active');
    terminalObjectsHash = digest(await objects(client));
  });
}
export async function sectionRecordUiBaselineSecurity() {
  return withDatabase(async (client) => {
    const result = {};
    const users = [1, 2, 3].map(
      (n) => `20000000-0000-4000-8000-00000000000${n}`,
    );
    const roles = [1, 2, 3].map(
      (n) => `30000000-0000-4000-8000-00000000000${n}`,
    );
    for (const [table, column, ids] of [
      ['user_accounts', 'id', users],
      ['local_credentials', 'user_id', users],
      ['auth_sessions', 'user_id', users],
      ['department_memberships', 'user_id', users],
      ['role_assignments', 'user_id', users],
      ['role_templates', 'id', roles],
      ['role_grants', 'role_template_id', roles],
    ]) {
      const rows = (
        await client.query(
          `SELECT to_jsonb(t) AS row FROM "${table}" t WHERE "${column}"=ANY($1::uuid[]) ORDER BY to_jsonb(t)::text`,
          [ids],
        )
      ).rows;
      if (table === 'role_grants')
        assert.equal(
          rows.length,
          66,
          'Preserved baseline Grant cohort changed',
        );
      result[table] = digest(rows);
    }
    return result;
  }, terminal);
}
export async function sectionRecordUiUploads(caseId) {
  assertSectionRecordUiSourceReady();
  assert.ok(cases.has(caseId), 'Only this run upload case may be inspected');
  return withDatabase(async (client) => {
    await assertOwned(client, caseId);
    return (
      await client.query(
        `SELECT v.id AS "versionId",d.id AS "draftId",d.case_section_record_target_id AS "targetId",d.case_section_record_revision AS revision,case_section_upload_has_first_freeze(v.id) AS "firstFreeze" FROM content_versions v JOIN upload_drafts d ON d.id=v.case_section_record_upload_draft_id WHERE d.owner_type='CASE' AND d.owner_id=$1 AND d.department_id=$2 ORDER BY v.id`,
        [caseId, primary.departmentId],
      )
    ).rows;
  });
}

// Frozen workflow facts are compared separately from append-only record corrections.
// No INSERT/UPDATE/DELETE of cases, facts, materials, receipts, migrations, or baseline security.
export async function sectionRecordUiSnapshot(caseId) {
  readAdmission(process.cwd(), terminal);
  assert.ok(
    cases.has(caseId),
    'Only this run verified external case may be read',
  );
  return withDatabase(async (client) => {
    await assertOwned(client, caseId);
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
  }, terminal);
}
