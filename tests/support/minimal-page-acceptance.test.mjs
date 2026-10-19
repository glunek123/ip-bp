import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {
  assertMinimalPageActor,
  assertMinimalPageDatabaseDiff,
  assertMinimalPageStartupWindow,
  assertPreservedEfAuthorization,
  assertPreservedEfEvidence,
  assertPreservedEfFiles,
  assertPreservedEfLiveState,
  assertPreservedEfRows,
  bindMinimalPageSession,
  closeMinimalPageSession,
  createMinimalPageRequestBudget,
  createMinimalPageAcceptance,
  createPreservedEfRequestBudget,
  formatMinimalPagePreflightDiagnostic,
  minimalPageScopes,
  parseMinimalPagePreflightDiagnostic,
  preservedEfCheckpoint,
  readPreservedEfEvidence,
  snapshotPreservedEfRows,
} from './minimal-page-acceptance.mjs';

const leadConfigSource = await readFile(
  new URL('../../playwright.lead-minimal-page.config.ts', import.meta.url),
  'utf8',
);
const originalConfigSource = await readFile(
  new URL('../../playwright.minimal-pages.config.ts', import.meta.url),
  'utf8',
);

test('Lead config retains the original pre-server admission block', () => {
  const admission = (source) =>
    source.slice(
      source.indexOf('if (!listing) {'),
      source.indexOf('const runtime ='),
    );
  assert.equal(admission(leadConfigSource), admission(originalConfigSource));
});

function loadLeadConfigOffline(argv, childError) {
  const calls = [];
  const captured = { childKinds: [], r2Checks: 0, runtimePlans: 0 };
  const output = ts.transpileModule(leadConfigSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  const sandbox = {
    exports,
    __dirname: process.cwd(),
    process: { argv, env: {} },
    require(name) {
      if (name === 'node:child_process')
        return {
          execFileSync(_command, args) {
            calls.push('child');
            captured.childKinds.push(JSON.parse(args[args.length - 1]));
            if (childError) throw { stderr: Buffer.from('safe diagnostic') };
            return Buffer.from(
              JSON.stringify({
                runId: '11111111-1111-4111-8111-111111111111',
                deadlineIso: '2026-10-19T04:30:00.000Z',
              }),
            );
          },
        };
      if (name === 'node:os') return { tmpdir };
      if (name === 'node:path') return { resolve };
      if (name === '@playwright/test')
        return {
          defineConfig: (value) => value,
          devices: { 'Desktop Chrome': {} },
        };
      if (name === './tests/support/minimal-page-acceptance.mjs')
        return {
          assertMinimalPageR2Binding() {
            calls.push('R2');
            captured.r2Checks++;
          },
          parseMinimalPagePreflightDiagnostic() {
            return {
              phase: 'PRESERVED_EF_LIVE',
              code: 'MINIMAL_PAGE_PRESERVED_EF_LIVE',
              causeCode: 'MINIMAL_PAGE_PRESERVED_EF_ROWS',
            };
          },
        };
      if (name === './scripts/managed-test-runtime.mjs')
        return {
          createManagedTestRuntime: () => ({}),
          planManagedTestRuntime: () => {
            captured.runtimePlans++;
            return {
              baseURL: 'http://127.0.0.1:5174',
              webServer: ['synthetic'],
            };
          },
        };
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(output, sandbox, {
    filename: 'playwright.lead-minimal-page.config.ts',
  });
  return { config: exports.default, calls, captured };
}

test('Lead config admits only Lead across CLI and reloaded worker argument shapes', () => {
  for (const argv of [
    [
      'node',
      'cli.js',
      'test',
      'tests/e2e/lead-batch-push-minimal-page.spec.ts',
    ],
    ['node', 'loaderProcessEntry.js'],
    ['node', 'workerProcessEntry.js'],
    [
      'node',
      'cli.js',
      'test',
      'tests/e2e/execution-feedback-minimal-page.spec.ts',
    ],
    [],
  ]) {
    const { config, calls, captured } = loadLeadConfigOffline(argv);
    assert.deepEqual(captured.childKinds, [['LEAD_BATCH']]);
    assert.deepEqual(calls, ['R2', 'child']);
    assert.equal(captured.runtimePlans, 1);
    assert.deepEqual(Array.from(config.testMatch), [
      'lead-batch-push-minimal-page.spec.ts',
    ]);
    assert.equal(
      config.metadata.minimalPageWindow.runId,
      '11111111-1111-4111-8111-111111111111',
    );
    assert.deepEqual(Array.from(config.webServer), ['synthetic']);
  }
});

test('Lead config listing stays offline and interactive or failed admission remains closed', () => {
  const listing = loadLeadConfigOffline(['node', 'cli.js', 'test', '--list']);
  assert.equal(listing.captured.r2Checks, 0);
  assert.deepEqual(listing.captured.childKinds, []);
  assert.deepEqual(Array.from(listing.config.webServer), []);
  assert.throws(
    () => loadLeadConfigOffline(['node', 'cli.js', '--ui']),
    /interactive execution/u,
  );
  assert.throws(
    () => loadLeadConfigOffline(['node', 'cli.js', 'test'], true),
    /PRESERVED_EF_LIVE\/MINIMAL_PAGE_PRESERVED_EF_LIVE\/MINIMAL_PAGE_PRESERVED_EF_ROWS/u,
  );
});

const kind = 'EF_FEEDBACK';
const scope = minimalPageScopes[kind];
const cookie = 'strictly-synthetic-cookie-value';
const original = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: scope.userId,
  department_id: scope.departmentId,
  token_digest: '1'.repeat(64),
  created_at: '2026-10-17T09:50:00.000Z',
  expires_at: '2026-10-18T09:50:00.000Z',
  revoked_at: null,
};
const current = {
  ...original,
  id: '22222222-2222-4222-8222-222222222222',
  token_digest: createHash('sha256').update(cookie).digest('hex'),
  created_at: '2026-10-17T10:00:01.000Z',
  expires_at: '2026-10-18T10:00:01.000Z',
};
const bind = (after = [original, current], value = cookie) =>
  bindMinimalPageSession(
    kind,
    [original],
    after,
    value,
    '2026-10-17T10:00:00.000Z',
    '2026-10-17T10:00:02.000Z',
  );

test('import and factory construction do no capture, DB or private reads', () => {
  assert.throws(
    () =>
      createMinimalPageAcceptance(kind, {
        environment: {},
        root: process.cwd(),
      }),
    /PRESERVED_EF_MODE/u,
  );
  assert.equal(
    typeof createMinimalPageAcceptance(kind, { preflightOnly: true }).prepare,
    'function',
  );
  const support = createMinimalPageAcceptance(kind, {
    mode: 'PRESERVED_EF_CHECKPOINT',
    environment: {},
    root: process.cwd(),
  });
  assert.equal(typeof support.prepare, 'function');
  assert.equal(typeof support.closeSession, 'function');
});

test('pre-server diagnostic survives git warnings and exposes only safe phase and codes', () => {
  const error = Object.assign(
    new Error('secret SQL and URL must never appear'),
    {
      phase: 'PRESERVED_EF_LIVE',
      code: 'MINIMAL_PAGE_PRESERVED_EF_LIVE',
      causeCode: '42P01',
      sql: 'secret SQL',
      url: 'secret URL',
    },
  );
  const warning = 'warning: unable to access git ignore: Permission denied\n';
  const encoded = formatMinimalPagePreflightDiagnostic(error);
  const parsed = parseMinimalPagePreflightDiagnostic(`${warning}${encoded}\n`);
  assert.deepEqual(parsed, {
    phase: 'PRESERVED_EF_LIVE',
    code: 'MINIMAL_PAGE_PRESERVED_EF_LIVE',
    causeCode: '42P01',
  });
  assert.equal(encoded.includes('secret'), false);
  assert.deepEqual(
    parseMinimalPagePreflightDiagnostic(`${warning}MINIMAL_PAGE_PREFLIGHT`),
    {
      phase: 'PREFLIGHT',
      code: 'MINIMAL_PAGE_PREFLIGHT',
      causeCode: 'UNCLASSIFIED',
    },
  );
  assert.equal(
    parseMinimalPagePreflightDiagnostic(
      formatMinimalPagePreflightDiagnostic({
        phase: 'SQL $1',
        code: 'MINIMAL_PAGE_R2_BINDING; secret',
        causeCode: 'DATABASE_PASSWORD',
      }),
    ).code,
    'MINIMAL_PAGE_PREFLIGHT',
  );
  assert.equal(
    parseMinimalPagePreflightDiagnostic(
      formatMinimalPagePreflightDiagnostic({
        phase: 'PG_CONNECT',
        code: 'MINIMAL_PAGE_PG_CONNECT',
        causeCode: 'TOKEN',
      }),
    ).causeCode,
    'UNCLASSIFIED',
  );
  assert.equal(
    parseMinimalPagePreflightDiagnostic(
      formatMinimalPagePreflightDiagnostic({
        phase: 'PG_CONNECT',
        code: 'MINIMAL_PAGE_DATABASE_PASSWORD',
        causeCode: 'MINIMAL_PAGE_DATABASE_PASSWORD',
      }),
    ).causeCode,
    'UNCLASSIFIED',
  );
  assert.equal(
    parseMinimalPagePreflightDiagnostic(`${encoded}\n${encoded}`).code,
    'MINIMAL_PAGE_PREFLIGHT',
  );
  assert.equal(
    parseMinimalPagePreflightDiagnostic(
      formatMinimalPagePreflightDiagnostic({
        phase: 'R2_BINDING',
        code: 'MINIMAL_PAGE_R2_BINDING',
        causeCode: 'ENOENT',
      }),
    ).code,
    'MINIMAL_PAGE_R2_BINDING',
  );
});

test('database diff rejects old-row drift, extra targets, and counter overrun', () => {
  const sizes = {
    leads: 0,
    lead_products: 0,
    lead_infringements: 0,
    lead_command_receipts: 0,
    lead_batch_push_receipts: 0,
    cases: 1,
    case_external_entries: 1,
    case_external_entry_receipts: 1,
    case_trial_rounds: 1,
    upload_drafts: 2,
    materials: 2,
    content_versions: 2,
    material_references: 2,
    case_execution_mailings: 1,
    case_execution_mailing_versions: 1,
    case_execution_mailing_receipts: 1,
    case_execution_filings: 1,
    case_execution_filing_versions: 1,
    case_execution_filing_receipts: 1,
    case_execution_filing_feedbacks: 2,
    case_execution_filing_followup_receipts: 2,
    audit_events: 5,
  };
  const before = new Map(
    Object.keys(sizes).map((table) => [
      table,
      new Map([['old', 'a'.repeat(64)]]),
    ]),
  );
  const after = new Map(
    Object.entries(sizes).map(([table, count]) => [
      table,
      new Map([
        ...before.get(table),
        ...Array.from({ length: count }, (_, index) => [
          table === 'cases'
            ? '11111111-1111-4111-8111-111111111111'
            : `${table}-${index}`,
          'b'.repeat(64),
        ]),
      ]),
    ]),
  );
  const oldCounter = new Map([['2026-10-17', 5]]),
    newCounter = new Map([['2026-10-17', 6]]);
  assert.equal(
    assertMinimalPageDatabaseDiff(
      'EF_FEEDBACK',
      before,
      after,
      oldCounter,
      newCounter,
      true,
      '11111111-1111-4111-8111-111111111111',
    ),
    true,
  );
  const oldChanged = new Map(after);
  oldChanged.set(
    'materials',
    new Map([...after.get('materials'), ['old', 'c'.repeat(64)]]),
  );
  assert.throws(() =>
    assertMinimalPageDatabaseDiff(
      'EF_FEEDBACK',
      before,
      oldChanged,
      oldCounter,
      newCounter,
      true,
      '11111111-1111-4111-8111-111111111111',
    ),
  );
  const extra = new Map(after);
  extra.set(
    'cases',
    new Map([...after.get('cases'), ['other', 'b'.repeat(64)]]),
  );
  assert.throws(() =>
    assertMinimalPageDatabaseDiff(
      'EF_FEEDBACK',
      before,
      extra,
      oldCounter,
      newCounter,
      true,
      '11111111-1111-4111-8111-111111111111',
    ),
  );
  assert.throws(() =>
    assertMinimalPageDatabaseDiff(
      'EF_FEEDBACK',
      before,
      after,
      oldCounter,
      new Map([['2026-10-17', 7]]),
      true,
      '11111111-1111-4111-8111-111111111111',
    ),
  );
  assert.throws(
    () =>
      assertMinimalPageDatabaseDiff(
        'EF_FEEDBACK',
        before,
        after,
        oldCounter,
        newCounter,
        true,
        '22222222-2222-4222-8222-222222222222',
      ),
    /CASE_DIFF/u,
  );
});

test('Lead database diff accepts exact two leads and rejects Case or Lead drift', () => {
  const ids = [
    'b93c0aff-c548-4839-9571-442dfcff5393',
    'a511ba62-da24-4ddd-a739-1635bc637254',
  ];
  const sizes = {
    cases: 0,
    case_external_entries: 0,
    case_external_entry_receipts: 0,
    case_trial_rounds: 0,
    upload_drafts: 0,
    materials: 0,
    content_versions: 0,
    material_references: 0,
    case_execution_mailings: 0,
    case_execution_mailing_versions: 0,
    case_execution_mailing_receipts: 0,
    case_execution_filings: 0,
    case_execution_filing_versions: 0,
    case_execution_filing_receipts: 0,
    case_execution_filing_feedbacks: 0,
    case_execution_filing_followup_receipts: 0,
    leads: 2,
    lead_products: 2,
    lead_infringements: 2,
    lead_command_receipts: 2,
    lead_batch_push_receipts: 1,
    audit_events: 4,
  };
  const oldDigest = 'a'.repeat(64);
  const newDigest = 'b'.repeat(64);
  const before = new Map(
    Object.keys(sizes).map((table) => [table, new Map([['old', oldDigest]])]),
  );
  const after = new Map(
    Object.entries(sizes).map(([table, count]) => [
      table,
      new Map([
        ...before.get(table),
        ...Array.from({ length: count }, (_, index) => [
          table === 'leads' ? ids[index] : `${table}-${index}`,
          newDigest,
        ]),
      ]),
    ]),
  );
  const counterBefore = new Map([['2026-10-15', 228]]);
  const counterAfter = new Map([...counterBefore, ['2026-10-19', 2]]);
  const check = (current, registered = ids) =>
    assertMinimalPageDatabaseDiff(
      'LEAD_BATCH',
      before,
      current,
      counterBefore,
      counterAfter,
      true,
      registered,
    );

  assert.equal(check(after), true);
  const extraCase = new Map(after);
  extraCase.set(
    'cases',
    new Map([...after.get('cases'), ['new-case', newDigest]]),
  );
  assert.throws(() => check(extraCase), /ROW_DIFF/u);
  const changedCase = new Map(after);
  changedCase.set('cases', new Map([['old', newDigest]]));
  assert.throws(() => check(changedCase), /OLD_ROW_DRIFT/u);
  assert.throws(
    () => check(after, ['22222222-2222-4222-8222-222222222222', ids[1]]),
    /LEAD_DIFF/u,
  );
});

test('new login binds one exact session and rejects old, foreign, ambiguous and stale rows', () => {
  assert.equal(bind().id, current.id);
  assert.throws(() => bind([original]));
  assert.throws(() =>
    bind([original, current], 'wrong-synthetic-cookie-value'),
  );
  assert.throws(() =>
    bind([
      original,
      current,
      { ...current, id: '33333333-3333-4333-8333-333333333333' },
    ]),
  );
  assert.throws(() =>
    bind([
      original,
      { ...current, user_id: '33333333-3333-4333-8333-333333333333' },
    ]),
  );
  assert.throws(() =>
    bind([
      original,
      { ...current, department_id: '10000000-0000-4000-8000-000000000002' },
    ]),
  );
  assert.throws(() =>
    bind([original, { ...current, created_at: '2026-10-17T09:59:59.000Z' }]),
  );
  assert.throws(() =>
    bind([original, { ...current, expires_at: current.created_at }]),
  );
});

test('logout checks exact session, then permits one guarded fallback only after failure', async () => {
  const binding = bind();
  let updates = 0;
  let reads = 0;
  let row = { ...current };
  const delegates = {
    readSession: async () => {
      reads += 1;
      return row;
    },
    logout: async () => {
      throw new Error('synthetic failure');
    },
    guardedRevoke: async () => {
      updates += 1;
      row = { ...row, revoked_at: '2026-10-17T10:01:00.000Z' };
      return 1;
    },
  };
  assert.deepEqual(await closeMinimalPageSession(kind, binding, delegates), {
    revoked: true,
    fallback: true,
    logoutSucceeded: false,
  });
  assert.equal(updates, 1);
  assert.equal(reads, 2);
  updates = 0;
  await assert.rejects(
    closeMinimalPageSession(kind, { ...binding, id: original.id }, delegates),
  );
  assert.equal(updates, 0);
  await assert.rejects(
    closeMinimalPageSession('LEAD_BATCH', binding, delegates),
  );
  assert.equal(updates, 0);
  await assert.rejects(
    closeMinimalPageSession(kind, binding, {
      ...delegates,
      readSession: async () => ({ ...current, token_digest: '0'.repeat(64) }),
    }),
  );
  assert.equal(updates, 0);
  await assert.rejects(
    closeMinimalPageSession(kind, binding, {
      ...delegates,
      readSession: async () => ({
        ...current,
        created_at: '2026-10-17T09:50:00.000Z',
      }),
    }),
  );
  assert.equal(updates, 0);
});

test('unbound login attempts one normal logout, then always blocks without a DB fallback', async () => {
  for (const logoutError of [null, new Error('synthetic UI failure')]) {
    let logouts = 0;
    let reads = 0;
    let updates = 0;
    await assert.rejects(
      closeMinimalPageSession(kind, null, {
        logout: async () => {
          logouts += 1;
          if (logoutError) throw logoutError;
        },
        readSession: async () => {
          reads += 1;
          return current;
        },
        guardedRevoke: async () => {
          updates += 1;
          return 1;
        },
      }),
      (error) => {
        assert.equal(error.code, 'MINIMAL_PAGE_SESSION_UNBOUND');
        assert.equal(error.cause, logoutError ?? undefined);
        return true;
      },
    );
    assert.equal(logouts, 1);
    assert.equal(reads, 0);
    assert.equal(updates, 0);
  }
});

test('valid normal logout has no guarded UPDATE; unresolved failure cannot pass', async () => {
  const binding = bind();
  let updates = 0;
  const success = await closeMinimalPageSession(kind, binding, {
    logout: async () => {},
    readSession: async () => ({
      ...current,
      revoked_at: '2026-10-17T10:02:00.000Z',
    }),
    guardedRevoke: async () => {
      updates += 1;
      return 1;
    },
  });
  assert.deepEqual(success, {
    revoked: true,
    fallback: false,
    logoutSucceeded: true,
  });
  const uncertain = await closeMinimalPageSession(kind, binding, {
    logout: async () => {
      throw new Error('synthetic UI failure');
    },
    readSession: async () => ({
      ...current,
      revoked_at: '2026-10-17T10:02:00.000Z',
    }),
    guardedRevoke: async () => {
      updates += 1;
      return 1;
    },
  });
  assert.deepEqual(uncertain, {
    revoked: true,
    fallback: false,
    logoutSucceeded: false,
  });
  assert.equal(updates, 0);
  await assert.rejects(
    closeMinimalPageSession(kind, binding, {
      logout: async () => {},
      readSession: async () => current,
      guardedRevoke: async () => {
        updates += 1;
        return 1;
      },
    }),
  );
  assert.equal(updates, 0);
});

test('startup rejects old candidates, throttle rows, day crossings and long windows', () => {
  const input = {
    startIso: '2026-10-17T10:00:00.000Z',
    deadlineIso: '2026-10-17T10:15:00.000Z',
    hearingCandidates: 0,
    cleanupCandidates: 0,
    throttleRows: 0,
    sameShanghaiDay: true,
  };
  assert.equal(assertMinimalPageStartupWindow(input), true);
  for (const delta of [
    { hearingCandidates: 1 },
    { cleanupCandidates: 1 },
    { throttleRows: 1 },
    { sameShanghaiDay: false },
    { deadlineIso: '2026-10-17T10:15:01.000Z' },
  ])
    assert.throws(() => assertMinimalPageStartupWindow({ ...input, ...delta }));
});

test('EF actor admits only the sealed Demo A terminal authorization state', () => {
  const grants = scope.actions.map((action, index) => ({
    id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
    action,
    scope: 'DEPARTMENT',
    role_template_id: scope.roleId,
  }));
  const rows = {
    user: {
      id: scope.userId,
      active: true,
      account_type: 'INTERNAL',
      authorization_revision: 3,
    },
    role: {
      id: scope.roleId,
      department_id: scope.departmentId,
      active: true,
      version: 1,
    },
    assignment: {
      id: scope.assignmentId,
      user_id: scope.userId,
      department_id: scope.departmentId,
      role_template_id: scope.roleId,
      active: true,
      version: 1,
    },
    membership: {
      id: scope.membershipId,
      user_id: scope.userId,
      department_id: scope.departmentId,
      active: true,
    },
    credential: { id: scope.credentialId, user_id: scope.userId },
    grants,
    extraRole: {
      id: '49f006dd-1ee8-4399-aee8-41788b1035da',
      department_id: scope.departmentId,
      active: false,
      version: 2,
    },
    extraAssignment: {
      id: 'a3af87ea-0306-435f-aaad-757d983bf166',
      user_id: scope.userId,
      department_id: scope.departmentId,
      role_template_id: '49f006dd-1ee8-4399-aee8-41788b1035da',
      active: true,
      version: 1,
    },
    extraGrants: [
      ['721bec1c-0973-458c-8f80-930da871acaa', 'settlement.read'],
      ['4e43d8cd-bf88-4ace-8614-a57f90413e61', 'settlement.terms.update'],
      ['f807bbb8-8058-4cb0-80d7-7ecfacdc6d61', 'settlement.launch'],
      ['33b56a6f-32bf-4df9-84ed-a5f1ecbd5b63', 'settlement.bill.create'],
      ['147188f5-2bb7-4ade-979f-ad31bbf6441f', 'settlement.bill.cancel'],
      ['732ed253-6342-4fd2-810a-ad6d7d400629', 'fee.read'],
      ['33cd9343-0c68-4565-8086-1de6fc85979a', 'fee.create'],
      ['f28907b7-3f33-4b67-96a4-e98ff6c20455', 'fee.update'],
      ['4494e01c-36aa-4e5c-94a9-8bf911344337', 'fee.launch'],
      ['efdb2d45-9a83-44ce-aab9-fd38c5b69e53', 'fee.delete'],
      ['0d5a2f46-b4a8-451d-b9b7-76a9caacdb7a', 'evidence.read'],
      ['b7311efd-6767-4f9c-adce-6e9e6c33cc55', 'evidence.edit'],
      ['a444642d-4614-4b52-970a-80f54cfebff2', 'evidence.bulk-status'],
      ['9c6e728e-ebe7-4c4b-bcc5-d61a9e2e0db3', 'evidence.export'],
    ].map(([id, action]) => ({
      id,
      action,
      scope: 'DEPARTMENT',
      role_template_id: '49f006dd-1ee8-4399-aee8-41788b1035da',
    })),
    activeAssignments: [
      { id: scope.assignmentId },
      { id: 'a3af87ea-0306-435f-aaad-757d983bf166' },
    ],
    activeMemberships: [{ id: scope.membershipId }],
    roleAssignments: [{ id: scope.assignmentId }],
    extraRoleAssignments: [{ id: 'a3af87ea-0306-435f-aaad-757d983bf166' }],
  };
  assert.equal(assertMinimalPageActor(kind, rows, grants), scope);
  assert.throws(() =>
    assertMinimalPageActor(kind, { ...rows, grants: grants.slice(1) }, grants),
  );
  assert.throws(() =>
    assertMinimalPageActor(
      kind,
      {
        ...rows,
        activeAssignments: [...rows.activeAssignments, { id: 'extra' }],
      },
      grants,
    ),
  );
  assert.throws(() =>
    assertMinimalPageActor(
      kind,
      {
        ...rows,
        activeMemberships: [...rows.activeMemberships, { id: 'extra' }],
      },
      grants,
    ),
  );
  assert.throws(() =>
    assertMinimalPageActor(
      kind,
      { ...rows, grants: [...grants, { ...grants[0], id: 'extra' }] },
      grants,
    ),
  );
  assert.throws(() =>
    assertMinimalPageActor(
      kind,
      { ...rows, user: { ...rows.user, authorization_revision: 2 } },
      grants,
    ),
  );
  for (const [field, value] of [
    ['id', 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'],
    ['active', true],
    ['version', 1],
    ['version', 3],
    ['department_id', '10000000-0000-4000-8000-000000000002'],
  ])
    assert.throws(() =>
      assertMinimalPageActor(
        kind,
        { ...rows, extraRole: { ...rows.extraRole, [field]: value } },
        grants,
      ),
    );
  for (const [field, value] of [
    ['id', 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'],
    ['user_id', 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'],
    ['active', false],
    ['version', 2],
    ['department_id', '10000000-0000-4000-8000-000000000002'],
    ['role_template_id', scope.roleId],
  ])
    assert.throws(() =>
      assertMinimalPageActor(
        kind,
        {
          ...rows,
          extraAssignment: { ...rows.extraAssignment, [field]: value },
        },
        grants,
      ),
    );
  for (const extraGrants of [
    rows.extraGrants.slice(1),
    [...rows.extraGrants, { ...rows.extraGrants[0], id: 'extra' }],
    [
      { ...rows.extraGrants[0], id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' },
      ...rows.extraGrants.slice(1),
    ],
    [{ ...rows.extraGrants[0], scope: 'GLOBAL' }, ...rows.extraGrants.slice(1)],
    [
      { ...rows.extraGrants[0], role_template_id: scope.roleId },
      ...rows.extraGrants.slice(1),
    ],
    [
      { ...rows.extraGrants[0], action: 'customer.read' },
      ...rows.extraGrants.slice(1),
    ],
  ])
    assert.throws(() =>
      assertMinimalPageActor(kind, { ...rows, extraGrants }, grants),
    );
  assert.throws(() =>
    assertMinimalPageActor(
      kind,
      { ...rows, activeAssignments: rows.activeAssignments.slice(0, 1) },
      grants,
    ),
  );
  assert.throws(() =>
    assertMinimalPageActor(
      kind,
      {
        ...rows,
        activeAssignments: [
          { id: scope.assignmentId },
          { id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' },
        ],
      },
      grants,
    ),
  );
  assert.throws(() =>
    assertMinimalPageActor(
      kind,
      {
        ...rows,
        activeAssignments: [
          ...rows.activeAssignments,
          { id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' },
        ],
      },
      grants,
    ),
  );
  assert.throws(() =>
    assertMinimalPageActor(
      kind,
      {
        ...rows,
        extraRoleAssignments: [
          ...rows.extraRoleAssignments,
          { id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' },
        ],
      },
      grants,
    ),
  );
  assert.throws(() =>
    assertMinimalPageActor(
      kind,
      { ...rows, extraRoleAssignments: [{ id: scope.assignmentId }] },
      grants,
    ),
  );
});

test('lead actor keeps the original single assignment and revision guard', () => {
  const lead = minimalPageScopes.LEAD_BATCH;
  const grants = lead.actions.map((action, index) => ({
    id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
    action,
    scope: 'DEPARTMENT',
    role_template_id: lead.roleId,
  }));
  const rows = {
    user: {
      id: lead.userId,
      active: true,
      account_type: 'INTERNAL',
      authorization_revision: 1,
    },
    role: {
      id: lead.roleId,
      department_id: lead.departmentId,
      active: true,
      version: 1,
    },
    assignment: {
      id: lead.assignmentId,
      user_id: lead.userId,
      department_id: lead.departmentId,
      role_template_id: lead.roleId,
      active: true,
      version: 1,
    },
    membership: {
      id: lead.membershipId,
      user_id: lead.userId,
      department_id: lead.departmentId,
      active: true,
    },
    credential: { id: lead.credentialId, user_id: lead.userId },
    grants,
    activeAssignments: [{ id: lead.assignmentId }],
    activeMemberships: [{ id: lead.membershipId }],
    roleAssignments: [{ id: lead.assignmentId }],
  };
  assert.equal(assertMinimalPageActor('LEAD_BATCH', rows, grants), lead);
  assert.throws(() =>
    assertMinimalPageActor(
      'LEAD_BATCH',
      { ...rows, user: { ...rows.user, authorization_revision: 3 } },
      grants,
    ),
  );
  assert.throws(() =>
    assertMinimalPageActor(
      'LEAD_BATCH',
      {
        ...rows,
        activeAssignments: [...rows.activeAssignments, { id: 'extra' }],
      },
      grants,
    ),
  );
});

test('request budgets pin run fixtures, body anchors, and exact batch targets', () => {
  const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const url = (path) => `http://127.0.0.1:5174${path}`;
  const lead = createMinimalPageRequestBudget('LEAD_BATCH');
  lead.setRunId(runId, 'synthetic-user');
  assert.throws(() =>
    lead.admit('POST', 'https://example.test/api/v1/auth/login'),
  );
  lead.admit('GET', url('/leads?status=open'));
  lead.admit(
    'POST',
    url('/api/v1/auth/login'),
    JSON.stringify({
      username: 'synthetic-user',
      password: 'synthetic-password',
    }),
  );
  assert.throws(() =>
    lead.admit(
      'POST',
      url('/api/v1/auth/login'),
      JSON.stringify({ username: 'other', password: 'synthetic-password' }),
    ),
  );
  const leadBody = (index) => ({
    customerId: '50000000-0000-4000-8000-000000000002',
    rightsHolderId: '60000000-0000-4000-8000-000000000001',
    caseType: 'CIVIL',
    infringementTypes: ['TRADEMARK'],
    source: 'ONLINE',
    platform: 'TAOBAO',
    foundAt: new Date().toISOString(),
    shopName: `minimal-page:${runId}:${index}`,
    needDisclose: false,
    products: [
      {
        title: `${runId}-product-${index}`,
        quantity: 1,
        unitPrice: '1.00',
        commentCount: 0,
      },
    ],
    leadScreenshotContentVersionIds: [],
  });
  assert.throws(() =>
    lead.admit(
      'POST',
      url('/api/v1/leads'),
      JSON.stringify({ ...leadBody(1), customerId: 'old-customer' }),
    ),
  );
  assert.throws(() =>
    lead.admit(
      'POST',
      url('/api/v1/leads'),
      JSON.stringify({
        ...leadBody(1),
        reservedLeadId: '11111111-1111-4111-8111-111111111111',
      }),
    ),
  );
  lead.admit('POST', url('/api/v1/leads'), JSON.stringify(leadBody(1)));
  lead.admit('POST', url('/api/v1/leads'), JSON.stringify(leadBody(2)));
  const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ];
  const batch = (items) => JSON.stringify({ items });
  assert.throws(() =>
    lead.admit(
      'POST',
      url('/api/v1/leads/batch-push'),
      batch(ids.map((leadId) => ({ leadId, expectedVersion: 1 }))),
    ),
  );
  lead.setLeads(ids);
  assert.throws(() =>
    lead.admit(
      'POST',
      url('/api/v1/leads/batch-push'),
      batch([
        { leadId: ids[0], expectedVersion: 1 },
        { leadId: ids[0], expectedVersion: 1 },
      ]),
    ),
  );
  assert.throws(() =>
    lead.admit(
      'POST',
      url('/api/v1/leads/batch-push'),
      batch([
        { leadId: ids[0], expectedVersion: 1 },
        { leadId: '33333333-3333-4333-8333-333333333333', expectedVersion: 1 },
      ]),
    ),
  );
  assert.throws(() =>
    lead.admit(
      'POST',
      url('/api/v1/leads/batch-push'),
      batch([
        { leadId: ids[0], expectedVersion: 1 },
        { leadId: ids[1], expectedVersion: 2 },
      ]),
    ),
  );
  assert.throws(() =>
    lead.admit(
      'POST',
      url('/api/v1/leads/batch-push'),
      JSON.stringify({
        idempotencyKey: 'extra',
        items: ids.map((leadId) => ({ leadId, expectedVersion: 1 })),
      }),
    ),
  );
  lead.admit(
    'POST',
    url('/api/v1/leads/batch-push'),
    batch(ids.map((leadId) => ({ leadId, expectedVersion: 1 }))),
  );
  assert.throws(() =>
    lead.admit(
      'POST',
      url('/api/v1/leads/batch-push'),
      batch(ids.map((leadId) => ({ leadId, expectedVersion: 1 }))),
    ),
  );

  const ef = createMinimalPageRequestBudget('EF_FEEDBACK');
  ef.setRunId(runId, 'synthetic-user');
  const day = (offset) => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const known = {
    courtId: null,
    courtCaseNo: null,
    acceptedOn: null,
    secondInstanceAcceptedOn: null,
    platform: null,
    shopName: null,
    shopExternalId: null,
    caseType: null,
    infringementTypes: null,
  };
  const source = {
    idempotencyKey: 'synthetic',
    entryKind: 'HISTORICAL_BACKFILL',
    initialStage: 'WAITING_EXECUTION_STAMP',
    stageReachedOn: day(-6),
    source: `minimal-page:${runId}:${scope.userId}`,
    reason: '独立EF页面验收来源',
    customerId: '50000000-0000-4000-8000-000000000002',
    rightsHolderId: '60000000-0000-4000-8000-000000000001',
    defendants: [],
    lawyerAccountId: null,
    lawyerProfileId: null,
    known,
  };
  assert.throws(() =>
    ef.admit('POST', url('/api/v1/cases/external-entries'), {
      ...source,
      source: 'other',
    }),
  );
  assert.throws(() =>
    ef.admit('POST', url('/api/v1/cases/external-entries'), {
      ...source,
      stageReachedOn: day(-7),
    }),
  );
  ef.admit('POST', url('/api/v1/cases/external-entries'), source);
  ef.setCase(ids[0]);
  assert.throws(() =>
    ef.admit('POST', url('/api/v1/materials/upload-drafts'), {
      ownerType: 'CASE',
      ownerId: ids[1],
    }),
  );
  assert.throws(() =>
    ef.admit('POST', url(`/api/v1/cases/${ids[0]}/execution-mail`), {
      expectedVersion: 1,
    }),
  );
});

test('EF budget admits only the fixed two-file and two-feedback sequence', () => {
  const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const id = (digit) =>
    `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
  const url = (path) => `http://127.0.0.1:5174${path}`;
  const budget = createMinimalPageRequestBudget('EF_FEEDBACK');
  budget.setRunId(runId, 'synthetic-user');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const day = (offset) => {
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  budget.admit('POST', url('/api/v1/auth/login'), {
    username: 'synthetic-user',
    password: 'synthetic-password',
  });
  budget.admit('POST', url('/api/v1/cases/external-entries'), {
    idempotencyKey: 'key',
    entryKind: 'HISTORICAL_BACKFILL',
    initialStage: 'WAITING_EXECUTION_STAMP',
    stageReachedOn: day(-6),
    source: `minimal-page:${runId}:${scope.userId}`,
    reason: '独立EF页面验收来源',
    customerId: '50000000-0000-4000-8000-000000000002',
    rightsHolderId: '60000000-0000-4000-8000-000000000001',
    defendants: [],
    lawyerAccountId: null,
    lawyerProfileId: null,
    known: {
      courtId: null,
      courtCaseNo: null,
      acceptedOn: null,
      secondInstanceAcceptedOn: null,
      platform: null,
      shopName: null,
      shopExternalId: null,
      caseType: null,
      infringementTypes: null,
    },
  });
  const caseId = id('1'),
    mailDraft = id('2'),
    fileDraft = id('3'),
    mailProof = id('4'),
    fileProof = id('5'),
    mailing = id('6'),
    filing = id('7'),
    feedback = id('8');
  const pdf = Buffer.from('%PDF-1.7\nEF001 exact synthetic bytes\n%%EOF\n');
  budget.setCase(caseId);
  const upload = (category, draft, proof) => {
    budget.admit('POST', url('/api/v1/materials/upload-drafts'), {
      ownerType: 'CASE',
      ownerId: caseId,
      category,
      purpose: category,
      originalFilename: `${id('9')}.pdf`,
      declaredMimeType: 'application/pdf',
    });
    budget.setDraft(draft);
    budget.admit(
      'PUT',
      url(`/api/v1/materials/upload-drafts/${draft}/content`),
      pdf,
    );
    budget.setProof(category, proof);
  };
  upload('MAIL_RECEIPT', mailDraft, mailProof);
  assert.throws(() =>
    budget.admit('POST', url(`/api/v1/cases/${caseId}/execution-mail`), {
      expectedVersion: 1,
      idempotencyKey: 'key',
      expectedConfirmationId: null,
      mailedAt: day(-5),
      mailReceiptContentVersionIds: [fileProof],
    }),
  );
  budget.admit('POST', url(`/api/v1/cases/${caseId}/execution-mail`), {
    expectedVersion: 1,
    idempotencyKey: 'key',
    expectedConfirmationId: null,
    mailedAt: day(-5),
    mailReceiptContentVersionIds: [mailProof],
  });
  budget.setMailing(mailing);
  upload('EXECUTION_FILING_PROOF', fileDraft, fileProof);
  assert.throws(() =>
    budget.admit(
      'POST',
      url(`/api/v1/cases/${caseId}/execution-filing-submit`),
      {
        expectedVersion: 2,
        idempotencyKey: 'key',
        expectedMailingId: id('0'),
        submittedAt: day(-4),
        executionFilingProofContentVersionIds: [fileProof],
      },
    ),
  );
  budget.admit('POST', url(`/api/v1/cases/${caseId}/execution-filing-submit`), {
    expectedVersion: 2,
    idempotencyKey: 'key',
    expectedMailingId: mailing,
    submittedAt: day(-4),
    executionFilingProofContentVersionIds: [fileProof],
  });
  budget.setFiling(filing);
  const base = url(
    `/api/v1/cases/${caseId}/execution-filings/${filing}/feedbacks`,
  );
  budget.admit('POST', base, {
    idempotencyKey: 'key',
    expectedRevision: 0,
    feedbackId: feedback,
    feedbackOn: null,
    courtCaseNo: null,
    content: `合成执行反馈初始记录 ${runId}`,
  });
  budget.setFeedbackRoot(feedback);
  assert.throws(() =>
    budget.admit('POST', `${base}/${feedback}/corrections`, {
      idempotencyKey: 'key',
      expectedRevision: 1,
      feedbackOn: null,
      courtCaseNo: null,
      content: `合成执行反馈更正记录 ${runId}`,
      correctionReason: 'wrong',
    }),
  );
  budget.admit('POST', `${base}/${feedback}/corrections`, {
    idempotencyKey: 'key',
    expectedRevision: 1,
    feedbackOn: null,
    courtCaseNo: null,
    content: `合成执行反馈更正记录 ${runId}`,
    correctionReason: '补充核对后的反馈内容',
  });
  budget.admit('POST', url('/api/v1/auth/logout'));
  assert.equal(budget.assertComplete(), true);
});

test('preserved EF checkpoint binds immutable ordinary evidence and rejects forged prior use', async () => {
  const evidence = await readPreservedEfEvidence(process.cwd());
  const input = {
    summary: evidence['summary.json'],
    trace: evidence['safe-trace-http.json'],
    delta: evidence['database-delta.json'],
    facts: evidence['closure-addendum/actual-facts.json'],
    closure: evidence['closure-addendum/closure-proof.json'],
    files: evidence['closure-addendum/file-closure.json'],
  };
  assert.equal(assertPreservedEfEvidence(input), true);
  const mutate = (change) => {
    const copy = globalThis.structuredClone(input);
    change(copy);
    assert.throws(() => assertPreservedEfEvidence(copy), /PRESERVED_EF/u);
  };
  mutate((copy) => {
    copy.trace.budget.counts.external = 0;
  });
  mutate((copy) => {
    copy.summary.execution.EF.case.id = '00000000-0000-4000-8000-000000000000';
  });
  mutate((copy) => {
    copy.facts.case_execution_filing_receipts.count = 0;
  });
  mutate((copy) => {
    copy.files.files.find((file) => file.new).sha256 = '0'.repeat(64);
  });
  mutate((copy) => {
    copy.closure.feedbackWrites = 1;
  });
});

test('preserved EF authorization is exact to the approval, scope and candidate', () => {
  const candidateHashes = Object.fromEntries(
    [
      'tests/support/minimal-page-acceptance.mjs',
      'tests/support/minimal-page-acceptance.d.mts',
      'tests/support/minimal-page-acceptance.test.mjs',
      'tests/e2e/execution-feedback-minimal-page.spec.ts',
      'tests/support/execution-feedback-minimal-page.test.mjs',
    ].map((path) => [path, 'a'.repeat(64)]),
  );
  const git = { head: 'b'.repeat(40), tree: 'c'.repeat(40) };
  const receipt = {
    mode: preservedEfCheckpoint.mode,
    requestMessageId: 'Sentinel_74f90cb0aadc8191b21a8eb37dbec5a0',
    requestAtUtc: '2026-10-19T01:58:27Z',
    approvalMessageId: 'Sentinel_99b86fc7c7ac81918193c5af43f85438',
    approvalAtUtc: '2026-10-19T02:01:49Z',
    summarySha256: preservedEfCheckpoint.summarySha256,
    caseId: preservedEfCheckpoint.caseId,
    actorId: scope.userId,
    additionalEfSessions: 1,
    efFeedbackPosts: 2,
    sourcePosts: 0,
    uploadRequests: 0,
    pdfs: 0,
    leadSessionsRemaining: 1,
    leadPostsRemaining: 3,
    candidateHead: git.head,
    candidateTree: git.tree,
    candidateHashes,
  };
  assert.equal(
    assertPreservedEfAuthorization(receipt, candidateHashes, git),
    true,
  );
  for (const [field, value] of [
    ['caseId', '00000000-0000-4000-8000-000000000000'],
    ['sourcePosts', 1],
    ['leadPostsRemaining', 4],
    ['summarySha256', '0'.repeat(64)],
    ['candidateTree', '0'.repeat(40)],
    ['approvalMessageId', 'invented'],
  ])
    assert.throws(() =>
      assertPreservedEfAuthorization(
        { ...receipt, [field]: value },
        candidateHashes,
        git,
      ),
    );
  assert.throws(() =>
    assertPreservedEfAuthorization(
      {
        ...receipt,
        candidateHashes: {
          ...candidateHashes,
          'tests/support/minimal-page-acceptance.mjs': '0'.repeat(64),
        },
      },
      candidateHashes,
      git,
    ),
  );
  assert.throws(() =>
    assertPreservedEfAuthorization(undefined, candidateHashes, git),
  );
});

test('preserved EF live proof rejects changed case, source receipts, CVs and feedback', () => {
  const seal = preservedEfCheckpoint;
  const state = {
    case: {
      id: seal.caseId,
      business_no: seal.businessNo,
      stage: 'EXECUTING',
      version: 3,
      department_id: scope.departmentId,
      responsible_user_id: scope.userId,
      customer_id: '50000000-0000-4000-8000-000000000002',
      rights_holder_id: '60000000-0000-4000-8000-000000000001',
    },
    external: [
      {
        id: 'a6319ad3-2f5e-4b40-9d6e-0a8dbfb22766',
        case_id: seal.caseId,
        recorded_by_user_id: scope.userId,
        source: `minimal-page:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:${scope.userId}`,
      },
    ],
    mailings: [{ id: seal.mailingId, case_id: seal.caseId }],
    filings: [{ id: seal.filingId, case_id: seal.caseId }],
    externalReceipts: [{ id: seal.receiptIds.external, case_id: seal.caseId }],
    mailingReceipts: [{ id: seal.receiptIds.mailing, case_id: seal.caseId }],
    filingReceipts: [{ id: seal.receiptIds.filing, case_id: seal.caseId }],
    contentVersions: seal.contentVersionIds.map((id) => ({
      id,
      material_id: id,
      storage_key: `${scope.departmentId}/${id}/${id}`,
      sha256: seal.pdfSha256,
      size_bytes: '43',
      status: 'AVAILABLE',
    })),
    mailingVersions: [
      {
        mailing_id: seal.mailingId,
        content_version_id: seal.contentVersionIds[0],
      },
    ],
    filingVersions: [
      {
        filing_id: seal.filingId,
        content_version_id: seal.contentVersionIds[1],
      },
    ],
    materialReferences: seal.contentVersionIds.map((id) => ({
      resource_type: 'case',
      resource_id: seal.caseId,
      content_version_id: id,
    })),
    feedbacks: [],
    followupReceipts: [],
  };
  assert.equal(assertPreservedEfLiveState(state), true);
  for (const change of [
    (copy) => {
      copy.case.version = 4;
    },
    (copy) => {
      copy.filingReceipts = [];
    },
    (copy) => {
      copy.contentVersions[0].sha256 = '0'.repeat(64);
    },
    (copy) => {
      copy.materialReferences[0].resource_id =
        '00000000-0000-4000-8000-000000000000';
    },
    (copy) => {
      copy.materialReferences[0].resource_type = 'CASE';
    },
    (copy) => {
      copy.materialReferences[0].content_version_id =
        '00000000-0000-4000-8000-000000000000';
    },
    (copy) => {
      copy.feedbacks.push({ id: 'existing' });
    },
  ]) {
    const copy = globalThis.structuredClone(state);
    change(copy);
    assert.throws(() => assertPreservedEfLiveState(copy));
  }
});

test('preserved EF material reference SQL matches both production freeze paths', async () => {
  const service = await readFile(
    new URL(
      '../../backend/src/modules/materials/material.service.ts',
      import.meta.url,
    ),
    'utf8',
  );
  for (const method of [
    'freezeCaseExecutionMailingReferences',
    'freezeCaseExecutionFilingReferences',
  ]) {
    const section = service
      .split(`async ${method}(`)[1]
      ?.split('\n  async ')[0];
    assert.ok(
      section?.includes('await transaction.materialReference.create({'),
    );
    assert.ok(section.includes("resourceType: 'case'"));
    assert.equal(section.includes("resourceType: 'CASE'"), false);
  }
  const helper = await readFile(
    new URL('./minimal-page-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const query = helper.match(
    /materialReferences: await rows\(\s*"([^"]+)"\s*,\s*\[id, preservedEfCheckpoint\.contentVersionIds\]/u,
  )?.[1];
  assert.equal(
    query,
    "SELECT resource_type,resource_id::text,content_version_id::text FROM material_references WHERE resource_type='case' AND resource_id=$1 AND content_version_id=ANY($2::uuid[])",
  );
});

test('preserved EF file checkpoint binds registered versions without rejecting unrelated old files', async () => {
  const evidence = await readPreservedEfEvidence(process.cwd());
  const expected = evidence['closure-addendum/file-closure.json'].files;
  const versions = expected.map((file) => ({
    id: file.id,
    storage_key: `registered/${file.id}`,
  }));
  const blobs = new Map(
    expected.map((file) => [`registered/${file.id}`, file.sha256]),
  );
  for (let index = 0; index < 281; index += 1)
    blobs.set(`unregistered-old/${index}`, 'f'.repeat(64));
  assert.equal(expected.length, 96);
  assert.equal(blobs.size, 377);
  assert.equal(assertPreservedEfFiles(expected, versions, blobs), true);
  const checkBad = (files, rows, physical) =>
    assert.throws(
      () => assertPreservedEfFiles(files, rows, physical),
      /PRESERVED_EF_FILES/u,
    );
  const missing = new Map(blobs);
  missing.delete(versions[0].storage_key);
  checkBad(expected, versions, missing);
  const changed = new Map(blobs);
  changed.set(versions[0].storage_key, '0'.repeat(64));
  checkBad(expected, versions, changed);
  checkBad(
    expected,
    [{ ...versions[0], storage_key: 'wrong/path' }, ...versions.slice(1)],
    blobs,
  );
  checkBad(
    expected,
    [...versions, { id: 'extra', storage_key: 'extra' }],
    blobs,
  );
  checkBad(
    [{ ...expected[0] }, { ...expected[0] }, ...expected.slice(2)],
    versions,
    blobs,
  );
});

test('preserved EF 165-table checkpoint protects old rows and admits only exact new facts', async () => {
  const evidence = await readPreservedEfEvidence(process.cwd());
  const baseline = evidence['all-after-rows.json'];
  const current = globalThis.structuredClone(baseline);
  assert.equal(assertPreservedEfRows(baseline, current), true);
  current.tables.find((table) => table.table === 'cases').rows[0].row_sha256 =
    '0'.repeat(64);
  assert.throws(
    () => assertPreservedEfRows(baseline, current),
    /PRESERVED_EF_ROWS/u,
  );
  const added = globalThis.structuredClone(baseline);
  added.tables
    .find((table) => table.table === 'case_execution_filing_feedbacks')
    .rows.push({ pk_sha256: 'a'.repeat(64), row_sha256: 'b'.repeat(64) });
  assert.throws(
    () => assertPreservedEfRows(baseline, added),
    /PRESERVED_EF_ROWS/u,
  );
  assert.equal(assertPreservedEfRows(baseline, added, 'partial'), true);
  added.tables
    .find((table) => table.table === 'leads')
    .rows.push({ pk_sha256: 'a'.repeat(64), row_sha256: 'b'.repeat(64) });
  assert.throws(
    () => assertPreservedEfRows(baseline, added, 'partial'),
    /PRESERVED_EF_ROWS/u,
  );
});

test('preserved EF snapshot reads all 165 tables including migrations and rejects an extra or unsafe table', async () => {
  const evidence = await readPreservedEfEvidence(process.cwd());
  const sealed = evidence['all-after-rows.json'];
  const names = sealed.tables.map((entry) => entry.table).sort();
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('FROM pg_tables'))
        return { rows: names.map((tablename) => ({ tablename })) };
      return { rows: [] };
    },
  };
  const result = await snapshotPreservedEfRows(client, sealed);
  assert.equal(result.tables.length, 165);
  assert.ok(queries.some((sql) => sql.includes('public."_prisma_migrations"')));
  const extraClient = {
    async query(sql) {
      return {
        rows: sql.includes('FROM pg_tables')
          ? [...names, 'unsealed_table']
              .sort()
              .map((tablename) => ({ tablename }))
          : [],
      };
    },
  };
  await assert.rejects(
    snapshotPreservedEfRows(extraClient, sealed),
    /PRESERVED_EF_TABLE/u,
  );
  const unsafe = globalThis.structuredClone(sealed);
  unsafe.tables[0].table = 'bad;drop';
  const unsafeClient = {
    async query(sql) {
      return {
        rows: sql.includes('FROM pg_tables')
          ? unsafe.tables
              .map((entry) => ({ tablename: entry.table }))
              .sort((a, b) => a.tablename.localeCompare(b.tablename))
          : [],
      };
    },
  };
  await assert.rejects(
    snapshotPreservedEfRows(unsafeClient, unsafe),
    /PRESERVED_EF_TABLE/u,
  );
});

test('preserved EF budget keeps prior use separate and denies source or upload before dispatch', () => {
  const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const budget = createPreservedEfRequestBudget(runId, 'synthetic-user');
  const url = (path) => `http://127.0.0.1:5174${path}`;
  assert.equal(budget.priorConsumed.external, 1);
  assert.deepEqual(budget.counts(), {});
  budget.admit('GET', url('/api/v1/cases?page=1&pageSize=20'));
  budget.admit('HEAD', url('/api/v1/cases?page=1'));
  assert.throws(() =>
    budget.admit('GET', 'https://example.test/api/v1/cases?page=1'),
  );
  assert.throws(() =>
    budget.admit('POST', url('/api/v1/auth/login?retry=1'), {
      username: 'synthetic-user',
      password: 'synthetic-password',
    }),
  );
  for (const [method, path] of [
    ['POST', '/api/v1/cases/external-entries'],
    ['POST', '/api/v1/materials/upload-drafts'],
    [
      'PUT',
      '/api/v1/materials/upload-drafts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/content',
    ],
    ['POST', `/api/v1/cases/${preservedEfCheckpoint.caseId}/execution-mail`],
    [
      'POST',
      `/api/v1/cases/${preservedEfCheckpoint.caseId}/execution-filing-submit`,
    ],
  ])
    assert.throws(() => budget.admit(method, url(path), {}));
  assert.deepEqual(budget.counts(), {});
  budget.admit('POST', url('/api/v1/auth/login'), {
    username: 'synthetic-user',
    password: 'synthetic-password',
  });
  assert.equal(budget.counts().login, 1);
  assert.equal(budget.priorConsumed.login, 1);
});

test('preserved EF budget admits the actual page wording, one new session and two feedback writes', async () => {
  const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const spec = await readFile(
    new URL('../e2e/execution-feedback-minimal-page.spec.ts', import.meta.url),
    'utf8',
  );
  const firstContent = /const firstContent = `([^`]+)`;/u
    .exec(spec)?.[1]
    ?.replace('${prepared.runId}', runId);
  const secondContent = /const secondContent = `([^`]+)`;/u
    .exec(spec)?.[1]
    ?.replace('${prepared.runId}', runId);
  const correctionReason = /const correctionReason = '([^']+)';/u.exec(
    spec,
  )?.[1];
  assert.ok(firstContent && secondContent && correctionReason);
  const feedbackId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const budget = createPreservedEfRequestBudget(runId, 'synthetic-user');
  const base = `http://127.0.0.1:5174/api/v1/cases/${preservedEfCheckpoint.caseId}/execution-filings/${preservedEfCheckpoint.filingId}/feedbacks`;
  budget.admit('POST', 'http://127.0.0.1:5174/api/v1/auth/login', {
    username: 'synthetic-user',
    password: 'synthetic-password',
  });
  budget.admit('POST', base, {
    idempotencyKey: 'one',
    expectedRevision: 0,
    feedbackOn: null,
    courtCaseNo: null,
    content: firstContent,
    feedbackId,
  });
  budget.setFeedbackRoot(feedbackId);
  budget.admit('POST', `${base}/${feedbackId}/corrections`, {
    idempotencyKey: 'two',
    expectedRevision: 1,
    feedbackOn: null,
    courtCaseNo: null,
    content: secondContent,
    correctionReason: correctionReason,
  });
  budget.admit('POST', 'http://127.0.0.1:5174/api/v1/auth/logout');
  assert.equal(budget.assertComplete(), true);
  assert.deepEqual(budget.counts(), {
    login: 1,
    feedback: 1,
    correction: 1,
    logout: 1,
  });
  assert.equal(budget.priorConsumed.external, 1);
  assert.throws(() => budget.admit('POST', base, {}));
  assert.throws(() =>
    budget.admit('POST', 'http://127.0.0.1:5174/api/v1/auth/login', {
      username: 'synthetic-user',
      password: 'synthetic-password',
    }),
  );
});
