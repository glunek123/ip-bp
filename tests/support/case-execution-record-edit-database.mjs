import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as nextPoll } from 'node:timers/promises';
import { validateBrowserTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const requireBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { Client } = requireBackend('pg');
const { hashPassword } = requireBackend('./dist/auth/password.js');
const prefix = 'execution-record-edit:';
const ownedActors = new Map();
const ownedCases = new Set();
const fixture = {
  departmentId: '10000000-0000-4000-8000-000000000001',
  customerId: '50000000-0000-4000-8000-000000000002',
  rightsHolderId: '60000000-0000-4000-8000-000000000001',
};
const oldTables = [
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
const newTables = [
  'case_execution_mailing_record_corrections',
  'case_execution_mailing_record_documents',
  'case_execution_filing_record_corrections',
  'case_execution_filing_record_documents',
  'case_execution_finish_record_corrections',
  'case_execution_finish_record_documents',
  'case_section_record_edit_receipts',
];

async function withDatabase(operation) {
  if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL)
    throw new Error('Execution correction tests require the isolated runner');
  // Reuse actual-container admission, then require the separately coordinated instance.
  const target = validateBrowserTestDatabaseUrl(process.env.DATABASE_URL);
  if (target.port !== 15437)
    throw new Error(
      'Execution correction tests require coordinated port 15437',
    );
  const client = new Client({ connectionString: target.connectionString });
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema',
      )
    ).rows[0];
    if (identity.db !== 'dev_cor_test' || identity.schema !== 'public')
      throw new Error('Wrong isolated database identity');
    return await operation(client);
  } finally {
    await client.end();
  }
}

/** Append fresh identities/roles only; existing grants and business rows are never reset. */
export async function createExecutionRecordEditActor({
  foreign = false,
  readOnly = false,
} = {}) {
  const departmentId = foreign
    ? '10000000-0000-4000-8000-000000000002'
    : fixture.departmentId;
  const userId = randomUUID();
  const roleId = randomUUID();
  const username = `execution-record-edit-${randomUUID()}`;
  const password = `E-${randomUUID()}-synthetic`;
  const passwordHash = await hashPassword(password);
  await withDatabase(async (client) => {
    const present = (
      await client.query('SELECT id FROM departments WHERE id=$1', [
        departmentId,
      ])
    ).rows;
    if (present.length !== 1)
      throw new Error(
        'Runner must prepare existing synthetic departments first',
      );
    await client.query('BEGIN');
    try {
      await client.query(
        'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES($1,$2,$2,now())',
        [userId, `${prefix}${username}`],
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
      const actions = readOnly
        ? ['case.read']
        : [
            'customer.read',
            'case.read',
            'case.external-entry.create',
            'case.execution.mail',
            'case.execution.filing.submit',
            'case.execution.finish',
            'case.closure.record',
            'case.archive',
            'case.execution.mailing.correct',
            'case.execution.filing.correct',
            'case.execution.finish.correct',
          ];
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
  ownedActors.set(userId, roleId);
  return { userId, roleId, username, password, ...fixture, departmentId };
}

export async function ownExecutionRecordEditCase(caseId, actorUserId) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
      caseId,
    )
  )
    throw new Error('Invalid synthetic case ID');
  if (!ownedActors.has(actorUserId))
    throw new Error('Actor not owned by this run');
  await withDatabase(async (client) => {
    const rows = (
      await client.query(
        'SELECT id FROM case_external_entries WHERE case_id=$1 AND recorded_by_user_id=$2 AND source LIKE $3',
        [caseId, actorUserId, `${prefix}%`],
      )
    ).rows;
    if (rows.length !== 1)
      throw new Error(
        'Case is not a newly appended execution correction fixture',
      );
  });
  ownedCases.add(caseId);
}

export async function executionRecordEditSnapshot(caseId) {
  if (!ownedCases.has(caseId)) throw new Error('Cannot inspect unowned cases');
  return withDatabase(async (client) => {
    const original = {
      case: (
        await client.query(
          'SELECT to_jsonb(c) AS row FROM cases c WHERE id=$1',
          [caseId],
        )
      ).rows,
    };
    const corrections = {};
    for (const table of oldTables)
      original[table] = (
        await client.query(
          `SELECT to_jsonb(t) AS row FROM "${table}" t WHERE case_id=$1 ORDER BY to_jsonb(t)::text`,
          [caseId],
        )
      ).rows;
    for (const table of newTables)
      corrections[table] = (
        await client.query(
          `SELECT to_jsonb(t) AS row FROM "${table}" t WHERE case_id=$1 ORDER BY to_jsonb(t)::text`,
          [caseId],
        )
      ).rows;
    original.audit = (
      await client.query(
        "SELECT to_jsonb(t) AS row FROM audit_events t WHERE resource_type='CASE' AND resource_id=$1 AND action NOT LIKE '%.record-corrected' ORDER BY id",
        [caseId],
      )
    ).rows;
    original.references = (
      await client.query(
        "SELECT to_jsonb(r) AS row FROM material_references r JOIN audit_events a ON a.id=r.action_event_id WHERE r.resource_type='case' AND r.resource_id=$1 AND a.action NOT LIKE '%.record-corrected' ORDER BY r.id",
        [caseId],
      )
    ).rows;
    original.materials = (
      await client.query(
        "SELECT to_jsonb(m) AS row FROM materials m WHERE owner_type='CASE' AND owner_id=$1 ORDER BY id",
        [caseId],
      )
    ).rows;
    original.contentVersions = (
      await client.query(
        "SELECT to_jsonb(v) AS row FROM content_versions v JOIN materials m ON m.id=v.material_id WHERE m.owner_type='CASE' AND m.owner_id=$1 ORDER BY v.id",
        [caseId],
      )
    ).rows;
    corrections.audit = (
      await client.query(
        "SELECT to_jsonb(t) AS row FROM audit_events t WHERE resource_type='CASE' AND resource_id=$1 AND action LIKE '%.record-corrected' ORDER BY id",
        [caseId],
      )
    ).rows;
    corrections.references = (
      await client.query(
        "SELECT to_jsonb(t) AS row FROM material_references t WHERE resource_type='case' AND resource_id=$1 ORDER BY id",
        [caseId],
      )
    ).rows;
    return { original, corrections };
  });
}

/** Revoke only this run's new role. No fixture/production grant deletion. */
export async function revokeExecutionRecordEditActor(userId) {
  const roleId = ownedActors.get(userId);
  if (!roleId)
    throw new Error('Cannot revoke an actor not created by this run');
  await withDatabase((client) =>
    client.query(
      'UPDATE role_templates SET active=false,version=version+1,updated_at=now() WHERE id=$1 AND name=$2',
      [roleId, `${prefix}${roleId}`],
    ),
  );
}

/** Prove both HTTP commands actually wait on this case lock before releasing it. */
export async function raceExecutionRecordEditRequests(caseId, startRequests) {
  if (!ownedCases.has(caseId)) throw new Error('Cannot lock an unowned case');
  return withDatabase(async (client) => {
    await client.query('BEGIN');
    let requests;
    try {
      await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [
        caseId,
      ]);
      requests = startRequests();
      // Keep an immediate rejection handled while the lock evidence is collected.
      void requests.catch(() => undefined);
      const deadline = Date.now() + 10_000;
      let waiting = 0;
      while (Date.now() < deadline) {
        await client.query('SELECT pg_stat_clear_snapshot()');
        const row = (
          await client.query(`WITH RECURSIVE blocked(pid) AS (
          SELECT pid FROM pg_stat_activity WHERE pg_backend_pid()=ANY(pg_blocking_pids(pid))
          UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))
        ) SELECT count(*)::int AS count FROM blocked`)
        ).rows[0];
        waiting = row.count;
        if (waiting >= 2) break;
        await nextPoll(20);
      }
      if (waiting < 2)
        throw new Error(
          'Both correction requests did not demonstrably contend on the held case lock',
        );
    } catch (cause) {
      await client.query('ROLLBACK');
      if (requests) await requests.catch(() => undefined);
      throw cause;
    }
    await client.query('ROLLBACK');
    return requests;
  });
}

export async function withExecutionRecordEditFault(caseId, phase, operation) {
  if (!ownedCases.has(caseId))
    throw new Error('Cannot inject a fault into an unowned case');
  const targets = {
    audit: ['audit_events', 'resource_id'],
    correction: ['case_execution_mailing_record_corrections', 'case_id'],
    document: ['case_execution_mailing_record_documents', 'case_id'],
    reference: ['material_references', 'resource_id'],
    receipt: ['case_section_record_edit_receipts', 'case_id'],
  };
  const target = targets[phase];
  if (!target) throw new Error('Unsupported execution correction fault');
  const name = `execution_record_fault_${randomUUID().replaceAll('-', '')}`;
  return withDatabase(async (client) => {
    let installed = false;
    try {
      await client.query(
        `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."${target[1]}"::text='${caseId}' THEN RAISE EXCEPTION 'injected execution correction failure'; END IF; RETURN NEW; END $$`,
      );
      installed = true;
      await client.query(
        `CREATE TRIGGER "${name}" BEFORE INSERT ON "${target[0]}" FOR EACH ROW EXECUTE FUNCTION "${name}"()`,
      );
      return await operation();
    } finally {
      if (installed) {
        await client.query(
          `DROP TRIGGER IF EXISTS "${name}" ON "${target[0]}"`,
        );
        await client.query(`DROP FUNCTION "${name}"()`);
      }
    }
  });
}
