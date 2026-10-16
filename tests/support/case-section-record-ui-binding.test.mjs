import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  assertSectionRecordUiBinding,
  assertSectionRecordUiDatabaseProof,
  validateSectionRecordUiAdmission,
} from './case-section-record-ui-database.mjs';

const url =
  'postgresql://dev_cor_test:offline-only@127.0.0.1:15438/dev_cor_test';
const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: url,
  DEV_COR_TEST_DATABASE_URL: url,
  DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-ui003-r2',
  DEV_COR_TEST_DATABASE_CONTAINER_ID:
    '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236',
  npm_config_user_agent: 'pnpm/11.27.0',
};
const gaps = [
  'case.complaint.mail',
  'case.filing.submit',
  'case.acceptance.register',
  'case.hearing.schedule',
  'case.execution.submit',
  'case.external-entry.create',
  'case.execution.mailing.correct',
  'case.execution.filing.correct',
  'case.execution.finish.correct',
];
const both = (value) => ({
  DATABASE_URL: value,
  DEV_COR_TEST_DATABASE_URL: value,
});
function proof() {
  const migrations = Array.from({ length: 157 }, (_, index) => ({
    name: `2026010100${String(index).padStart(4, '0')}_synthetic`,
    checksum: index.toString(16).padStart(64, '0'),
  }));
  migrations.splice(
    154,
    3,
    ...[
      '20261015130000_guard_direct_second_remand_child',
      '20261015150000_case_section_record_edits',
      '20261015170000_case_section_record_uploads',
    ].map((name, index) => ({ ...migrations[154 + index], name })),
  );
  return {
    capturedDatabaseUrl: url,
    validatedDatabaseUrl: url,
    migrations,
    identity: [
      { db: 'dev_cor_test', schema: 'public', username: 'dev_cor_test' },
    ],
    applied: migrations.map((m) => ({
      migration_name: m.name,
      checksum: m.checksum,
      finished_at: 'finished',
      rolled_back_at: null,
    })),
  };
}
function pending(error) {
  assert.equal(error?.code, 'NORMAL_SOURCE_PERMISSION_PENDING');
  assert.equal(error?.finding, 'I-SECTION-UI-GRANT01');
  assert.equal(error.name, 'SectionRecordUiPermissionPending');
  assert.ok(
    error.message.startsWith(
      'I-SECTION-UI-GRANT01 / NORMAL_SOURCE_PERMISSION_PENDING:',
    ),
  );
  assert.deepEqual(Array.from(error.requiredActions), gaps);
  assert.ok(error.message.includes('the nine Actions are user-authorized'));
  return true;
}

// Synthetic proof-shape only: this never installs a runtime manifest, touches the
// original private credential, connects to PG, or asserts a real Grant was added.
function admittedProof() {
  const actor = {
    userId: 'edc8bf6f-6660-41f6-8418-f72f87443a1c',
    roleId: '51c34a8b-fb00-45b1-ab9f-d077d59d4878',
    departmentId: '10000000-0000-4000-8000-000000000001',
    assignmentId: '8bed4da1-c61e-40d9-bd78-170380421ce8',
    membershipId: '36ea4166-dce8-48bd-bb9b-216222f0ea2a',
    credentialId: 'f695cb82-e0d1-4dcc-9135-d1e3c75ecc8b',
  };
  const originalActions = [
    'case.archive',
    'case.archive.correct',
    'case.closure.correct',
    'case.closure.record',
    'case.complaint.confirm',
    'case.complaint.submit',
    'case.execution.confirm',
    'case.execution.filing.submit',
    'case.execution.finish',
    'case.execution.mail',
    'case.execution.submit',
    'case.hearing.correct',
    'case.hearing.schedule',
    'case.judgment.correct',
    'case.judgment.next_step',
    'case.judgment.register',
    'case.match',
    'case.read',
    'case.second_instance.result',
    'customer.admit',
    'customer.read',
    'lawyer.account.manage',
    'lead.create',
    'lead.edit',
    'lead.evidence.decide',
    'lead.push',
    'lead.read',
    'lead.withdraw.apply',
    'notary.evidence.record',
    'notary.issuance.decide',
    'notary.office.manage',
    'notary.opening.review',
    'notary.return.archive',
    'notary.unbox.record',
    'user.manage',
  ];
  const grant = (action, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    role_template_id: actor.roleId,
    action,
    scope: 'DEPARTMENT',
  });
  const original = originalActions.map(grant);
  const ids = [
    'c45f5968-f1b1-4b7f-9958-fe95224e63ec',
    'ccee168c-b7c1-4f0c-a045-cf6aa1cea7a8',
    '031911aa-9794-415a-b4ea-6dd6e5a050e9',
    '604ac717-4e8e-46fc-9eb2-9946a06c2063',
    '221b4dfd-6ad6-48aa-933e-5cc48d31e07c',
    'e8a738ff-28fa-435b-a81f-6850e15248b6',
    '4fdb897a-36af-4c40-971b-dfc247c6422f',
  ];
  const added = gaps
    .filter((action) => !originalActions.includes(action))
    .map((action, index) => ({ ...grant(action, index + 35), id: ids[index] }));
  const origin = {
    allAddedObjects: {
      user_accounts: [{ id: actor.userId }],
      role_templates: [{ id: actor.roleId }],
      local_credentials: [{ id: actor.credentialId }],
      role_assignments: [{ id: actor.assignmentId }],
      department_memberships: [{ id: actor.membershipId }],
    },
    newCases: [],
    newLeadIds: [],
    newGrants: original,
  };
  const candidate = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const input = {
    version: 1,
    runId: '00000000-0000-4000-8000-000000000100',
    candidate,
    environment: {
      project: valid.DEV_COR_TEST_DATABASE_PROJECT,
      container: valid.DEV_COR_TEST_DATABASE_CONTAINER_ID,
      host: '127.0.0.1',
      port: 15438,
      database: 'dev_cor_test',
      schema: 'public',
      migrations: 157,
    },
    actor,
    fixture: {
      customerId: '50000000-0000-4000-8000-000000000002',
      rightsHolderId: '60000000-0000-4000-8000-000000000001',
    },
    authorizationMessages: [
      'Sentinel_fdf4b7a29e488191a3002876ccc91fa7',
      'Sentinel_99c7388c6e608191a8cf0379ef2f1f39',
    ],
    originSha256:
      'f61ab7550209b531a7dc66d9a32bc5b023b47014feccda9730b17c3a4ca26d83',
    credentialProofSha256: 'c'.repeat(64),
    objectsSha256: 'd'.repeat(64),
    currentGrants: [...original, ...added],
    insertedGrantIds: added.map((row) => row.id),
    liveCheckedAt: '2026-10-16T01:28:03.686Z',
    terminal: false,
  };
  const credential = {
    actorId: actor.userId,
    credentialId: actor.credentialId,
    originalCredentialUnchanged: true,
    passwordVerifiedAgainstExistingHash: true,
    privateFilePath:
      'C:\\Users\\97830\\AppData\\Local\\Temp\\dev-cor-h-actor-recovery-83ac59ee-1b96-4fde-b1b8-534061a36ed0\\actor.private.json',
    privateFileSha256:
      'd9367f33ac67ad2353648ade02b3c110aaa1785a51944207882de56e34a94de1',
    secretsInEvidence: false,
    HTTPPerformed: false,
    newPrivateCopyCreated: false,
  };
  const receipt = {
    result: 'PASS_ORIGINAL_R2_RESUMED_AND_MAIN_WRITE_ROLE42',
    actorId: actor.userId,
    roleId: actor.roleId,
    departmentId: actor.departmentId,
    four: {
      sourceMessage: input.authorizationMessages[0],
      inserted: added.slice(0, 4),
    },
    three: {
      sourceMessage: input.authorizationMessages[1],
      inserted: added.slice(4),
    },
    only7RoleGrantsAdded: true,
    all149TablesPreviousRowsPreserved: true,
    passwordVerifiedAgainstUnchangedHash: true,
    credentialReset: false,
    actorRecreated: false,
    otherRolesChanged: false,
  };
  return { input, origin, credential, candidate, receipt };
}
const validateProof = (p) =>
  validateSectionRecordUiAdmission(
    p.input,
    p.origin,
    p.credential,
    p.candidate,
    p.receipt,
  );
test('complete synthetic H42 proof shape validates without runtime admission or secrets', () => {
  const p = admittedProof();
  assert.equal(validateProof(p), p.input);
});
for (const kind of [
  'missingManifest',
  'extraKey',
  'runId',
  'candidate',
  'tree',
  'port',
  'CID',
  'schema',
  'ledger',
  'foreign',
  'readOnly',
  'assignment',
  'membership',
  'wrongCredentialId',
  'originHash',
  'originActor',
  'originRole',
  'oldGrantChanged',
  'missingCorrection',
  'extraAction',
  'wrongScope',
  'duplicateGrant',
  'wrongGrantRole',
  'wrongAddedIds',
  'oldApproval',
  'credentialReset',
  'privatePath',
  'privateHash',
  'privateCopy',
  'noCurrentProof',
  'terminal',
  'receiptActor',
  'receiptAction',
  'receiptGrantId',
  'receiptRecreated',
  'receiptOtherRole',
  'receiptRowsChanged',
]) {
  test(`strict H42 manifest rejects ${kind} with no business operations`, () => {
    const p = admittedProof();
    if (kind === 'missingManifest') p.input = null;
    if (kind === 'extraKey') p.input.allow = true;
    if (kind === 'runId') p.input.runId = 'any';
    if (kind === 'candidate')
      p.input.candidate = { ...p.candidate, commit: 'e'.repeat(40) };
    if (kind === 'tree')
      p.input.candidate = { ...p.candidate, tree: 'f'.repeat(40) };
    if (kind === 'port') p.input.environment.port = 15437;
    if (kind === 'CID') p.input.environment.container = '0'.repeat(64);
    if (kind === 'schema') p.input.environment.schema = 'other';
    if (kind === 'ledger') p.input.environment.migrations = 156;
    if (kind === 'foreign')
      p.input.actor = {
        ...p.input.actor,
        departmentId: '10000000-0000-4000-8000-000000000002',
      };
    if (kind === 'readOnly')
      p.input.actor = {
        ...p.input.actor,
        userId: '00000000-0000-4000-8000-000000000001',
      };
    if (kind === 'assignment')
      p.input.actor = {
        ...p.input.actor,
        assignmentId: '00000000-0000-4000-8000-000000000001',
      };
    if (kind === 'membership')
      p.input.actor = {
        ...p.input.actor,
        membershipId: '00000000-0000-4000-8000-000000000001',
      };
    if (kind === 'wrongCredentialId') p.credential.credentialId = 'unknown';
    if (kind === 'originHash') p.input.originSha256 = '0'.repeat(64);
    if (kind === 'originActor')
      p.origin.allAddedObjects.user_accounts[0].id = 'unknown';
    if (kind === 'originRole')
      p.origin.allAddedObjects.role_templates[0].id = 'unknown';
    if (kind === 'oldGrantChanged')
      p.input.currentGrants[0] = { ...p.input.currentGrants[0], scope: 'ALL' };
    if (kind === 'missingCorrection') p.input.currentGrants.pop();
    if (kind === 'extraAction')
      p.input.currentGrants[41] = {
        ...p.input.currentGrants[41],
        action: 'case.defendant-contact.update',
      };
    if (kind === 'wrongScope') p.input.currentGrants[41].scope = 'TEAM';
    if (kind === 'duplicateGrant')
      p.input.currentGrants[41] = { ...p.input.currentGrants[40] };
    if (kind === 'wrongGrantRole')
      p.input.currentGrants[41].role_template_id = 'unknown';
    if (kind === 'wrongAddedIds') p.input.insertedGrantIds.pop();
    if (kind === 'oldApproval') p.input.authorizationMessages.pop();
    if (kind === 'credentialReset')
      p.credential.originalCredentialUnchanged = false;
    if (kind === 'privatePath')
      p.credential.privateFilePath = 'C:/other/actor.private.json';
    if (kind === 'privateHash') p.credential.privateFileSha256 = '0'.repeat(64);
    if (kind === 'privateCopy') p.credential.secretsInEvidence = true;
    if (kind === 'noCurrentProof') p.input.liveCheckedAt = null;
    if (kind === 'terminal') p.input.terminal = true;
    if (kind === 'receiptActor') p.receipt.actorId = 'unknown';
    if (kind === 'receiptAction')
      p.receipt.three.inserted = p.receipt.three.inserted.slice(1);
    if (kind === 'receiptGrantId')
      p.receipt.three.inserted = [
        {
          ...p.receipt.three.inserted[0],
          id: '00000000-0000-4000-8000-000000000999',
        },
        ...p.receipt.three.inserted.slice(1),
      ];
    if (kind === 'receiptRecreated') p.receipt.actorRecreated = true;
    if (kind === 'receiptOtherRole') p.receipt.otherRolesChanged = true;
    if (kind === 'receiptRowsChanged')
      p.receipt.all149TablesPreviousRowsPreserved = false;
    assert.throws(() => validateProof(p));
  });
}

// The sandbox executes the real support/spec source with all effectful boundaries
// replaced by counters that throw. It cannot load backend/S/H/core code, contact a
// database/browser, grant permissions, or return a synthetic successful actor/case.
const source = await readFile(
  new URL('./case-section-record-ui-database.mjs', import.meta.url),
  'utf8',
);
const specSource = await readFile(
  new URL('../e2e/case-section-record-ui.spec.ts', import.meta.url),
  'utf8',
);
function sandbox(environment = valid, runtimeMode) {
  const calls = {
    capture: 0,
    backend: 0,
    pg: 0,
    http: 0,
    grant: 0,
    factory: 0,
    operation: 0,
  };
  const refused = (key) => () => {
    calls[key]++;
    throw new Error(`Forbidden sandbox boundary ${key}`);
  };
  const modules = {
    'node:assert/strict': assert,
    'node:crypto': {
      createHash: refused('backend'),
      randomUUID: refused('factory'),
    },
    'node:module': { createRequire: refused('backend') },
    'node:fs': {
      existsSync: () => false,
      writeFileSync: refused('operation'),
      readFileSync() {
        throw new Error('No runner-sealed manifest');
      },
    },
    'node:child_process': { execFileSync: refused('backend') },
    'node:path': { resolve: () => 'offline-root' },
    'node:fs/promises': {
      readdir: refused('backend'),
      readFile: refused('backend'),
    },
    '../../scripts/test-environment.mjs': {
      captureTestEnvironment: refused('capture'),
      validateBrowserTestDatabaseUrl: refused('capture'),
    },
    './case-section-record-upload-database.mjs': {
      createSectionUploadActor: refused('grant'),
      ownSectionUploadCase: refused('pg'),
      sectionUploadFixture: refused('factory'),
      revokeSectionUploadActor: refused('grant'),
      sectionUploadSnapshot: refused('pg'),
    },
    './case-historical-record-edit-database.mjs': {
      historicalBaselineSecuritySnapshot: refused('pg'),
      createHistoricalRecordActor: refused('grant'),
    },
  };
  const sql = [];
  if (runtimeMode) {
    // PG doubles cross the vm realm; normalize only their comparison prototypes.
    const realmAssert = Object.assign((...args) => assert(...args), assert);
    realmAssert.deepEqual = (actual, expected, message) =>
      assert.deepEqual(
        JSON.parse(JSON.stringify(actual)),
        JSON.parse(JSON.stringify(expected)),
        message,
      );
    modules['node:assert/strict'] = realmAssert;
    const p = admittedProof();
    const a = p.input.actor;
    const current = {
      user: [{ id: a.userId, active: true }],
      role: [{ id: a.roleId, department_id: a.departmentId, active: true }],
      assignments: [
        {
          id: a.assignmentId,
          user_id: a.userId,
          department_id: a.departmentId,
          role_template_id: a.roleId,
          active: true,
          version: 1,
        },
      ],
      memberships: [
        {
          id: a.membershipId,
          user_id: a.userId,
          department_id: a.departmentId,
          active: true,
        },
      ],
      credential: [
        {
          id: a.credentialId,
          user_id: a.userId,
          username: 'historical-record-00000000-0000-4000-8000-000000000001',
          password_hash: 'synthetic-not-a-real-hash',
        },
      ],
    };
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
    p.input.objectsSha256 = createHash('sha256')
      .update(JSON.stringify(canonical(current)))
      .digest('hex');
    const privatePayload = {
      actorId: a.userId,
      roleId: a.roleId,
      departmentId: a.departmentId,
      username: current.credential[0].username,
      password: 'synthetic-not-a-real-secret',
    };
    const files = {
      'section-record-ui-run.json': JSON.stringify(p.input),
      'ui-actor-origin.json': JSON.stringify(p.origin),
      'ui-credential-proof.json': JSON.stringify(p.credential),
      'ui-grant-receipt.json': JSON.stringify(p.receipt),
      'actor.private.json': JSON.stringify(privatePayload),
    };
    files['ui-origin-manifest.json'] = JSON.stringify({
      files: [
        {
          path: 'H-owned-object-delta.json',
          sha256: p.input.originSha256,
          bytes: Buffer.byteLength(files['ui-actor-origin.json']),
        },
      ],
    });
    const hashes = new Map([
      [
        files['ui-origin-manifest.json'],
        'a5307e17af39d842c1ed01b59acae261de8eee16a5454685a8d9137978c340af',
      ],
      [files['ui-actor-origin.json'], p.input.originSha256],
      [files['ui-credential-proof.json'], p.input.credentialProofSha256],
      [
        files['ui-grant-receipt.json'],
        'df1b29f2e618d7c54f0e6960d5c03a39fb2a6ca03cfcf6e8e347457cc7f6bed0',
      ],
      [files['actor.private.json'], p.credential.privateFileSha256],
    ]);
    for (const migration of proof().migrations)
      hashes.set(migration.name, migration.checksum);
    modules['node:crypto'] = {
      createHash() {
        const parts = [];
        return {
          update(value) {
            parts.push(Buffer.from(value));
            return this;
          },
          digest() {
            const value = Buffer.concat(parts).toString();
            return (
              hashes.get(value) ??
              createHash('sha256').update(value).digest('hex')
            );
          },
        };
      },
      randomUUID: refused('factory'),
    };
    modules['node:path'] = { resolve };
    const markers = new Set();
    modules['node:fs'] = {
      existsSync: (path) =>
        path === p.credential.privateFilePath
          ? runtimeMode !== 'privateMissing'
          : runtimeMode === 'terminalMarker' || markers.has(path),
      writeFileSync(path, _bytes, options) {
        assert.equal(options.flag, 'wx');
        assert.ok(!markers.has(path));
        markers.add(path);
      },
      readFileSync(path, encoding) {
        const name = path.replaceAll('\\', '/').split('/').at(-1);
        if (!Object.hasOwn(files, name))
          throw new Error('Unapproved offline file');
        return encoding ? files[name] : Buffer.from(files[name]);
      },
    };
    modules['node:child_process'] = {
      execFileSync(_command, args) {
        if (args[0] === 'status') return '';
        return args.at(-1) === 'HEAD' ? p.candidate.commit : p.candidate.tree;
      },
    };
    modules['node:fs/promises'] = {
      readdir: async () => proof().migrations.map((row) => row.name),
      readFile: async (path) =>
        Buffer.from(path.replaceAll('\\', '/').split('/').at(-2)),
    };
    const grants = globalThis.structuredClone(p.input.currentGrants);
    if (runtimeMode === 'grantMissing') grants.pop();
    if (runtimeMode === 'grantScope') grants[0].scope = 'ALL';
    if (runtimeMode === 'userInactive') current.user[0].active = false;
    if (runtimeMode === 'membershipChanged')
      current.memberships[0].department_id = 'other';
    if (runtimeMode === 'assignmentChanged')
      current.assignments[0].role_template_id = 'other';
    if (runtimeMode === 'credentialChanged')
      current.credential[0].password_hash = 'changed';
    if (runtimeMode === 'privateChanged')
      files['actor.private.json'] = JSON.stringify({
        ...privatePayload,
        password: 'changed',
      });
    const tables = {
      user_accounts: 'user',
      role_templates: 'role',
      role_assignments: 'assignments',
      department_memberships: 'memberships',
      local_credentials: 'credential',
    };
    const client = {
      connect: async () => {},
      end: async () => sql.push('END'),
      async query(query, params) {
        sql.push(query);
        if (query.startsWith('SELECT current_database'))
          return { rows: proof().identity };
        if (query.includes('FROM public._prisma_migrations'))
          return { rows: proof().applied };
        if (query.startsWith('SELECT id,role_template_id'))
          return { rows: grants };
        if (query.startsWith('SELECT c.id'))
          return { rows: [{ id: params[0] }] };
        if (query.startsWith('UPDATE role_assignments')) {
          current.assignments[0].active = false;
          current.assignments[0].version++;
          return { rowCount: 1, rows: [] };
        }
        const table = /FROM "([a-z_]+)"/u.exec(query)?.[1];
        return {
          rows: tables[table]
            ? current[tables[table]].map((row) => ({
                row: globalThis.structuredClone(row),
              }))
            : [],
        };
      },
    };
    modules['node:module'] = {
      createRequire() {
        calls.backend++;
        return (name) => {
          assert.equal(name, 'pg');
          return {
            Client: class {
              constructor() {
                calls.pg++;
                return client;
              }
            },
          };
        };
      },
    };
    modules['../../scripts/test-environment.mjs'] = {
      captureTestEnvironment() {
        calls.capture++;
        return { childEnvironment: { DATABASE_URL: url } };
      },
      validateBrowserTestDatabaseUrl() {
        return { connectionString: url };
      },
    };
  }
  function load(text, filename, extra = {}) {
    const exports = {};
    const context = {
      exports,
      URL,
      Buffer,
      process: { env: { ...environment }, cwd: () => 'offline-root' },
      require(name) {
        if (Object.hasOwn(extra, name)) return extra[name];
        if (!Object.hasOwn(modules, name))
          throw new Error(`Unapproved sandbox import ${name}`);
        return modules[name];
      },
    };
    vm.runInNewContext(
      ts.transpileModule(text, {
        fileName: filename,
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2023,
          esModuleInterop: true,
        },
      }).outputText,
      context,
    );
    return exports;
  }
  const support = load(source, 'support.js');
  const registered = [],
    hooks = [];
  let fixtures;
  function testStub(name, callback) {
    registered.push({ name, callback });
  }
  testStub.extend = (value) => {
    fixtures = value;
    return testStub;
  };
  testStub.describe = (_name, callback) => callback();
  testStub.beforeAll = (callback) => hooks.push(callback);
  load(specSource, 'spec.ts', {
    '@playwright/test': {
      test: testStub,
      expect: (value) => ({
        toBe: (expected) => assert.equal(value, expected),
      }),
    },
    '../support/case-section-record-ui-database.mjs': support,
  });
  const page = {
    goto: refused('http'),
    on: refused('http'),
    route: refused('http'),
    request: {
      get: refused('http'),
      post: refused('http'),
      put: refused('http'),
    },
  };
  const operation = refused('operation');
  const offline = {
    environment,
    capture: refused('capture'),
    openClient: refused('pg'),
    grant: refused('grant'),
    http: refused('http'),
  };
  return {
    calls,
    support,
    registered,
    hooks,
    fixtures,
    page,
    operation,
    offline,
    sql,
  };
}
function noEffects(f) {
  assert.deepEqual(f.calls, {
    capture: 0,
    backend: 0,
    pg: 0,
    http: 0,
    grant: 0,
    factory: 0,
    operation: 0,
  });
}

test('exact coordinated R2 tuple passes only the pure binding, not source admission', () => {
  assert.equal(assertSectionRecordUiBinding(valid), url);
});
const negatives = [
  ...[15433, 15436, 15437, 55432, 3206, 5186, 49123].map((port) => [
    `port ${port}`,
    both(url.replace(':15438/', `:${port}/`)),
  ]),
  ['missing CID', { DEV_COR_TEST_DATABASE_CONTAINER_ID: undefined }],
  [
    'short CID',
    {
      DEV_COR_TEST_DATABASE_CONTAINER_ID:
        valid.DEV_COR_TEST_DATABASE_CONTAINER_ID.slice(0, 12),
    },
  ],
  ['different CID', { DEV_COR_TEST_DATABASE_CONTAINER_ID: '0'.repeat(64) }],
  ['missing project', { DEV_COR_TEST_DATABASE_PROJECT: undefined }],
  ['wrong project', { DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-ui003' }],
  ['production', { NODE_ENV: 'production' }],
  ['missing effective URL', { DATABASE_URL: undefined }],
  ['missing override URL', { DEV_COR_TEST_DATABASE_URL: undefined }],
  [
    'different passwords',
    { DATABASE_URL: url.replace('offline-only', 'different') },
  ],
  ['remote host', both(url.replace('127.0.0.1', '192.0.2.1'))],
  ['alias host', both(url.replace('127.0.0.1', 'localhost'))],
  ['other database', both(url.replace('/dev_cor_test', '/other_test'))],
  ['other user', both(url.replace('dev_cor_test:', 'other_user:'))],
  ['empty password', both(url.replace('offline-only', ''))],
  ['wrong protocol', both(url.replace('postgresql:', 'http:'))],
  ...['?', '#', '?schema=public', '#public'].map((suffix) => [
    `suffix ${suffix}`,
    both(url + suffix),
  ]),
  ['missing runtime', { npm_config_user_agent: undefined }],
  ['wrong runtime', { npm_config_user_agent: 'pnpm/11.26.0' }],
  ['invalid URL', both('not-a-database-url')],
];
for (const [name, patch] of negatives) {
  test(`rejects ${name} with zero preparation side effects`, () => {
    assert.throws(() => assertSectionRecordUiBinding({ ...valid, ...patch }));
  });
}
test('exact157 evidence validates purely without admitting an operation', () => {
  assertSectionRecordUiDatabaseProof(valid, proof());
  const f = sandbox();
  assert.throws(() => f.support.assertSectionRecordUiSourceReady(), pending);
  noEffects(f);
});
for (const kind of [
  'capture',
  'validator',
  'source155',
  'source156',
  'tail',
  'duplicate',
  'badChecksum',
  'identity',
  'schema',
  'ledger155',
  'ledger156',
  'ledgerName',
  'ledgerChecksum',
  'unfinished',
  'rolledBack',
]) {
  test(`rejects ${kind} in the pure evidence validator`, () => {
    const p = proof();
    if (kind === 'capture') p.capturedDatabaseUrl += '?bad';
    if (kind === 'validator') p.validatedDatabaseUrl += '#bad';
    if (kind === 'source155') p.migrations.length = 155;
    if (kind === 'source156') p.migrations.length = 156;
    if (kind === 'tail') p.migrations[156].name = 'unapproved';
    if (kind === 'duplicate') p.migrations[0] = p.migrations[1];
    if (kind === 'badChecksum') p.migrations[0].checksum = 'bad';
    if (kind === 'identity') p.identity[0].username = 'other';
    if (kind === 'schema') p.identity[0].schema = 'other';
    if (kind === 'ledger155') p.applied.length = 155;
    if (kind === 'ledger156') p.applied.length = 156;
    if (kind === 'ledgerName') p.applied[3].migration_name = 'wrong';
    if (kind === 'ledgerChecksum') p.applied[3].checksum = '0'.repeat(64);
    if (kind === 'unfinished') p.applied[3].finished_at = null;
    if (kind === 'rolledBack') p.applied[3].rolled_back_at = 'rolled-back';
    assert.throws(() => assertSectionRecordUiDatabaseProof(valid, p));
  });
}
for (const entry of [
  'assertSectionRecordUiRunner',
  'createSectionRecordUiActor',
  'withSectionRecordUiDatabase',
  'ownSectionRecordUiCase',
  'revokeSectionRecordUiActor',
  'sectionRecordUiBaselineSecurity',
  'sectionRecordUiUploads',
  'sectionRecordUiSnapshot',
]) {
  test(`${entry} refuses before capture/backend/PG/HTTP/Grant even with injected dependencies`, async () => {
    const f = sandbox();
    await assert.rejects(f.support[entry](f.operation, f.offline), pending);
    noEffects(f);
  });
}
test('fixture constants cannot return an external source or fake actor/case', () => {
  const f = sandbox();
  assert.throws(() => f.support.sectionRecordUiFixture(), pending);
  noEffects(f);
});
test('no environment flag, alternate actor, or valid proof can unlock actual preparation', async () => {
  const f = sandbox({
    ...valid,
    ALLOW_UI_SOURCE: 'true',
    DEV_COR_UI_GRANT01_APPROVED: 'true',
  });
  assertSectionRecordUiDatabaseProof(valid, proof());
  await assert.rejects(
    f.support.createSectionRecordUiActor({ actor: 'alternate' }),
    pending,
  );
  noEffects(f);
});
test('all16 UI cases are discovered, without callbacks or skipped/fabricated acceptance', () => {
  const f = sandbox();
  assert.equal(f.registered.length, 16);
  assert.equal(f.hooks.length, 1);
  assert.match(f.registered.at(-1).name, /^revoking only this run actor/u);
  noEffects(f);
});
test('the real spec beforeAll refuses before any fixture or environment capture', async () => {
  const f = sandbox();
  await assert.rejects(f.hooks[0], pending);
  noEffects(f);
});
for (const fixtureName of ['actor', 'page', 'csrf']) {
  test(`real spec ${fixtureName} fixture refuses before any preparation/API callback`, async () => {
    const f = sandbox();
    await assert.rejects(
      f.fixtures[fixtureName](
        {
          baseURL: 'http://127.0.0.1:5174',
          page: f.page,
          actor: Object.freeze({ sentinel: 'not-an-account' }),
        },
        f.operation,
      ),
      pending,
    );
    noEffects(f);
  });
}
for (let index = 0; index < 16; index++) {
  test(`real discovered UI callback ${index + 1} also refuses without reaching HTTP or Grant`, async () => {
    const f = sandbox();
    await assert.rejects(
      f.registered[index].callback({
        page: f.page,
        actor: Object.freeze({ sentinel: 'not-an-account' }),
        csrf: 'offline-only',
      }),
      pending,
    );
    noEffects(f);
  });
}
test('module imports are inert and cannot create actors/Grants or write business facts', () => {
  assert.doesNotMatch(
    source,
    /createSectionUploadActor|ownSectionUploadCase|revokeSectionUploadActor|sectionUploadSnapshot|createHistoricalRecordActor|import[^;]+database\.mjs/u,
  );
  assert.doesNotMatch(
    source.replace(
      /UPDATE role_assignments SET active=false,version=version\+1,updated_at=now\(\) WHERE id=\$1 AND user_id=\$2 AND role_template_id=\$3 AND department_id=\$4 AND active=true/u,
      '',
    ),
    /(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|TRUNCATE\s|DROP\s|ALTER\s|execSync|spawn\(|seedCore|clearCore|dropFaults|disconnectDatabase)/iu,
  );
  assert.doesNotMatch(specSource, /test\.skip|test\.fixme|core-lead-database/u);
});
test('binding errors never echo either URL or password', () => {
  const secret = 'never-print-this-password';
  for (const patch of [
    { DATABASE_URL: url.replace('offline-only', secret) },
    both(`invalid://${secret}`),
  ]) {
    try {
      assertSectionRecordUiBinding({ ...valid, ...patch });
      assert.fail('Expected a sanitized binding failure');
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes(secret));
      assert.ok(!String(error).includes('postgresql://'));
    }
  }
});

test('sealed synthetic files permit only current-role-verified offline operation, never a factory', async () => {
  const f = sandbox(valid, 'valid');
  f.support.assertSectionRecordUiSourceReady();
  noEffects(f);
  await f.support.withSectionRecordUiDatabase(async () => {
    f.calls.operation++;
  });
  assert.equal(f.calls.capture, 1);
  assert.equal(f.calls.pg, 1);
  assert.equal(f.calls.operation, 1);
  assert.equal(f.calls.factory, 0);
  assert.equal(f.calls.grant, 0);
  assert.ok(f.sql.at(-1) === 'END');
});
for (const mode of [
  'grantMissing',
  'grantScope',
  'userInactive',
  'membershipChanged',
  'assignmentChanged',
  'credentialChanged',
]) {
  test(`current live role ${mode} rejects before business callback in offline PG double`, async () => {
    const f = sandbox(valid, mode);
    await assert.rejects(
      f.support.withSectionRecordUiDatabase(async () => {
        f.calls.operation++;
      }),
    );
    assert.equal(f.calls.operation, 0);
    assert.equal(f.calls.http, 0);
    assert.equal(f.calls.grant, 0);
    assert.equal(f.calls.factory, 0);
    assert.ok(f.sql.at(-1) === 'END');
  });
}
test('existing actor restores without factory, exact-case source binds, revocation is terminal', async () => {
  const f = sandbox(valid, 'valid');
  const actor = await f.support.createSectionRecordUiActor(
    'one-synthetic-scenario',
  );
  const fixture = f.support.sectionRecordUiFixture();
  const caseId = '00000000-0000-4000-8000-000000000200';
  await f.support.ownSectionRecordUiCase(
    caseId,
    actor.userId,
    fixture.sourcePrefix + 'one-source',
  );
  await f.support.revokeSectionRecordUiActor(actor.userId);
  const captures = f.calls.capture;
  await assert.rejects(
    f.support.createSectionRecordUiActor('replacement'),
    pending,
  );
  assert.equal(f.calls.capture, captures);
  await f.support.sectionRecordUiSnapshot(caseId);
  assert.equal(f.sql.filter((query) => query.startsWith('UPDATE')).length, 1);
  assert.equal(f.calls.factory, 0);
  assert.equal(f.calls.grant, 0);
  assert.equal(f.calls.http, 0);
});
test('changed private payload cannot restore or manufacture a replacement actor', async () => {
  const f = sandbox(valid, 'privateChanged');
  await assert.rejects(f.support.createSectionRecordUiActor('scenario'));
  assert.equal(f.calls.factory, 0);
  assert.equal(f.calls.grant, 0);
});

test('persisted terminal intent refuses before capture even in a fresh module', () => {
  const f = sandbox(valid, 'terminalMarker');
  assert.throws(() => f.support.assertSectionRecordUiSourceReady(), pending);
  noEffects(f);
});
test('same actions under forged seventh Grant IDs and matching forged receipt are rejected', () => {
  const p = admittedProof();
  const wrong = '00000000-0000-4000-8000-000000000999';
  p.input.currentGrants[41].id = wrong;
  p.input.insertedGrantIds[6] = wrong;
  assert.throws(() => validateProof(p));
});
