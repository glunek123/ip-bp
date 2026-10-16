import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { setTimeout as nextPoll } from 'node:timers/promises';
import {
  captureTestEnvironment,
  validateBrowserTestDatabaseUrl,
  validateIsolatedTestDatabaseUrl,
} from '../../scripts/test-environment.mjs';

// Playwright loads helpers through its CJS transform. Native ESM pure probes run at project root.
/* global __filename */
const root =
  typeof __filename === 'string'
    ? resolve(dirname(__filename), '../..')
    : resolve(process.cwd());
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const runId = randomUUID();
const prefix = `execution-filing-followup:${runId}:`;
const actors = new Map();
const cases = new Set();
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const efActions = [
  'case.execution.feedback.record',
  'case.execution.feedback.correct',
  'case.execution.supplement.submit',
  'case.execution.supplement.correct',
];
const efEvents = [
  'case.execution.feedback.recorded',
  'case.execution.feedback.corrected',
  'case.execution.supplement.submitted',
  'case.execution.supplement.corrected',
];
const securityTables = [
  'departments',
  'user_accounts',
  'department_memberships',
  'local_credentials',
  'auth_sessions',
  'role_templates',
  'role_grants',
  'role_assignments',
  'lawyer_profiles',
  'lawyer_account_bindings',
  'customer_account_bindings',
  'notary_office_account_bindings',
  'case_lawyer_assignments',
];
const originalTables = [
  'case_external_entries',
  'case_external_entry_receipts',
  'case_execution_submissions',
  'case_execution_submission_versions',
  'case_execution_submission_receipts',
  'case_execution_confirmations',
  'case_execution_confirmation_versions',
  'case_execution_confirmation_receipts',
  'case_execution_mailings',
  'case_execution_mailing_versions',
  'case_execution_mailing_receipts',
  'case_execution_filings',
  'case_execution_filing_versions',
  'case_execution_filing_receipts',
  'case_execution_finishes',
  'case_execution_finish_versions',
  'case_execution_finish_receipts',
  'case_closures',
  'case_closure_versions',
  'case_closure_documents',
  'case_closure_receipts',
  'case_archives',
  'case_archive_versions',
  'case_archive_receipts',
];
const factTables = [
  'case_execution_filing_feedbacks',
  'case_execution_filing_supplements',
  'case_execution_filing_supplement_documents',
  'case_execution_filing_followup_receipts',
];

/** Pure admission: reject before capture, Docker discovery, client construction or sockets. */
export function assertExecutionFilingFollowupR2Binding(environment) {
  if (
    environment.NODE_ENV !== 'test' ||
    environment.DEV_COR_TEST_DATABASE_PROJECT !== 'dev-cor-ui003-r2' ||
    environment.DEV_COR_TEST_DATABASE_CONTAINER_ID !==
      '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236' ||
    environment.DATABASE_URL !== environment.DEV_COR_TEST_DATABASE_URL
  )
    throw new Error('EF001 requires the complete authorized R2 tuple');
  const target = validateIsolatedTestDatabaseUrl(environment.DATABASE_URL, {
    allowRandomPort: true,
  });
  const url = new URL(environment.DATABASE_URL);
  if (
    target.hostname !== '127.0.0.1' ||
    target.port !== 15438 ||
    url.href.includes('?') ||
    url.href.includes('#') ||
    target.connectionString !== environment.DATABASE_URL
  )
    throw new Error('EF001 requires identical query-free R2 URLs');
}

export function assertExecutionFilingFollowupMigrationSource(source) {
  const tail = [
    '20261015130000_guard_direct_second_remand_child',
    '20261015150000_case_section_record_edits',
    '20261015170000_case_section_record_uploads',
    '20261016090000_case_record_material_guard_repair',
    '20261016100000_case_execution_filing_followups',
  ];
  if (
    source.length !== 159 ||
    tail.some((name, i) => source[154 + i]?.name !== name) ||
    source.some(
      (row, i) =>
        !/^\d{14}_/u.test(row.name) ||
        !/^[a-f0-9]{64}$/u.test(row.checksum) ||
        (i > 0 && row.name <= source[i - 1].name),
    ) ||
    source[155].checksum !==
      '10760cf6e9969822a6b6a631760645625d227c4541a018560473e34c164953c7' ||
    source[156].checksum !==
      '883f2f80b615a0f746adb2ebbb6e17cc24d0ac577a61d236f3bb6375fbc0367d' ||
    source[157].checksum !==
      'dfe31436055f7ab9bf8d0796c48b3a0dd38a16acf4e5b3554e04e3d299b7b869' ||
    source[158].checksum !==
      '0d55420218f7547723b5a7b2a260469b4f3c4b9a84f797effff269175773fc30'
  )
    throw new Error(
      'EF001 requires the complete source chain through approved 158 and EF159',
    );
}

async function readExecutionFilingFollowupMigrations() {
  const directory = resolve(root, 'backend/prisma/migrations');
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
  assertExecutionFilingFollowupMigrationSource(source);
  return source;
}

export function assertExecutionFilingFollowupMigrationLedger(
  identity,
  applied,
  source,
) {
  assertExecutionFilingFollowupMigrationSource(source);
  if (
    identity.length !== 1 ||
    identity[0].db !== 'dev_cor_test' ||
    identity[0].schema !== 'public' ||
    identity[0].username !== 'dev_cor_test' ||
    applied.length !== source.length ||
    applied.some(
      (row, i) =>
        row.migration_name !== source[i].name ||
        row.checksum !== source[i].checksum ||
        !row.finished_at ||
        row.rolled_back_at !== null,
    )
  )
    throw new Error(
      'EF001 public database identity or full migration ledger differs from source',
    );
}

function captureExecutionFilingFollowupTarget() {
  assertExecutionFilingFollowupR2Binding(process.env);
  const environment = captureTestEnvironment(root, { pnpmVersion: '11.27.0' });
  const target = validateBrowserTestDatabaseUrl(process.env.DATABASE_URL, root);
  if (
    target.connectionString !== environment.childEnvironment.DATABASE_URL ||
    target.connectionString !== process.env.DEV_COR_TEST_DATABASE_URL
  )
    throw new Error('EF001 effective captured URL mismatch');
  return target;
}

async function withDatabase(operation) {
  assertExecutionFilingFollowupR2Binding(process.env);
  const source = await readExecutionFilingFollowupMigrations();
  const target = captureExecutionFilingFollowupTarget();
  const { Client } = requireBackend('pg');
  const client = new Client({ connectionString: target.connectionString });
  try {
    await client.connect();
    const identity = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema,current_user AS username',
      )
    ).rows;
    const applied = (
      await client.query(
        'SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name',
      )
    ).rows;
    assertExecutionFilingFollowupMigrationLedger(identity, applied, source);
    return await operation(client);
  } finally {
    await client.end();
  }
}

/** Source-only plan. Execution needs the runner's later fixed fixture authorization. */
export async function createExecutionFilingFollowupActor(kind = 'operator') {
  if (!['source', 'operator', 'readOnly', 'foreign'].includes(kind))
    throw new Error('Unsupported EF001 actor plan');
  const userId = randomUUID(),
    roleId = randomUUID();
  const departmentId =
    kind === 'foreign'
      ? '10000000-0000-4000-8000-000000000002'
      : '10000000-0000-4000-8000-000000000001';
  const username = `ef001-${randomUUID()}`,
    password = `EF-${randomUUID()}-synthetic`;
  const actions =
    kind === 'readOnly'
      ? ['case.read']
      : [
          'case.read',
          ...efActions,
          ...(kind === 'source'
            ? [
                'customer.read',
                'case.external-entry.create',
                'case.execution.mail',
                'case.execution.filing.submit',
                'case.execution.finish',
              ]
            : []),
        ];
  await withDatabase(async (client) => {
    const department = (
      await client.query('SELECT id FROM departments WHERE id=$1', [
        departmentId,
      ])
    ).rows;
    if (department.length !== 1)
      throw new Error('Missing existing authorized synthetic department');
    const { hashPassword } = requireBackend('./dist/auth/password.js');
    const passwordHash = await hashPassword(password);
    await client.query('BEGIN');
    try {
      await client.query(
        'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES($1,$2,$2,now())',
        [userId, `${prefix}${userId}`],
      );
      await client.query(
        'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES($1,$2,$3,now())',
        [randomUUID(), userId, departmentId],
      );
      await client.query(
        'INSERT INTO local_credentials(id,user_id,username,password_hash,updated_at) VALUES($1,$2,$3,$4,now())',
        [randomUUID(), userId, username, passwordHash],
      );
      await client.query(
        'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES($1,$2,$3,now())',
        [roleId, departmentId, `${prefix}${roleId}`],
      );
      for (const action of actions)
        await client.query(
          "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES($1,$2,$3::permission_action,'DEPARTMENT')",
          [randomUUID(), roleId, action],
        );
      await client.query(
        'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,updated_at) VALUES($1,$2,$3,$4,now())',
        [randomUUID(), userId, departmentId, roleId],
      );
      await client.query('COMMIT');
    } catch (cause) {
      await client.query('ROLLBACK');
      throw cause;
    }
  });
  actors.set(userId, { roleId, departmentId });
  return {
    userId,
    roleId,
    username,
    password,
    departmentId,
    customerId: '50000000-0000-4000-8000-000000000002',
    rightsHolderId: '60000000-0000-4000-8000-000000000001',
  };
}

export function executionFilingFollowupSource(actorUserId) {
  if (!actors.has(actorUserId)) throw new Error('Unknown EF001 fixture actor');
  return `${prefix}${actorUserId}:${randomUUID()}`;
}

export async function ownExecutionFilingFollowupCase(caseId, actorUserId) {
  if (!uuid.test(caseId) || !actors.has(actorUserId))
    throw new Error('Unowned EF001 fixture');
  await withDatabase(async (client) => {
    const entry = (
      await client.query(
        'SELECT id FROM case_external_entries WHERE case_id=$1 AND recorded_by_user_id=$2 AND source LIKE $3',
        [caseId, actorUserId, `${prefix}${actorUserId}:%`],
      )
    ).rows;
    if (entry.length !== 1)
      throw new Error(
        'Case was not appended by this run through the authorized HTTP source',
      );
  });
  cases.add(caseId);
}

function assertOwnedCase(caseId) {
  if (!uuid.test(caseId) || !cases.has(caseId))
    throw new Error("EF001 operation requires this run's own case");
}

export async function executionFilingFollowupSafetySnapshot() {
  return withDatabase(async (client) => {
    const result = {};
    for (const table of securityTables)
      result[table] = (
        await client.query(
          `SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
        )
      ).rows.map((r) => ({
        id: r.row.id,
        sha256: createHash('sha256')
          .update(JSON.stringify(r.row))
          .digest('hex'),
      }));
    return result;
  });
}

export async function executionFilingFollowupSnapshot(caseId) {
  assertOwnedCase(caseId);
  return withDatabase(async (client) => {
    const original = {
      cases: (
        await client.query(
          'SELECT to_jsonb(t) AS row FROM cases t WHERE id=$1',
          [caseId],
        )
      ).rows.map((r) => r.row),
    };
    const facts = {};
    for (const [tables, output] of [
      [originalTables, original],
      [factTables, facts],
    ])
      for (const table of tables)
        output[table] = (
          await client.query(
            `SELECT to_jsonb(t) AS row FROM "${table}" t WHERE case_id=$1 ORDER BY to_jsonb(t)::text`,
            [caseId],
          )
        ).rows.map((r) => r.row);
    const audits = (
      await client.query(
        "SELECT to_jsonb(t) AS row FROM audit_events t WHERE resource_type='CASE' AND resource_id=$1 ORDER BY id",
        [caseId],
      )
    ).rows.map((r) => r.row);
    original.audit = audits.filter((row) => !efEvents.includes(row.action));
    facts.audit = audits.filter((row) => efEvents.includes(row.action));
    const refs = (
      await client.query(
        "SELECT to_jsonb(t) AS row,a.action FROM material_references t JOIN audit_events a ON a.id=t.action_event_id WHERE t.resource_type='case' AND t.resource_id=$1 ORDER BY t.id",
        [caseId],
      )
    ).rows;
    original.references = refs
      .filter((r) => !efEvents.includes(r.action))
      .map((r) => r.row);
    facts.references = refs
      .filter((r) => efEvents.includes(r.action))
      .map((r) => r.row);
    return { original, facts };
  });
}

/** Only revoke a fresh role from this run. There is deliberately no restore function. */
export async function revokeExecutionFilingFollowupActor(userId) {
  const actor = actors.get(userId);
  if (!actor) throw new Error('Cannot revoke an old or foreign actor');
  await withDatabase(async (client) => {
    const result = await client.query(
      'UPDATE role_templates SET active=false,version=version+1,updated_at=now() WHERE id=$1 AND department_id=$2 AND name=$3 AND active RETURNING id',
      [actor.roleId, actor.departmentId, `${prefix}${actor.roleId}`],
    );
    if (result.rowCount !== 1)
      throw new Error('Owned active EF001 role was not found');
  });
}

/** Hold the actual case row, collect two blocked backend PIDs, then release. */
export async function contendExecutionFilingFollowupRequests(
  caseId,
  operation,
) {
  assertOwnedCase(caseId);
  return withDatabase(async (client) => {
    await client.query('BEGIN');
    let requests;
    let blocked = [];
    try {
      await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [
        caseId,
      ]);
      requests = operation();
      void requests.catch(() => undefined);
      const deadline = Date.now() + 10_000;
      do {
        await client.query('SELECT pg_stat_clear_snapshot()');
        blocked = (
          await client.query(`WITH RECURSIVE blocked(pid) AS (
          SELECT pid FROM pg_stat_activity WHERE pg_backend_pid()=ANY(pg_blocking_pids(pid))
          UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))
        ) SELECT DISTINCT pid FROM blocked ORDER BY pid`)
        ).rows.map((r) => r.pid);
        if (blocked.length >= 2) break;
        await nextPoll(20);
      } while (Date.now() < deadline);
      if (blocked.length < 2)
        throw new Error(
          'Two EF001 requests did not actually contend on the held case lock',
        );
    } catch (cause) {
      await client.query('ROLLBACK');
      if (requests) await requests.catch(() => undefined);
      throw cause;
    }
    await client.query('ROLLBACK');
    return { result: await requests, blockedPids: blocked };
  });
}

/** Fault DDL is uniquely named and case-scoped; never replace/drop a shared guard. */
export async function withExecutionFilingFollowupFault(
  caseId,
  kind,
  phase,
  operation,
) {
  assertOwnedCase(caseId);
  if (!['feedback', 'supplement'].includes(kind))
    throw new Error('Unsupported EF001 fact kind');
  const targets = {
    audit: ['audit_events', 'resource_id'],
    version: [
      kind === 'feedback'
        ? 'case_execution_filing_feedbacks'
        : 'case_execution_filing_supplements',
      'case_id',
    ],
    document: ['case_execution_filing_supplement_documents', 'case_id'],
    reference: ['material_references', 'resource_id'],
    receipt: ['case_execution_filing_followup_receipts', 'case_id'],
  };
  const target = targets[phase];
  if (
    !target ||
    (kind === 'feedback' && ['document', 'reference'].includes(phase))
  )
    throw new Error('Unsupported EF001 write phase');
  const name = `ef001_fault_${randomUUID().replaceAll('-', '')}`;
  return withDatabase(async (client) => {
    let created = false,
      installed = false;
    try {
      await client.query(
        `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."${target[1]}"::text='${caseId}' THEN RAISE EXCEPTION 'injected own-case EF001 failure'; END IF; RETURN NEW; END $$`,
      );
      created = true;
      await client.query(
        `CREATE TRIGGER "${name}" BEFORE INSERT ON "${target[0]}" FOR EACH ROW EXECUTE FUNCTION "${name}"()`,
      );
      installed = true;
      return await operation();
    } finally {
      try {
        if (installed)
          await client.query(`DROP TRIGGER "${name}" ON "${target[0]}"`);
      } finally {
        if (created) await client.query(`DROP FUNCTION "${name}"()`);
      }
    }
  });
}
