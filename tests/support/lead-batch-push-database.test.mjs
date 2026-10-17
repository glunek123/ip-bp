import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  createLeadBatchPushDatabaseSupport,
  leadBatchPushLimits,
  validateLeadBatchPushBinding,
  validateLeadBatchPushCreationReceipt,
  validateLeadBatchPushFaultMarker,
  validateLeadBatchPushFaultScope,
  validateLeadBatchPushFixture,
  validateLeadBatchPushManifest,
  validateLeadBatchPushMigrationLedger,
  validateLeadBatchPushMigrationSource,
} from './lead-batch-push-database.mjs';

const h42 = {
  actorId: 'edc8bf6f-6660-41f6-8418-f72f87443a1c',
  roleId: '51c34a8b-fb00-45b1-ab9f-d077d59d4878',
  departmentId: '10000000-0000-4000-8000-000000000001',
  assignmentId: '8bed4da1-c61e-40d9-bd78-170380421ce8',
  membershipId: '36ea4166-dce8-48bd-bb9b-216222f0ea2a',
  credentialId: 'f695cb82-e0d1-4dcc-9135-d1e3c75ecc8b',
};
const terminal = {
  userId: 'eecec2c7-068c-4515-b737-0846aedc2bb1',
  roleId: '4ab4e231-9e37-4f89-a745-66406623f2be',
  assignmentId: 'aa236b93-2976-49cf-83da-b2b9722e55fd',
  membershipId: '589c5130-c537-43fa-8912-c605cf7325d4',
  credentialId: 'dd736c74-220a-4809-8574-0b516cd526dd',
  departmentId: h42.departmentId,
  grantIds: {
    'customer.read': '1f41d658-19ee-4fd4-a193-8cb5e1d2b970',
    'lead.read': '0b11e49e-c94c-4f3b-b7e8-b1163ed775e2',
    'lead.create': '7d196e5e-1c89-44f7-9d25-b2632c7b9bad',
    'lead.push': 'a0e8a262-375f-427f-80e5-0c76ccb91e7a',
  },
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const makeManifest = () => ({
  version: 1,
  cohort: 'uxq03-lead-batch-push-20261016',
  runId: '70000000-0000-4000-8000-000000000001',
  creationReceiptSha256: 'a'.repeat(64),
  terminal: clone(terminal),
});
const validBinding = {
  NODE_ENV: 'test',
  npm_config_user_agent: 'pnpm/11.27.0 npm/? node/v24.21.0 win32 x64',
  DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-ui003-r2',
  DEV_COR_TEST_DATABASE_CONTAINER_ID:
    '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
  DEV_COR_TEST_DATABASE_URL:
    'postgresql://dev_cor_test:opaque@127.0.0.1:15438/dev_cor_test',
  DATABASE_URL: 'postgresql://dev_cor_test:opaque@127.0.0.1:15438/dev_cor_test',
};

function pinnedMigrations() {
  const rows = Array.from({ length: 155 }, (_, index) => ({
    name: `20200101000000_legacy_${String(index).padStart(3, '0')}`,
    checksum: 'a'.repeat(64),
  }));
  rows.push(
    {
      name: '20261015150000_case_section_record_edits',
      checksum:
        '10760cf6e9969822a6b6a631760645625d227c4541a018560473e34c164953c7',
    },
    {
      name: '20261015170000_case_section_record_uploads',
      checksum:
        '883f2f80b615a0f746adb2ebbb6e17cc24d0ac577a61d236f3bb6375fbc0367d',
    },
    {
      name: '20261016090000_case_record_material_guard_repair',
      checksum:
        'dfe31436055f7ab9bf8d0796c48b3a0dd38a16acf4e5b3554e04e3d299b7b869',
    },
    {
      name: '20261016093000_case_record_material_reference_reuse',
      checksum:
        '628a0fc0a664942896fdd85e3811bfe977702e4924ef33a58f83399a9bf8280e',
    },
    {
      name: '20261016095000_execution_supplement_enum_preparation',
      checksum:
        'f9a18c2d93ac3bb75debac0835eee32dd9896fff267c1fa7275c959bddfeac5f',
    },
    {
      name: '20261016100000_case_execution_filing_followups',
      checksum:
        'e125a3278b0530860b1be49273fc667224451f8a6d35b420bdf14e2b9c684105',
    },
    {
      name: '20261016110000_lead_batch_push',
      checksum:
        '1e267e104e4a7a1b20f1014dfd10506ce1aa831e32a11175e3a4dde2430c9e87',
    },
    {
      name: '20261016115000_fee_proof_category_prepare',
      checksum:
        'a7b80c1143035aa0526fcb6a90857a737e505b692c2ea95efd7ff3f465e9f4d4',
    },
    {
      name: '20261016120000_settlement_demo_alignment',
      checksum:
        'fbb81d7cb424beb9b1bad103a498c2bee66c1e7c15ef806d47631b5685a810e7',
    },
    {
      name: '20261016130000_evidence_demo_alignment',
      checksum:
        'fd138a179438bac39a7bf30bc31373ac4ca2b9eef454ef8229c78ab0a1135de9',
    },
  );
  return rows;
}

test('accepts only the exact protected R2 runner tuple', () => {
  assert.equal(validateLeadBatchPushBinding(validBinding).migrationCount, 165);
  for (const patch of [
    { DEV_COR_TEST_DATABASE_PROJECT: 'other' },
    { DEV_COR_TEST_DATABASE_CONTAINER_ID: '45addc01' },
    { DATABASE_URL: 'postgresql://dev_cor_test:x@127.0.0.1:5432/dev_cor_test' },
    { npm_config_user_agent: 'npm/10.0.0' },
    { NODE_ENV: 'development' },
    {
      DEV_COR_TEST_DATABASE_URL:
        'postgresql://dev_cor_test:opaque@127.0.0.1:15438/dev_cor_test?',
      DATABASE_URL:
        'postgresql://dev_cor_test:opaque@127.0.0.1:15438/dev_cor_test?',
    },
    {
      DEV_COR_TEST_DATABASE_URL:
        'postgresql://dev_cor_test:opaque@127.0.0.1:15438/dev_cor_test#',
      DATABASE_URL:
        'postgresql://dev_cor_test:opaque@127.0.0.1:15438/dev_cor_test#',
    },
  ])
    assert.throws(
      () => validateLeadBatchPushBinding({ ...validBinding, ...patch }),
      /BLOCKED/u,
    );
});

test('the actual prepare entry point blocks before migrations, capture, or database access', async () => {
  const calls = [];
  const support = createLeadBatchPushDatabaseSupport({
    migrations: async () => {
      calls.push('migrations');
      return [];
    },
    capture: async () => {
      calls.push('capture');
      return { childEnvironment: {} };
    },
    open: () => {
      calls.push('open');
      return {
        connect: async () => calls.push('connect'),
        end: async () => calls.push('end'),
        query: async () => {
          calls.push('query');
          return { rows: [] };
        },
      };
    },
  });
  const previous = process.env.DEV_COR_TEST_DATABASE_URL;
  process.env.DEV_COR_TEST_DATABASE_URL = 'not-a-database-url';
  try {
    await assert.rejects(support.prepare(), /BLOCKED/u);
  } finally {
    if (previous === undefined) delete process.env.DEV_COR_TEST_DATABASE_URL;
    else process.env.DEV_COR_TEST_DATABASE_URL = previous;
  }
  assert.deepEqual(calls, []);
});

test('pins the complete 165-source chain and each raw checksum from 156 through 165', () => {
  assert.equal(
    validateLeadBatchPushMigrationSource(pinnedMigrations()).length,
    165,
  );
  for (let index = 155; index < 165; index++) {
    const changed = pinnedMigrations();
    changed[index] = { ...changed[index], checksum: 'f'.repeat(64) };
    assert.throws(
      () => validateLeadBatchPushMigrationSource(changed),
      /pin mismatch/u,
    );
  }
  for (const count of [161, 162, 164, 166]) {
    const changed = pinnedMigrations();
    if (count < 165) changed.length = count;
    else
      changed.push({
        name: '20261016140000_unapproved',
        checksum: 'a'.repeat(64),
      });
    assert.throws(
      () => validateLeadBatchPushMigrationSource(changed),
      /165 migration sources/u,
    );
  }
  const unordered = pinnedMigrations();
  [unordered[160], unordered[161]] = [unordered[161], unordered[160]];
  assert.throws(
    () => validateLeadBatchPushMigrationSource(unordered),
    /ordered/u,
  );
});

test('the actual 165 SQL source bytes match the independent pins', async () => {
  const directory = resolve('backend/prisma/migrations');
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  const source = await Promise.all(
    names.map(async (name) => ({
      name,
      checksum: createHash('sha256')
        .update(await readFile(resolve(directory, name, 'migration.sql')))
        .digest('hex'),
    })),
  );
  assert.equal(validateLeadBatchPushMigrationSource(source).length, 165);
});

test('the prepare entry point refuses stale or altered source before capture and connect', async () => {
  const patch = {
    ...validBinding,
    UXQ03_BATCH_PUSH_MANIFEST: JSON.stringify(makeManifest()),
    UXQ03_BATCH_PUSH_CREDENTIALS: JSON.stringify({
      main: { username: 'opaque', password: 'opaque' },
      terminal: { username: 'opaque', password: 'opaque' },
    }),
  };
  const previous = Object.fromEntries(
    Object.keys(patch).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, patch);
  try {
    for (const source of [
      pinnedMigrations().slice(0, 161),
      pinnedMigrations().slice(0, 164),
      pinnedMigrations().map((row, index) =>
        index === 159 ? { ...row, checksum: 'f'.repeat(64) } : row,
      ),
    ]) {
      const calls = [];
      const support = createLeadBatchPushDatabaseSupport({
        migrations: async () => {
          calls.push('migrations');
          return source;
        },
        capture: async () => {
          calls.push('capture');
          return {};
        },
        open: () => {
          calls.push('open');
          throw new Error('unexpected connect');
        },
      });
      await assert.rejects(support.prepare(), /BLOCKED/u);
      assert.deepEqual(calls, ['migrations']);
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

function resolvedEfEvidence() {
  const stdout = Buffer.from(
    'Migration 20261016100000_case_execution_filing_followups marked as rolled back',
  );
  const stderr = Buffer.alloc(0);
  const row = {
    id: '9f547970-6eaa-4628-a670-f505590482e9',
    migration_name: '20261016100000_case_execution_filing_followups',
    checksum:
      'e125a3278b0530860b1be49273fc667224451f8a6d35b420bdf14e2b9c684105',
    started_at: '2026-10-16 09:36:04.56343+00',
    finished_at: null,
    rolled_back_at: '2026-10-16 12:00:00.123+00',
    applied_steps_count: 0,
    logs_is_null: true,
  };
  return {
    row,
    receipt: {
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
        row.migration_name,
      ],
      cwd: 'backend',
      exitCode: 0,
      commandStartedAt: '2026-10-16T11:59:59.000Z',
      commandFinishedAt: '2026-10-16T12:00:01.000Z',
      stdoutSha256: createHash('sha256').update(stdout).digest('hex'),
      stderrSha256: createHash('sha256').update(stderr).digest('hex'),
    },
    stdout,
    stderr,
  };
}

test('165 ledger admits only the exact resolved EF history and rejects synchronized source tampering', () => {
  const source = pinnedMigrations();
  const evidence = resolvedEfEvidence();
  const successful = source.map((item, index) => ({
    id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
    migration_name: item.name,
    checksum: item.checksum,
    finished_at: '2026-10-17 00:00:00+00',
    rolled_back_at: null,
  }));
  const ledger = [...successful, evidence.row].sort((a, b) =>
    a.migration_name.localeCompare(b.migration_name),
  );
  assert.equal(
    validateLeadBatchPushMigrationLedger(ledger, source, evidence),
    true,
  );
  for (let index = 155; index < 165; index++) {
    const changedSource = clone(source);
    const changedLedger = clone(ledger);
    changedSource[index].checksum = 'f'.repeat(64);
    changedLedger.find(
      (row) =>
        row.migration_name === changedSource[index].name &&
        row.id !== evidence.row.id,
    ).checksum = 'f'.repeat(64);
    assert.throws(
      () =>
        validateLeadBatchPushMigrationLedger(
          changedLedger,
          changedSource,
          evidence,
        ),
      /pin mismatch/u,
    );
  }
  for (const bad of [
    successful,
    [...ledger, evidence.row],
    [
      ...ledger,
      { ...evidence.row, id: '00000000-0000-4000-8000-00000000ffff' },
    ],
    ledger.map((row) =>
      row.id === evidence.row.id ? { ...row, rolled_back_at: null } : row,
    ),
    ledger.map((row) =>
      row.id === evidence.row.id
        ? { ...row, started_at: '2026-10-16 09:36:04.56344+00' }
        : row,
    ),
    ledger.map((row) =>
      row.id === evidence.row.id ? { ...row, applied_steps_count: 1 } : row,
    ),
    ledger.map((row) =>
      row.id === evidence.row.id ? { ...row, logs_is_null: false } : row,
    ),
    ledger.map((row) =>
      row.id === evidence.row.id
        ? { ...row, finished_at: '2026-10-16 12:00:00+00' }
        : row,
    ),
    ledger.map((row) =>
      row.migration_name === source[164].name
        ? { ...row, finished_at: null }
        : row,
    ),
    ledger.map((row) =>
      row.migration_name === source[164].name
        ? { ...row, rolled_back_at: '2026-10-17 00:00:00+00' }
        : row,
    ),
  ])
    assert.throws(
      () => validateLeadBatchPushMigrationLedger(bad, source, evidence),
      /BLOCKED/u,
    );
  for (const changed of [
    { receipt: { ...evidence.receipt, exitCode: 1 } },
    {
      receipt: {
        ...evidence.receipt,
        command: [
          'prisma',
          'migrate',
          'resolve',
          '--applied',
          evidence.row.migration_name,
        ],
      },
    },
    {
      receipt: {
        ...evidence.receipt,
        rolledBackAt: '2026-10-16 12:00:00.124+00',
      },
    },
    { stdout: Buffer.from('tampered') },
  ])
    assert.throws(
      () =>
        validateLeadBatchPushMigrationLedger(ledger, source, {
          ...evidence,
          ...changed,
        }),
      /BLOCKED/u,
    );
});

test('pins H42 as main and one terminal actor with the exact four grant IDs', () => {
  const manifest = makeManifest();
  assert.equal(
    validateLeadBatchPushManifest(manifest).terminal.userId,
    manifest.terminal.userId,
  );
  assert.equal(
    validateLeadBatchPushManifest(manifest).main.userId,
    h42.actorId,
  );
  const attemptedMainOverride = makeManifest();
  attemptedMainOverride.main = { ...h42 };
  assert.throws(
    () => validateLeadBatchPushManifest(attemptedMainOverride),
    /unexpected fields/u,
  );
  const h42Collision = makeManifest();
  h42Collision.terminal.userId = h42.actorId;
  assert.throws(
    () => validateLeadBatchPushManifest(h42Collision),
    /source-pinned cohort/u,
  );
  const wrongGrant = makeManifest();
  wrongGrant.terminal.grantIds['lead.push'] =
    '71000000-0000-4000-8000-000000000009';
  assert.throws(
    () => validateLeadBatchPushManifest(wrongGrant),
    /unexpected fields|source-pinned cohort/u,
  );
});

test('validates the fixed-path terminal creation receipt against candidate, R2, H42 and exact additions', () => {
  const manifest = makeManifest();
  const receipt = {
    version: 1,
    cohort: manifest.cohort,
    runId: manifest.runId,
    candidateCommit: 'a'.repeat(40),
    r2: {
      project: 'dev-cor-ui003-r2',
      containerId:
        '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
      host: '127.0.0.1',
      port: 15438,
      database: 'dev_cor_test',
      migrationCount: 161,
    },
    migrationPins: [
      {
        name: '20261015150000_case_section_record_edits',
        checksum:
          '10760cf6e9969822a6b6a631760645625d227c4541a018560473e34c164953c7',
      },
      {
        name: '20261015170000_case_section_record_uploads',
        checksum:
          '883f2f80b615a0f746adb2ebbb6e17cc24d0ac577a61d236f3bb6375fbc0367d',
      },
      {
        name: '20261016090000_case_record_material_guard_repair',
        checksum:
          'dfe31436055f7ab9bf8d0796c48b3a0dd38a16acf4e5b3554e04e3d299b7b869',
      },
      {
        name: '20261016093000_case_record_material_reference_reuse',
        checksum:
          '628a0fc0a664942896fdd85e3811bfe977702e4924ef33a58f83399a9bf8280e',
      },
      {
        name: '20261016100000_case_execution_filing_followups',
        checksum:
          'e125a3278b0530860b1be49273fc667224451f8a6d35b420bdf14e2b9c684105',
      },
      {
        name: '20261016110000_lead_batch_push',
        checksum:
          '1e267e104e4a7a1b20f1014dfd10506ce1aa831e32a11175e3a4dde2430c9e87',
      },
    ],
    mainH42Unchanged: {
      userId: h42.actorId,
      roleId: h42.roleId,
      assignmentId: h42.assignmentId,
      membershipId: h42.membershipId,
      credentialId: h42.credentialId,
      departmentId: h42.departmentId,
      actions: ['customer.read', 'lead.read', 'lead.create', 'lead.push'],
      credentialProofPath:
        'C:\\Users\\97830\\AppData\\Local\\Temp\\dev-cor-h-actor-recovery-83ac59ee-1b96-4fde-b1b8-534061a36ed0\\actor.private.json',
      credentialProofSha256:
        'd9367f33ac67ad2353648ade02b3c110aaa1785a51944207882de56e34a94de1',
      originalCredentialUnchanged: true,
    },
    newObjects: {
      userAccounts: [
        { id: terminal.userId, accountType: 'INTERNAL', active: true },
      ],
      localCredentials: [
        { id: terminal.credentialId, userId: terminal.userId },
      ],
      departmentMemberships: [
        {
          id: terminal.membershipId,
          userId: terminal.userId,
          departmentId: terminal.departmentId,
          active: true,
          teamId: null,
        },
      ],
      roleTemplates: [
        {
          id: terminal.roleId,
          departmentId: terminal.departmentId,
          name: 'UXQ03 Lead Batch Terminal',
          active: true,
        },
      ],
      roleAssignments: [
        {
          id: terminal.assignmentId,
          userId: terminal.userId,
          roleTemplateId: terminal.roleId,
          departmentId: terminal.departmentId,
          active: true,
          teamId: null,
        },
      ],
      roleGrants: [
        'customer.read',
        'lead.read',
        'lead.create',
        'lead.push',
      ].map((action) => ({
        id: terminal.grantIds[action],
        roleTemplateId: terminal.roleId,
        action,
        scope: 'DEPARTMENT',
      })),
    },
  };
  const bytes = JSON.stringify(receipt);
  const receiptSha256 = createHash('sha256').update(bytes).digest('hex');
  manifest.creationReceiptSha256 = receiptSha256;
  assert.equal(
    validateLeadBatchPushCreationReceipt(receipt, receiptSha256, {
      runId: manifest.runId,
      creationReceiptSha256: receiptSha256,
      candidateCommit: receipt.candidateCommit,
    }),
    receipt,
  );
  assert.throws(
    () =>
      validateLeadBatchPushCreationReceipt(receipt, 'b'.repeat(64), {
        runId: manifest.runId,
        creationReceiptSha256: receiptSha256,
        candidateCommit: receipt.candidateCommit,
      }),
    /hash/u,
  );
  const altered = clone(receipt);
  altered.newObjects.roleGrants.push({
    id: '71000000-0000-4000-8000-000000000009',
    roleTemplateId: terminal.roleId,
    action: 'user.manage',
    scope: 'DEPARTMENT',
  });
  assert.throws(
    () =>
      validateLeadBatchPushCreationReceipt(
        altered,
        createHash('sha256').update(JSON.stringify(altered)).digest('hex'),
        {
          runId: manifest.runId,
          creationReceiptSha256: createHash('sha256')
            .update(JSON.stringify(altered))
            .digest('hex'),
          candidateCommit: receipt.candidateCommit,
        },
      ),
    /exact object diff/u,
  );
});

test('fault scope and non-transactional marker require this exact H42 batch and exactly one trigger hit', () => {
  const identity = { actorUserId: h42.actorId, departmentId: h42.departmentId };
  const scope = {
    actorUserId: h42.actorId,
    departmentId: h42.departmentId,
    idempotencyKey: '70000000-0000-4000-8000-000000000003',
    leadIds: [
      '70000000-0000-4000-8000-000000000004',
      '70000000-0000-4000-8000-000000000005',
    ],
  };
  const freshLeadIds = new Set(scope.leadIds.map((id) => id.toLowerCase()));
  assert.deepEqual(
    validateLeadBatchPushFaultScope(scope, identity, freshLeadIds),
    scope,
  );
  for (const invalid of [
    { ...scope, actorUserId: terminal.userId },
    { ...scope, departmentId: '10000000-0000-4000-8000-000000000002' },
    { ...scope, idempotencyKey: 'not-a-new-uuid' },
    { ...scope, leadIds: [scope.leadIds[0], scope.leadIds[0]] },
    { ...scope, leadIds: [] },
  ])
    assert.throws(
      () => validateLeadBatchPushFaultScope(invalid, identity, freshLeadIds),
      /BLOCKED/u,
    );
  assert.throws(
    () =>
      validateLeadBatchPushFaultScope(
        scope,
        identity,
        new Set([scope.leadIds[0].toLowerCase()]),
      ),
    /this run registered fresh/u,
  );
  assert.throws(
    () =>
      validateLeadBatchPushFaultScope(
        scope,
        {
          actorUserId: terminal.userId,
          departmentId: h42.departmentId,
        },
        freshLeadIds,
      ),
    /BLOCKED/u,
  );
  assert.equal(
    validateLeadBatchPushFaultMarker(
      { last_value: '1', is_called: false },
      { last_value: '1', is_called: true },
    ),
    true,
  );
  for (const after of [
    { last_value: '1', is_called: false },
    { last_value: '2', is_called: true },
  ])
    assert.throws(
      () =>
        validateLeadBatchPushFaultMarker(
          { last_value: '1', is_called: false },
          after,
        ),
      /exactly once/u,
    );
  assert.throws(
    () =>
      validateLeadBatchPushFaultMarker(
        { last_value: '1', is_called: true },
        { last_value: '2', is_called: true },
      ),
    /exactly once/u,
  );
});

test('blocks when the existing synthetic customer, rights-holder, cooperation, or client binding is not eligible', () => {
  const eligible = {
    customerId: '50000000-0000-4000-8000-000000000002',
    rightsHolderId: '60000000-0000-4000-8000-000000000001',
    departmentId: h42.departmentId,
    profileStatus: 'ADMITTED',
    cooperationStatus: 'COOPERATING',
    clientBindingActive: true,
  };
  assert.deepEqual(validateLeadBatchPushFixture([eligible]), {
    customerId: eligible.customerId,
    rightsHolderId: eligible.rightsHolderId,
    departmentId: eligible.departmentId,
  });
  assert.throws(() => validateLeadBatchPushFixture([]), /BLOCKED/u);
  assert.throws(
    () =>
      validateLeadBatchPushFixture([
        { ...eligible, clientBindingActive: false },
      ]),
    /active client binding/u,
  );
  assert.equal(leadBatchPushLimits.maxNewLeads, 40);
  assert.equal(leadBatchPushLimits.maxBatchReceipts, 10);
});
