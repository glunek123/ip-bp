import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  assertExecutionFilingFollowupHistoricalFailure,
  assertExecutionFilingFollowupResolveArtifacts,
} from './case-execution-filing-followup-database.mjs';

const root = resolve(process.cwd());
const expectedInstance = Object.freeze({
  project: 'dev-cor-ui003-r2',
  containerId:
    '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
  host: '127.0.0.1',
  port: 15438,
  database: 'dev_cor_test',
  migrationCount: 165,
});
const creationReceiptInstance = Object.freeze({
  ...expectedInstance,
  migrationCount: 161,
});
const creationReceiptPins = Object.freeze({
  '20261015150000_case_section_record_edits':
    '10760cf6e9969822a6b6a631760645625d227c4541a018560473e34c164953c7',
  '20261015170000_case_section_record_uploads':
    '883f2f80b615a0f746adb2ebbb6e17cc24d0ac577a61d236f3bb6375fbc0367d',
  '20261016090000_case_record_material_guard_repair':
    'dfe31436055f7ab9bf8d0796c48b3a0dd38a16acf4e5b3554e04e3d299b7b869',
  '20261016093000_case_record_material_reference_reuse':
    '628a0fc0a664942896fdd85e3811bfe977702e4924ef33a58f83399a9bf8280e',
  '20261016100000_case_execution_filing_followups':
    'e125a3278b0530860b1be49273fc667224451f8a6d35b420bdf14e2b9c684105',
  '20261016110000_lead_batch_push':
    '1e267e104e4a7a1b20f1014dfd10506ce1aa831e32a11175e3a4dde2430c9e87',
});
const migrationPins = Object.freeze({
  ...creationReceiptPins,
  '20261016095000_execution_supplement_enum_preparation':
    'f9a18c2d93ac3bb75debac0835eee32dd9896fff267c1fa7275c959bddfeac5f',
  '20261016115000_fee_proof_category_prepare':
    'a7b80c1143035aa0526fcb6a90857a737e505b692c2ea95efd7ff3f465e9f4d4',
  '20261016120000_settlement_demo_alignment':
    'fbb81d7cb424beb9b1bad103a498c2bee66c1e7c15ef806d47631b5685a810e7',
  '20261016130000_evidence_demo_alignment':
    'fd138a179438bac39a7bf30bc31373ac4ca2b9eef454ef8229c78ab0a1135de9',
});
const h42 = Object.freeze({
  actorId: 'edc8bf6f-6660-41f6-8418-f72f87443a1c',
  roleId: '51c34a8b-fb00-45b1-ab9f-d077d59d4878',
  departmentId: '10000000-0000-4000-8000-000000000001',
  assignmentId: '8bed4da1-c61e-40d9-bd78-170380421ce8',
  membershipId: '36ea4166-dce8-48bd-bb9b-216222f0ea2a',
  credentialId: 'f695cb82-e0d1-4dcc-9135-d1e3c75ecc8b',
  credentialProofPath:
    'C:\\Users\\97830\\AppData\\Local\\Temp\\dev-cor-h-actor-recovery-83ac59ee-1b96-4fde-b1b8-534061a36ed0\\actor.private.json',
  credentialProofSha256:
    'd9367f33ac67ad2353648ade02b3c110aaa1785a51944207882de56e34a94de1',
  actions: Object.freeze([
    'customer.read',
    'lead.read',
    'lead.create',
    'lead.push',
  ]),
});
const fixtureIds = Object.freeze({
  customerId: '50000000-0000-4000-8000-000000000002',
  rightsHolderId: '60000000-0000-4000-8000-000000000001',
  departmentId: h42.departmentId,
});
const requiredActions = Object.freeze([
  'customer.read',
  'lead.read',
  'lead.create',
  'lead.push',
]);
const terminalIdentity = Object.freeze({
  userId: 'eecec2c7-068c-4515-b737-0846aedc2bb1',
  roleId: '4ab4e231-9e37-4f89-a745-66406623f2be',
  assignmentId: 'aa236b93-2976-49cf-83da-b2b9722e55fd',
  membershipId: '589c5130-c537-43fa-8912-c605cf7325d4',
  credentialId: 'dd736c74-220a-4809-8574-0b516cd526dd',
  departmentId: fixtureIds.departmentId,
  grantIds: Object.freeze({
    'customer.read': '1f41d658-19ee-4fd4-a193-8cb5e1d2b970',
    'lead.read': '0b11e49e-c94c-4f3b-b7e8-b1163ed775e2',
    'lead.create': '7d196e5e-1c89-44f7-9d25-b2632c7b9bad',
    'lead.push': 'a0e8a262-375f-427f-80e5-0c76ccb91e7a',
  }),
});
const creationReceiptPath =
  '.local/uxq03-evidence/lead-batch-push-terminal-creation-receipt.json';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256 = /^[0-9a-f]{64}$/u;

export const leadBatchPushLimits = Object.freeze({
  maxItemsPerBatch: 20,
  maxNewLeads: 40,
  maxBatchReceipts: 10,
  maxCreateReceipts: 40,
  maxLeadCreateAudits: 40,
  maxLeadPushAudits: 40,
});

function fail(message) {
  throw new Error(`UXQ03 batch push BLOCKED: ${message}`);
}

export function validateLeadBatchPushBinding(environment) {
  const rawDatabaseUrl = environment.DEV_COR_TEST_DATABASE_URL;
  if (
    typeof rawDatabaseUrl !== 'string' ||
    rawDatabaseUrl.includes('?') ||
    rawDatabaseUrl.includes('#')
  )
    fail('R2 database URL must not contain a query or fragment');
  let target;
  try {
    target = new URL(rawDatabaseUrl);
  } catch {
    fail('R2 test database URL is missing or invalid');
  }
  if (
    environment.NODE_ENV !== 'test' ||
    !/\bpnpm\/11\.27\.0\b/u.test(environment.npm_config_user_agent ?? '') ||
    environment.DEV_COR_TEST_DATABASE_PROJECT !== expectedInstance.project ||
    environment.DEV_COR_TEST_DATABASE_CONTAINER_ID !==
      expectedInstance.containerId ||
    environment.DATABASE_URL !== environment.DEV_COR_TEST_DATABASE_URL ||
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    target.hostname !== expectedInstance.host ||
    target.port !== String(expectedInstance.port) ||
    target.username !== 'dev_cor_test' ||
    target.pathname !== `/${expectedInstance.database}` ||
    target.href.includes('?') ||
    target.href.includes('#')
  )
    fail('the normal protected runner and exact R2 tuple are required');
  return Object.freeze({ ...expectedInstance });
}

export function validateLeadBatchPushMigrationSource(migrations) {
  if (
    !Array.isArray(migrations) ||
    migrations.length !== expectedInstance.migrationCount
  )
    fail('all 165 migration sources are required');
  const ordered = [...migrations].sort((a, b) => a.name.localeCompare(b.name));
  for (const [index, item] of ordered.entries()) {
    if (
      item.name !== migrations[index]?.name ||
      (index > 0 && item.name <= ordered[index - 1].name) ||
      !/^\d{14}_[a-z0-9_]+$/u.test(item.name) ||
      !/^[0-9a-f]{64}$/u.test(item.checksum)
    )
      fail('the full migration source chain must be ordered and valid');
  }
  for (const [name, checksum] of Object.entries(migrationPins)) {
    if (
      !ordered.some((item) => item.name === name && item.checksum === checksum)
    )
      fail(`migration source pin mismatch: ${name}`);
  }
  if (ordered.at(-1)?.name !== '20261016130000_evidence_demo_alignment')
    fail('the complete 156-165 source chain is required');
  return ordered;
}

export function validateLeadBatchPushMigrationLedger(
  applied,
  migrations,
  evidence,
) {
  const source = validateLeadBatchPushMigrationSource(migrations);
  const historicalId = '9f547970-6eaa-4628-a670-f505590482e9';
  if (!Array.isArray(applied) || applied.length !== source.length + 1)
    fail('the complete 165 source/applied migration ledger is required');
  const historical = applied.filter((row) => row.id === historicalId);
  if (historical.length !== 1)
    fail('the one exact EF001 historical failure is required');
  try {
    assertExecutionFilingFollowupHistoricalFailure(
      historical[0],
      'RESOLVED',
      evidence?.receipt,
    );
    assertExecutionFilingFollowupResolveArtifacts(
      evidence?.receipt,
      evidence?.stdout,
      evidence?.stderr,
    );
  } catch {
    fail(
      'the exact officially resolved EF001 failure and artifacts are required',
    );
  }
  const successful = applied.filter((row) => row !== historical[0]);
  if (
    successful.some(
      (row, index) =>
        !uuid.test(row.id ?? '') ||
        row.migration_name !== source[index].name ||
        row.checksum !== source[index].checksum ||
        !row.finished_at ||
        row.rolled_back_at !== null,
    ) ||
    new Set(applied.map((row) => row.id)).size !== applied.length
  )
    fail('the complete 165 source/applied migration ledger does not match');
  return true;
}

async function readOfficialEfResolveEvidence() {
  const directory = resolve(
    root,
    '.local/ef001-evidence/official-ef001-resolve',
  );
  try {
    const [receiptBytes, stdout, stderr] = await Promise.all([
      readFile(resolve(directory, 'receipt.json')),
      readFile(resolve(directory, 'stdout.log')),
      readFile(resolve(directory, 'stderr.log')),
    ]);
    const receipt = JSON.parse(receiptBytes.toString('utf8'));
    assertExecutionFilingFollowupResolveArtifacts(receipt, stdout, stderr);
    return { receipt, stdout, stderr };
  } catch {
    fail('the exact official EF001 resolve artifacts are unavailable');
  }
}

function canonical(value) {
  return Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
}

function sameShape(actual, expected) {
  return (
    JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected))
  );
}

function h42ManifestIdentity() {
  return Object.freeze({
    userId: h42.actorId,
    roleId: h42.roleId,
    assignmentId: h42.assignmentId,
    membershipId: h42.membershipId,
    credentialId: h42.credentialId,
    departmentId: h42.departmentId,
  });
}

function expectedTerminalCreationObjects() {
  return {
    userAccounts: [
      { id: terminalIdentity.userId, accountType: 'INTERNAL', active: true },
    ],
    localCredentials: [
      { id: terminalIdentity.credentialId, userId: terminalIdentity.userId },
    ],
    departmentMemberships: [
      {
        id: terminalIdentity.membershipId,
        userId: terminalIdentity.userId,
        departmentId: terminalIdentity.departmentId,
        active: true,
        teamId: null,
      },
    ],
    roleTemplates: [
      {
        id: terminalIdentity.roleId,
        departmentId: terminalIdentity.departmentId,
        name: 'UXQ03 Lead Batch Terminal',
        active: true,
      },
    ],
    roleAssignments: [
      {
        id: terminalIdentity.assignmentId,
        userId: terminalIdentity.userId,
        roleTemplateId: terminalIdentity.roleId,
        departmentId: terminalIdentity.departmentId,
        active: true,
        teamId: null,
      },
    ],
    roleGrants: requiredActions.map((action) => ({
      id: terminalIdentity.grantIds[action],
      roleTemplateId: terminalIdentity.roleId,
      action,
      scope: 'DEPARTMENT',
    })),
  };
}

export function validateLeadBatchPushManifest(manifest) {
  if (
    manifest === null ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    manifest.version !== 1 ||
    manifest.cohort !== 'uxq03-lead-batch-push-20261016' ||
    !uuidV4.test(manifest.runId ?? '') ||
    !sha256.test(manifest.creationReceiptSha256 ?? '')
  )
    fail(
      'the fixed runner manifest and terminal creation receipt are required',
    );
  if (
    Object.keys(manifest).sort().join(',') !==
      'cohort,creationReceiptSha256,runId,terminal,version' ||
    manifest.terminal === null ||
    typeof manifest.terminal !== 'object' ||
    Array.isArray(manifest.terminal) ||
    Object.keys(manifest.terminal).sort().join(',') !==
      'assignmentId,credentialId,departmentId,grantIds,membershipId,roleId,userId' ||
    !sameShape(manifest.terminal.grantIds, terminalIdentity.grantIds)
  )
    fail('the fixed single-terminal actor manifest contains unexpected fields');
  if (!sameShape(manifest.terminal, terminalIdentity))
    fail(
      'terminal actor IDs and four grant IDs must match the source-pinned cohort',
    );
  return Object.freeze({
    version: manifest.version,
    cohort: manifest.cohort,
    runId: manifest.runId,
    creationReceiptSha256: manifest.creationReceiptSha256,
    main: h42ManifestIdentity(),
    terminal: terminalIdentity,
  });
}

export function validateLeadBatchPushCreationReceipt(
  receipt,
  receiptSha256,
  { runId, creationReceiptSha256, candidateCommit },
) {
  const expectedV1 = {
    version: 1,
    cohort: 'uxq03-lead-batch-push-20261016',
    runId,
    candidateCommit,
    r2: creationReceiptInstance,
    migrationPins: Object.entries(creationReceiptPins).map(
      ([name, checksum]) => ({
        name,
        checksum,
      }),
    ),
    mainH42Unchanged: {
      ...h42ManifestIdentity(),
      actions: [...h42.actions],
      credentialProofPath: h42.credentialProofPath,
      credentialProofSha256: h42.credentialProofSha256,
      originalCredentialUnchanged: true,
    },
    newObjects: expectedTerminalCreationObjects(),
  };
  const beforeObjects = Object.fromEntries(
    Object.keys(expectedV1.newObjects).map((name) => [name, []]),
  );
  const expectedV2 = {
    ...expectedV1,
    version: 2,
    creationMode: 'NEW_PUBLIC165',
    r2: expectedInstance,
    migrationPins: Object.entries(migrationPins)
      .map(([name, checksum]) => ({ name, checksum }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    beforeObjects,
    objectDiffSha256: createHash('sha256')
      .update(
        JSON.stringify(
          canonical({ beforeObjects, newObjects: expectedV1.newObjects }),
        ),
      )
      .digest('hex'),
  };
  const expected = receipt?.version === 2 ? expectedV2 : expectedV1;
  if (
    !sha256.test(receiptSha256 ?? '') ||
    receiptSha256 !== creationReceiptSha256 ||
    !sameShape(receipt, expected)
  )
    fail(
      'fixed terminal creation receipt hash, source, R2 tuple, or exact object diff mismatch',
    );
  return receipt;
}

async function readTerminalCreationReceipt(manifest) {
  let bytes;
  try {
    bytes = await readFile(resolve(root, creationReceiptPath));
  } catch {
    fail('the fixed terminal creation receipt is unavailable');
  }
  let receipt;
  try {
    receipt = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('the fixed terminal creation receipt is invalid JSON');
  }
  let candidateCommit;
  try {
    candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    fail('the protected source candidate commit cannot be resolved');
  }
  return validateLeadBatchPushCreationReceipt(
    receipt,
    createHash('sha256').update(bytes).digest('hex'),
    {
      runId: manifest.runId,
      creationReceiptSha256: manifest.creationReceiptSha256,
      candidateCommit,
    },
  );
}

export function validateLeadBatchPushFaultScope(
  scope,
  preparedIdentity,
  allowedFreshLeadIds,
) {
  if (
    !scope ||
    typeof scope !== 'object' ||
    !preparedIdentity ||
    preparedIdentity.actorUserId !== h42.actorId ||
    preparedIdentity.departmentId !== fixtureIds.departmentId ||
    scope.actorUserId !== h42.actorId ||
    scope.departmentId !== fixtureIds.departmentId ||
    !uuidV4.test(scope.idempotencyKey ?? '') ||
    !Array.isArray(scope.leadIds) ||
    scope.leadIds.length < 1 ||
    scope.leadIds.length > leadBatchPushLimits.maxItemsPerBatch ||
    scope.leadIds.some((id) => !uuidV4.test(id)) ||
    new Set(scope.leadIds.map((id) => id.toLowerCase())).size !==
      scope.leadIds.length ||
    !(allowedFreshLeadIds instanceof Set) ||
    scope.leadIds.some((id) => !allowedFreshLeadIds.has(id.toLowerCase()))
  )
    fail(
      'fault scope must contain only this run registered fresh H42 fixture leads',
    );
  return Object.freeze({
    actorUserId: h42.actorId,
    departmentId: fixtureIds.departmentId,
    idempotencyKey: scope.idempotencyKey,
    leadIds: Object.freeze([...scope.leadIds]),
  });
}

export function validateLeadBatchPushFaultMarker(before, after) {
  if (
    before?.is_called !== false ||
    Number(before?.last_value) !== 1 ||
    after?.is_called !== true ||
    Number(after?.last_value) !== 1
  )
    fail(
      'receipt fault trigger marker must advance exactly once from a fresh sequence',
    );
  return true;
}

export function validateLeadBatchPushFixture(rows) {
  if (!Array.isArray(rows) || rows.length !== 1)
    fail('the existing synthetic customer/client fixture is unavailable');
  const row = rows[0];
  if (
    row.customerId !== fixtureIds.customerId ||
    row.rightsHolderId !== fixtureIds.rightsHolderId ||
    row.departmentId !== fixtureIds.departmentId ||
    row.profileStatus !== 'ADMITTED' ||
    row.cooperationStatus !== 'COOPERATING' ||
    !row.clientBindingActive
  )
    fail(
      'the admitted customer, rights-holder link, cooperation, and active client binding are required',
    );
  return Object.freeze({
    customerId: row.customerId,
    rightsHolderId: row.rightsHolderId,
    departmentId: row.departmentId,
  });
}

async function sourceMigrations() {
  const directory = resolve(root, 'backend/prisma/migrations');
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      checksum: createHash('sha256')
        .update(await readFile(resolve(directory, name, 'migration.sql')))
        .digest('hex'),
    })),
  );
}

function parseManifest(environment) {
  try {
    return validateLeadBatchPushManifest(
      JSON.parse(environment.UXQ03_BATCH_PUSH_MANIFEST ?? 'null'),
    );
  } catch (error) {
    if (error instanceof SyntaxError)
      fail('the fixed runner manifest is invalid JSON');
    throw error;
  }
}

function parseCredentials(environment) {
  let credentials;
  try {
    credentials = JSON.parse(
      environment.UXQ03_BATCH_PUSH_CREDENTIALS ?? 'null',
    );
  } catch {
    fail('the protected runner credentials are missing');
  }
  if (
    !credentials ||
    typeof credentials.main?.username !== 'string' ||
    !credentials.main.username ||
    typeof credentials.main?.password !== 'string' ||
    !credentials.main.password ||
    typeof credentials.terminal?.username !== 'string' ||
    !credentials.terminal.username ||
    typeof credentials.terminal?.password !== 'string' ||
    !credentials.terminal.password
  )
    fail('the protected runner credentials are incomplete');
  return credentials;
}

function defaultDependencies() {
  const requireBackend = createRequire(resolve(root, 'backend/package.json'));
  return {
    migrations: sourceMigrations,
    capture: async () => {
      const { captureTestEnvironment } =
        await import('../../scripts/test-environment.mjs');
      const version = (process.env.npm_config_user_agent ?? '').match(
        /\bpnpm\/([^\s]+)/u,
      )?.[1];
      return captureTestEnvironment(root, { pnpmVersion: version });
    },
    open: (connectionString) =>
      new (requireBackend('pg').Client)({ connectionString }),
  };
}

export function createLeadBatchPushDatabaseSupport(overrides) {
  const dependencies = overrides ?? defaultDependencies();
  let preparedRun;
  let faultInstalledOnce = false;
  const leadCreationReservations = new Map();
  const allowedFreshLeadIds = new Set();

  async function prepare() {
    const environment = process.env;
    validateLeadBatchPushBinding(environment);
    const manifest = parseManifest(environment);
    const credentials = parseCredentials(environment);
    const migrations = validateLeadBatchPushMigrationSource(
      await dependencies.migrations(),
    );
    await readTerminalCreationReceipt(manifest);
    const efResolveEvidence = await readOfficialEfResolveEvidence();
    const captured = await dependencies.capture();
    if (
      captured?.childEnvironment?.DATABASE_URL !== environment.DATABASE_URL ||
      captured?.childEnvironment?.DEV_COR_TEST_DATABASE_CONTAINER_ID !==
        expectedInstance.containerId
    )
      fail('protected environment capture does not match R2');
    const client = dependencies.open(environment.DATABASE_URL);
    await client.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const identity = (
        await client.query(
          'SELECT current_database() AS db, current_schema() AS schema, current_user AS db_user',
        )
      ).rows[0];
      if (
        identity?.db !== expectedInstance.database ||
        identity?.schema !== 'public' ||
        identity?.db_user !== 'dev_cor_test'
      )
        fail('connected PostgreSQL identity does not match R2');
      const applied = (
        await client.query(
          'SELECT id,migration_name,checksum,started_at::text,finished_at::text,rolled_back_at::text,applied_steps_count,(logs IS NULL) AS logs_is_null FROM public._prisma_migrations ORDER BY migration_name,started_at',
        )
      ).rows;
      validateLeadBatchPushMigrationLedger(
        applied,
        migrations,
        efResolveEvidence,
      );

      const h42Rows = (
        await client.query(
          `SELECT assignment.id::text AS assignment_id,
                  membership.id::text AS membership_id,
                  g.action::text AS action, g.scope::text AS scope,
                  membership.team_id::text AS actor_team_id
           FROM public.role_assignments assignment
           JOIN public.role_templates role ON role.id=assignment.role_template_id
           JOIN public.role_grants g ON g.role_template_id=role.id
           JOIN public.user_accounts account ON account.id=assignment.user_id
           JOIN public.department_memberships membership
             ON membership.user_id=assignment.user_id
            AND membership.department_id=assignment.department_id
           WHERE assignment.user_id=$1::uuid AND assignment.role_template_id=$2::uuid
             AND assignment.department_id=$3::uuid AND assignment.active
             AND role.active AND membership.active AND account.active`,
          [h42.actorId, h42.roleId, h42.departmentId],
        )
      ).rows;
      if (
        h42Rows.length === 0 ||
        h42Rows.some(
          (row) =>
            row.assignment_id !== h42.assignmentId ||
            row.membership_id !== h42.membershipId,
        )
      )
        fail(
          'H42 assignment and membership do not match the fixed source identity',
        );
      const h42Actions = new Set(h42Rows.map((row) => row.action));
      if (h42.actions.some((action) => !h42Actions.has(action)))
        fail(
          'H42 current grants no longer contain the four recorded lead actions',
        );
      const h42Credential = (
        await client.query(
          'SELECT id, user_id FROM public.local_credentials WHERE username=$1',
          [credentials.main.username],
        )
      ).rows;
      if (
        h42Credential.length !== 1 ||
        h42Credential[0].id !== h42.credentialId ||
        h42Credential[0].user_id !== h42.actorId
      )
        fail('the existing H42 credential does not match its fixed identity');

      const actor = manifest.terminal;
      const assignments = (
        await client.query(
          `SELECT a.active AS assignment_active, a.role_template_id,
                    u.active AS user_active, u.account_type::text AS account_type,
                    m.id AS membership_id, m.active AS membership_active,
                    r.active AS role_active
             FROM public.role_assignments a
             JOIN public.user_accounts u ON u.id=a.user_id
             JOIN public.department_memberships m
               ON m.user_id=a.user_id AND m.department_id=a.department_id
             JOIN public.role_templates r ON r.id=a.role_template_id
             WHERE a.id=$1::uuid AND a.user_id=$2::uuid AND a.role_template_id=$3::uuid
               AND a.department_id=$4::uuid`,
          [actor.assignmentId, actor.userId, actor.roleId, actor.departmentId],
        )
      ).rows;
      const grants = (
        await client.query(
          `SELECT g.id::text AS id, g.action::text AS action, g.scope::text AS scope
             FROM public.role_grants g JOIN public.role_templates r ON r.id=g.role_template_id
             WHERE r.id=$1::uuid AND r.department_id=$2::uuid AND r.active`,
          [actor.roleId, actor.departmentId],
        )
      ).rows;
      const credential = (
        await client.query(
          'SELECT id, user_id FROM public.local_credentials WHERE username=$1',
          [credentials.terminal.username],
        )
      ).rows;
      if (
        assignments.length !== 1 ||
        !assignments[0].assignment_active ||
        !assignments[0].user_active ||
        assignments[0].account_type !== 'INTERNAL' ||
        assignments[0].membership_id !== actor.membershipId ||
        !assignments[0].membership_active ||
        !assignments[0].role_active ||
        credential.length !== 1 ||
        credential[0].id !== actor.credentialId ||
        credential[0].user_id !== actor.userId ||
        grants.length !== requiredActions.length ||
        grants.some(
          (grant) =>
            actor.grantIds[grant.action] !== grant.id ||
            grant.scope !== 'DEPARTMENT',
        ) ||
        requiredActions.some(
          (action) => !grants.some((grant) => grant.action === action),
        )
      )
        fail(
          'the fixed terminal identity, credential and exact four grants are not live',
        );

      const fixtureRows = (
        await client.query(
          `SELECT c.id AS "customerId", link.rights_holder_id AS "rightsHolderId",
                  c.department_id AS "departmentId", c.profile_status::text AS "profileStatus",
                  c.cooperation_status::text AS "cooperationStatus",
                  c.team_id::text AS "teamId",
                  EXISTS (
                    SELECT 1 FROM public.customer_account_bindings binding
                    JOIN public.user_accounts client ON client.id=binding.user_id
                    WHERE binding.customer_id=c.id AND binding.department_id=c.department_id
                      AND binding.active AND client.active AND client.account_type='CLIENT'
                  ) AS "clientBindingActive"
           FROM public.customers c
           JOIN public.customer_rights_holder_links link
             ON link.customer_id=c.id AND link.department_id=c.department_id
           WHERE c.id=$1::uuid AND link.rights_holder_id=$2::uuid
             AND c.department_id=$3::uuid AND c.deleted_at IS NULL`,
          [
            fixtureIds.customerId,
            fixtureIds.rightsHolderId,
            fixtureIds.departmentId,
          ],
        )
      ).rows;
      const fixture = validateLeadBatchPushFixture(
        fixtureRows[0] ? [fixtureRows[0]] : [],
      );
      const fixtureTeamId = fixtureRows[0].teamId;
      for (const action of h42.actions) {
        const effectiveGrant = h42Rows.some(
          (grant) =>
            grant.action === action &&
            (grant.scope === 'DEPARTMENT' ||
              (grant.scope === 'TEAM' &&
                grant.actor_team_id === fixtureTeamId)),
        );
        if (!effectiveGrant)
          fail('H42 current action scope is not effective for the fixture');
      }
      await client.query('COMMIT');
      preparedRun = Object.freeze({
        actorUserId: h42.actorId,
        departmentId: fixture.departmentId,
        runId: manifest.runId,
        manifest,
      });
      return Object.freeze({
        fixture,
        manifest,
        credentials,
        h42: Object.freeze({ actorId: h42.actorId, roleId: h42.roleId }),
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  }

  async function beginLeadCreation(idempotencyKey) {
    if (!preparedRun || !uuidV4.test(idempotencyKey ?? ''))
      fail(
        'lead creation registration requires the prepared run and a fresh UUID key',
      );
    if (leadCreationReservations.has(idempotencyKey))
      fail('lead creation key has already been reserved in this run');
    validateLeadBatchPushBinding(process.env);
    const captured = await dependencies.capture();
    const client = dependencies.open(captured.childEnvironment.DATABASE_URL);
    await client.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const prior = await client.query(
        `SELECT count(*)::int AS count FROM public.lead_command_receipts
         WHERE department_id=$1::uuid AND actor_user_id=$2::uuid
           AND action='create' AND idempotency_key=$3`,
        [preparedRun.departmentId, preparedRun.actorUserId, idempotencyKey],
      );
      if (prior.rows[0]?.count !== 0)
        fail('lead creation key already has a command receipt');
      await client.query('COMMIT');
      leadCreationReservations.set(
        idempotencyKey,
        Object.freeze({
          runId: preparedRun.runId,
          reservationId: randomUUID(),
          state: 'reserved',
        }),
      );
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  }

  async function registerCreatedLead(idempotencyKey, leadId) {
    const reservation = leadCreationReservations.get(idempotencyKey);
    if (
      !preparedRun ||
      !reservation ||
      reservation.state !== 'reserved' ||
      reservation.runId !== preparedRun.runId ||
      !uuid.test(leadId ?? '')
    )
      fail("lead registration requires this run's reserved create key");
    validateLeadBatchPushBinding(process.env);
    const captured = await dependencies.capture();
    const client = dependencies.open(captured.childEnvironment.DATABASE_URL);
    await client.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const receipt = await client.query(
        `SELECT department_id::text AS department_id,
                actor_user_id::text AS actor_user_id, action,
                idempotency_key, result_lead_id::text AS result_lead_id,
                result_lead_version, result_snapshot
         FROM public.lead_command_receipts
         WHERE department_id=$1::uuid AND actor_user_id=$2::uuid
           AND action='create' AND idempotency_key=$3`,
        [preparedRun.departmentId, preparedRun.actorUserId, idempotencyKey],
      );
      const lead = await client.query(
        `SELECT id::text AS id, department_id::text AS department_id,
                customer_id::text AS customer_id,
                responsible_user_id::text AS responsible_user_id,
                status::text AS status, version
         FROM public.leads WHERE id=$1::uuid`,
        [leadId],
      );
      const audits = await client.query(
        `SELECT id::text AS id FROM public.audit_events
         WHERE department_id=$1::uuid AND actor_user_id=$2::uuid
           AND resource_type='lead' AND resource_id=$3::uuid
           AND action='lead.created'`,
        [preparedRun.departmentId, preparedRun.actorUserId, leadId],
      );
      const row = receipt.rows[0];
      const created = lead.rows[0];
      if (
        receipt.rows.length !== 1 ||
        row.department_id !== preparedRun.departmentId ||
        row.actor_user_id !== preparedRun.actorUserId ||
        row.action !== 'create' ||
        row.idempotency_key !== idempotencyKey ||
        row.result_lead_id !== leadId ||
        row.result_lead_version !== 1 ||
        row.result_snapshot?.id !== leadId ||
        row.result_snapshot?.departmentId !== preparedRun.departmentId ||
        row.result_snapshot?.customerId !== fixtureIds.customerId ||
        row.result_snapshot?.responsibleUserId !== preparedRun.actorUserId ||
        row.result_snapshot?.status !== 'WAITING_PUSH' ||
        row.result_snapshot?.version !== 1 ||
        lead.rows.length !== 1 ||
        created.department_id !== preparedRun.departmentId ||
        created.customer_id !== fixtureIds.customerId ||
        created.responsible_user_id !== preparedRun.actorUserId ||
        created.status !== 'WAITING_PUSH' ||
        created.version !== 1 ||
        audits.rows.length !== 1
      )
        fail(
          'new lead lacks its exact current-run create receipt, lead state, and audit',
        );
      await client.query('COMMIT');
      leadCreationReservations.set(
        idempotencyKey,
        Object.freeze({ ...reservation, state: 'registered', leadId }),
      );
      allowedFreshLeadIds.add(leadId.toLowerCase());
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  }

  async function readFacts(leadIds, actorUserId, keys = []) {
    if (
      !Array.isArray(leadIds) ||
      leadIds.some((id) => !uuid.test(id)) ||
      !uuid.test(actorUserId) ||
      !Array.isArray(keys) ||
      keys.some(
        (key) => typeof key !== 'string' || key.length < 1 || key.length > 128,
      )
    )
      fail('fact snapshot requires UUID lead identifiers');
    validateLeadBatchPushBinding(process.env);
    const captured = await dependencies.capture();
    const client = dependencies.open(captured.childEnvironment.DATABASE_URL);
    await client.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const leads = (
        await client.query(
          'SELECT id::text AS id, status::text AS status, version FROM public.leads WHERE id=ANY($1::uuid[]) ORDER BY id::text',
          [leadIds],
        )
      ).rows;
      const receipts = (
        await client.query(
          `SELECT id::text AS id, idempotency_key, original_request, result_snapshot
           FROM public.lead_batch_push_receipts
           WHERE department_id=$1::uuid AND actor_user_id=$2::uuid
             AND idempotency_key=ANY($3::text[]) ORDER BY idempotency_key`,
          [fixtureIds.departmentId, actorUserId, keys],
        )
      ).rows;
      const audits = (
        await client.query(
          `SELECT resource_id::text AS lead_id, action, count(*)::int AS count
           FROM public.audit_events
           WHERE resource_type='lead' AND resource_id=ANY($1::uuid[])
             AND action IN ('lead.created','lead.pushed')
           GROUP BY resource_id, action ORDER BY resource_id, action`,
          [leadIds],
        )
      ).rows;
      await client.query('COMMIT');
      return Object.freeze({ leads, receipts, audits });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  }

  async function revokeTerminalAssignment(manifest) {
    validateLeadBatchPushBinding(process.env);
    if (!preparedRun || manifest !== preparedRun.manifest)
      fail('assignment revocation requires this run’s prepared fixed manifest');
    const actor = terminalIdentity;
    if (
      actor.userId === h42.actorId ||
      actor.roleId === h42.roleId ||
      actor.departmentId !== h42.departmentId ||
      !requiredActions.every((action) => terminalIdentity.grantIds[action])
    )
      fail(
        'refusing to revoke an assignment outside the dedicated terminal cohort',
      );
    const captured = await dependencies.capture();
    const client = dependencies.open(captured.childEnvironment.DATABASE_URL);
    await client.connect();
    try {
      await client.query('BEGIN');
      const receipts = await client.query(
        `SELECT original_request, result_snapshot FROM public.lead_batch_push_receipts
         WHERE department_id=$1::uuid AND actor_user_id=$2::uuid`,
        [actor.departmentId, actor.userId],
      );
      if (receipts.rows.length !== 1) {
        // A retry must not turn a missing or duplicated receipt into permission to revoke.
        fail(
          'the terminal actor must have exactly one successful batch receipt before assignment revocation',
        );
      }
      const receipt = receipts.rows[0];
      const originalItems = receipt?.original_request?.items;
      const resultItems = receipt?.result_snapshot?.items;
      if (
        !Array.isArray(originalItems) ||
        !Array.isArray(resultItems) ||
        originalItems.length < 1 ||
        originalItems.length > leadBatchPushLimits.maxItemsPerBatch ||
        resultItems.length !== originalItems.length
      ) {
        fail(
          'the terminal actor receipt is not a valid successful batch snapshot',
        );
      }
      const result = await client.query(
        `UPDATE public.role_assignments
         SET active=false, version=version+1
         WHERE id=$1::uuid AND user_id=$2::uuid AND role_template_id=$3::uuid
           AND department_id=$4::uuid AND active=true
           AND user_id<>$5::uuid AND role_template_id<>$6::uuid
         RETURNING id`,
        [
          actor.assignmentId,
          actor.userId,
          actor.roleId,
          actor.departmentId,
          h42.actorId,
          h42.roleId,
        ],
      );
      if (result.rowCount !== 1)
        fail('exact terminal assignment did not match one active row');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  }

  async function withReceiptInsertFailure(scope, run) {
    validateLeadBatchPushBinding(process.env);
    if (!preparedRun)
      fail('fault injection requires a completed read-only R2 preparation');
    if (faultInstalledOnce)
      fail('only one exact receipt fault may be installed in this test run');
    const exactScope = validateLeadBatchPushFaultScope(
      scope,
      preparedRun,
      allowedFreshLeadIds,
    );
    faultInstalledOnce = true;
    const suffix = randomUUID().replaceAll('-', '');
    const sequence = `uxq03_batch_hit_${suffix}`;
    const name = `uxq03_batch_fault_${suffix}`;
    const trigger = `trg_${name}`;
    const fn = `public.${name}`;
    const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
    const leadArray = `ARRAY[${exactScope.leadIds.map((id) => `${literal(id)}::uuid`).join(',')}]::uuid[]`;
    const captured = await dependencies.capture();
    if (
      captured?.childEnvironment?.DATABASE_URL !== process.env.DATABASE_URL ||
      captured?.childEnvironment?.DEV_COR_TEST_DATABASE_CONTAINER_ID !==
        expectedInstance.containerId
    )
      fail('fault injection capture no longer matches the prepared R2 runtime');
    const client = dependencies.open(captured.childEnvironment.DATABASE_URL);
    await client.connect();
    let installed = false;
    let objectIdentity;
    let callbackResult;
    let callbackError;
    let primaryError;
    try {
      await client.query('BEGIN');
      const prior = await client.query(
        'SELECT count(*)::int AS count FROM public.lead_batch_push_receipts WHERE department_id=$1::uuid AND actor_user_id=$2::uuid AND idempotency_key=$3',
        [
          exactScope.departmentId,
          exactScope.actorUserId,
          exactScope.idempotencyKey,
        ],
      );
      if (prior.rows[0]?.count !== 0) fail('fault key is already used');
      const newLeads = await client.query(
        `SELECT id::text AS id FROM public.leads
         WHERE id=ANY($1::uuid[]) AND department_id=$2::uuid AND customer_id=$3::uuid
           AND responsible_user_id=$4::uuid AND status='WAITING_PUSH' AND version=1
           AND pushed_at IS NULL AND pushed_by_user_id IS NULL`,
        [
          exactScope.leadIds,
          exactScope.departmentId,
          fixtureIds.customerId,
          h42.actorId,
        ],
      );
      if (newLeads.rows.length !== exactScope.leadIds.length)
        fail('fault lead set must be the exact fresh H42 fixture batch');
      const preexistingObjects = await client.query(
        `SELECT to_regclass($1) AS sequence, p.oid AS function_oid,
                t.oid AS trigger_oid
         FROM (SELECT 1) seed
         LEFT JOIN pg_proc p ON p.proname=$2 AND p.pronamespace='public'::regnamespace
         LEFT JOIN pg_trigger t ON t.tgname=$3 AND NOT t.tgisinternal`,
        [`public.${sequence}`, name, trigger],
      );
      if (
        preexistingObjects.rows[0]?.sequence !== null ||
        preexistingObjects.rows[0]?.function_oid !== null ||
        preexistingObjects.rows[0]?.trigger_oid !== null
      )
        fail('fault object name unexpectedly already exists');
      await client.query(`CREATE SEQUENCE public.${sequence} START WITH 1`);
      await client.query(
        `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $body$
         BEGIN
           IF NEW.department_id=${literal(exactScope.departmentId)}::uuid
              AND NEW.actor_user_id=${literal(exactScope.actorUserId)}::uuid
              AND NEW.idempotency_key=${literal(exactScope.idempotencyKey)}
              AND COALESCE((
                SELECT array_agg((entry.item->>'leadId')::uuid ORDER BY entry.ordinality)
                FROM jsonb_array_elements(NEW.original_request->'items')
                     WITH ORDINALITY AS entry(item, ordinality)
              ), ARRAY[]::uuid[]) = ${leadArray} THEN
             PERFORM nextval(${literal(`public.${sequence}`)}::regclass);
             RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='UXQ03_BATCH_RECEIPT_WRITE_FAULT';
           END IF;
           RETURN NEW;
         END
         $body$`,
      );
      await client.query(
        `CREATE TRIGGER "${trigger}" BEFORE INSERT ON public.lead_batch_push_receipts
         FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
      );
      await client.query('COMMIT');
      installed = true;
      objectIdentity = (
        await client.query(
          `SELECT s.oid::text AS sequence_oid,
                  pg_get_userbyid(s.relowner) AS sequence_owner,
                  f.oid::text AS function_oid,
                  pg_get_userbyid(f.proowner) AS function_owner,
                  t.oid::text AS trigger_oid,
                  t.tgrelid::text AS relation_oid,
                  pg_get_userbyid(rel.relowner) AS relation_owner
           FROM pg_class s
           JOIN pg_namespace sn ON sn.oid=s.relnamespace
           JOIN pg_proc f ON f.proname=$2 AND f.pronamespace='public'::regnamespace
           JOIN pg_trigger t ON t.tgfoid=f.oid AND t.tgname=$3
           JOIN pg_class rel ON rel.oid=t.tgrelid
           WHERE sn.nspname='public' AND s.relname=$1
             AND rel.oid='public.lead_batch_push_receipts'::regclass`,
          [sequence, name, trigger],
        )
      ).rows[0];
      if (
        !objectIdentity ||
        objectIdentity.sequence_owner !== 'dev_cor_test' ||
        objectIdentity.function_owner !== 'dev_cor_test' ||
        objectIdentity.relation_owner !== 'dev_cor_test'
      )
        fail(
          'fault trigger, function and sequence identity/owner proof failed',
        );
      const markerBefore = (
        await client.query(
          `SELECT last_value, is_called FROM public.${sequence}`,
        )
      ).rows[0];
      if (
        markerBefore?.is_called !== false ||
        Number(markerBefore?.last_value) !== 1
      )
        fail('new fault marker sequence is not unused');
      try {
        callbackResult = await run();
      } catch (error) {
        callbackError = error;
      }
      const markerAfter = (
        await client.query(
          `SELECT last_value, is_called FROM public.${sequence}`,
        )
      ).rows[0];
      validateLeadBatchPushFaultMarker(markerBefore, markerAfter);
      if (callbackError) throw callbackError;
    } catch (error) {
      primaryError = error;
      await client.query('ROLLBACK').catch(() => undefined);
    } finally {
      if (installed) {
        try {
          const current = (
            await client.query(
              `SELECT s.oid::text AS sequence_oid,
                      pg_get_userbyid(s.relowner) AS sequence_owner,
                      f.oid::text AS function_oid,
                      pg_get_userbyid(f.proowner) AS function_owner,
                      t.oid::text AS trigger_oid,
                      t.tgrelid::text AS relation_oid,
                      pg_get_userbyid(rel.relowner) AS relation_owner
               FROM pg_class s
               JOIN pg_namespace sn ON sn.oid=s.relnamespace
               JOIN pg_proc f ON f.proname=$2 AND f.pronamespace='public'::regnamespace
               JOIN pg_trigger t ON t.tgfoid=f.oid AND t.tgname=$3
               JOIN pg_class rel ON rel.oid=t.tgrelid
               WHERE sn.nspname='public' AND s.relname=$1
                 AND rel.oid='public.lead_batch_push_receipts'::regclass`,
              [sequence, name, trigger],
            )
          ).rows[0];
          if (
            !current ||
            current.sequence_oid !== objectIdentity?.sequence_oid ||
            current.function_oid !== objectIdentity?.function_oid ||
            current.trigger_oid !== objectIdentity?.trigger_oid ||
            current.relation_oid !== objectIdentity?.relation_oid ||
            current.sequence_owner !== 'dev_cor_test' ||
            current.function_owner !== 'dev_cor_test' ||
            current.relation_owner !== 'dev_cor_test'
          )
            fail(
              'refusing to drop a fault object whose sealed identity changed',
            );
          await client.query(
            `DROP TRIGGER "${trigger}" ON public.lead_batch_push_receipts`,
          );
          await client.query(`DROP FUNCTION ${fn}()`);
          await client.query(`DROP SEQUENCE public.${sequence}`);
        } catch (error) {
          primaryError ??= error;
        }
      }
      try {
        await client.end();
      } catch (error) {
        primaryError ??= error;
      }
    }
    if (primaryError) throw primaryError;
    return callbackResult;
  }

  return Object.freeze({
    prepare,
    beginLeadCreation,
    registerCreatedLead,
    readFacts,
    revokeTerminalAssignment,
    withReceiptInsertFailure,
  });
}
