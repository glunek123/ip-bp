import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  captureTestEnvironment,
  validateBrowserTestDatabaseUrl,
  validateIsolatedTestDatabaseUrl,
} from '../../scripts/test-environment.mjs';

const requireBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { Client } = requireBackend('pg');
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const departmentA = '10000000-0000-4000-8000-000000000001';
const baselineUsers = [1, 2, 3].map(
  (n) => `20000000-0000-4000-8000-00000000000${n}`,
);
const baselineRoles = [1, 2, 3].map(
  (n) => `30000000-0000-4000-8000-00000000000${n}`,
);
const actors = new Map();
const ownedCases = new Set();
const originalActorBinding = Object.freeze({
  manifestSha256:
    'a5307e17af39d842c1ed01b59acae261de8eee16a5454685a8d9137978c340af',
  creationDeltaSha256:
    'f61ab7550209b531a7dc66d9a32bc5b023b47014feccda9730b17c3a4ca26d83',
  fourGrantManifestSha256:
    'e6baa1d3b7e94b59cc2a83e90b43696bc6563046fd927206e8a3306fe02073de',
  threeCorrectionManifestSha256:
    '32331cbbc325cd2fb76d1fde7e4e7e0f2d3cee0e6d5ec8688892cee8bbd83021',
  credentialFileSha256:
    'd9367f33ac67ad2353648ade02b3c110aaa1785a51944207882de56e34a94de1',
  userId: 'edc8bf6f-6660-41f6-8418-f72f87443a1c',
  roleId: '51c34a8b-fb00-45b1-ab9f-d077d59d4878',
  departmentId: departmentA,
  assignmentId: '8bed4da1-c61e-40d9-bd78-170380421ce8',
  membershipId: '36ea4166-dce8-48bd-bb9b-216222f0ea2a',
  credentialId: 'f695cb82-e0d1-4dcc-9135-d1e3c75ecc8b',
});
const approvedMissingActions = Object.freeze([
  'case.complaint.mail',
  'case.filing.submit',
  'case.acceptance.register',
  'case.external-entry.create',
  'case.execution.mailing.correct',
  'case.execution.filing.correct',
  'case.execution.finish.correct',
]);

export function assertHistoricalRecordR2Binding(environment = process.env) {
  if (
    environment.NODE_ENV !== 'test' ||
    environment.DEV_COR_TEST_DATABASE_PROJECT !== 'dev-cor-ui003-r2' ||
    environment.DEV_COR_TEST_DATABASE_CONTAINER_ID !==
      '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236'
  )
    throw new Error('Historical acceptance requires the exact R2 instance');
  for (const key of ['DATABASE_URL', 'DEV_COR_TEST_DATABASE_URL']) {
    let parsed;
    try {
      parsed = new URL(environment[key]);
    } catch {
      throw new Error('Historical R2 URL is invalid');
    }
    if (
      parsed.search ||
      parsed.hash ||
      environment[key].includes('?') ||
      environment[key].includes('#')
    )
      throw new Error('Historical R2 URL must not have query or fragment');
  }
  const target = validateIsolatedTestDatabaseUrl(
    environment.DEV_COR_TEST_DATABASE_URL,
    { allowRandomPort: true },
  );
  const effective = validateIsolatedTestDatabaseUrl(environment.DATABASE_URL, {
    allowRandomPort: true,
  });
  if (
    target.port !== 15438 ||
    target.connectionString !== effective.connectionString ||
    target.connectionString !== environment.DEV_COR_TEST_DATABASE_URL ||
    environment.DATABASE_URL !== environment.DEV_COR_TEST_DATABASE_URL
  )
    throw new Error('Historical acceptance requires identical exact R2 URLs');
  return target;
}
async function migrationInputs() {
  const directory = resolve(process.cwd(), 'backend/prisma/migrations');
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  if (
    ![156, 157].includes(names.length) ||
    names[155] !== '20261015150000_case_section_record_edits' ||
    (names.length === 157 &&
      names[156] !== '20261015170000_case_section_record_uploads')
  )
    throw new Error(
      'Historical acceptance requires its runner-frozen 156 or compatible 157 migration tree',
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
// Optional dependencies are for pure admission tests; runtime always uses official capture/validator.
export async function withHistoricalRecordDatabase(operation, offline) {
  const environment = offline?.environment ?? process.env;
  const authorized = assertHistoricalRecordR2Binding(environment);
  const pnpmVersion = (environment.npm_config_user_agent ?? '').match(
    /\bpnpm\/([^\s]+)/u,
  )?.[1];
  if (pnpmVersion !== '11.27.0')
    throw new Error('Use the protected project pnpm runner');
  const captured = (
    offline?.capture ??
    (() => captureTestEnvironment(process.cwd(), { pnpmVersion }))
  )();
  const target = (
    offline?.validate ??
    (() =>
      validateBrowserTestDatabaseUrl(environment.DATABASE_URL, process.cwd()))
  )();
  if (
    target.connectionString !== authorized.connectionString ||
    target.connectionString !== captured.childEnvironment.DATABASE_URL
  )
    throw new Error('Historical R2 capture target mismatch');
  const migrations = await (offline?.migrations ?? migrationInputs)();
  if (
    ![156, 157].includes(migrations.length) ||
    migrations[155]?.name !== '20261015150000_case_section_record_edits' ||
    (migrations.length === 157 &&
      migrations[156]?.name !== '20261015170000_case_section_record_uploads')
  )
    throw new Error(
      'Historical source migrations are not the approved 156/157 chain',
    );
  const client = (
    offline?.openClient ?? ((url) => new Client({ connectionString: url }))
  )(target.connectionString);
  try {
    await client.connect();
    const identity = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema,current_user AS username',
      )
    ).rows;
    if (
      identity.length !== 1 ||
      identity[0].db !== 'dev_cor_test' ||
      identity[0].schema !== 'public' ||
      identity[0].username !== 'dev_cor_test'
    )
      throw new Error('Unexpected historical record probe database');
    const applied = (
      await client.query(
        'SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name',
      )
    ).rows;
    if (
      applied.length !== migrations.length ||
      applied.some(
        (row, index) =>
          row.migration_name !== migrations[index].name ||
          row.checksum !== migrations[index].checksum ||
          !row.finished_at ||
          row.rolled_back_at !== null,
      )
    )
      throw new Error('Historical R2 migration identity mismatch');
    return await operation(client);
  } finally {
    await client.end();
  }
}
const withDatabase = withHistoricalRecordDatabase;
// Only the already-created H operator is admitted here. No identity/Grant writes or fallback.
export async function restoreHistoricalRecordActor(
  binding,
  credential,
  offline,
) {
  if (
    binding === null ||
    typeof binding !== 'object' ||
    Object.entries(originalActorBinding).some(
      ([key, value]) => binding[key] !== value,
    )
  )
    throw new Error('Historical actor creation binding mismatch');
  if (
    !credential ||
    typeof credential.username !== 'string' ||
    !/^historical-record-[0-9a-f-]{36}$/iu.test(credential.username) ||
    typeof credential.password !== 'string' ||
    !credential.password
  )
    throw new Error('Original historical actor credential is required');
  const { username, password } = credential;
  const {
    userId,
    roleId,
    departmentId,
    assignmentId,
    membershipId,
    credentialId,
  } = originalActorBinding;
  await withDatabase(async (client) => {
    const ledger = (
      await client.query(
        'SELECT count(*)::int AS count FROM public._prisma_migrations',
      )
    ).rows;
    if (ledger.length !== 1 || ledger[0].count !== 157)
      throw new Error(
        'Historical actor recovery requires the current 157 ledger',
      );
    const rows = (
      await client.query(
        `SELECT u.id AS user_id,r.id AS role_id,r.department_id,
                a.id AS assignment_id,a.team_id,m.id AS membership_id,c.id AS credential_id,c.username
         FROM user_accounts u
         JOIN role_assignments a ON a.user_id=u.id AND a.active
         JOIN role_templates r ON r.id=a.role_template_id AND r.department_id=a.department_id AND r.active
         JOIN department_memberships m ON m.user_id=u.id AND m.department_id=a.department_id AND m.active
         JOIN local_credentials c ON c.user_id=u.id
         WHERE u.id=$1 AND u.active AND u.account_type='INTERNAL'`,
        [userId],
      )
    ).rows;
    const expected = {
      user_id: userId,
      role_id: roleId,
      department_id: departmentId,
      assignment_id: assignmentId,
      team_id: null,
      membership_id: membershipId,
      credential_id: credentialId,
      username,
    };
    if (
      rows.length !== 1 ||
      Object.entries(expected).some(([key, value]) => rows[0][key] !== value)
    )
      throw new Error(
        'Historical actor active identity does not match creation evidence',
      );
    const grants = (
      await client.query(
        'SELECT id,action::text AS action,scope::text AS scope FROM role_grants WHERE role_template_id=$1',
        [roleId],
      )
    ).rows;
    const originalGrants = grants
      .filter((row) => !approvedMissingActions.includes(row.action))
      .map(({ id, action, scope }) => ({ id, action, scope }))
      .sort((a, b) => (a.action < b.action ? -1 : a.action > b.action ? 1 : 0));
    if (
      grants.length !== 42 ||
      new Set(grants.map((row) => row.action)).size !== 42 ||
      grants.some((row) => row.scope !== 'DEPARTMENT' || !uuid.test(row.id)) ||
      approvedMissingActions.some(
        (action) => !grants.some((row) => row.action === action),
      ) ||
      createHash('sha256')
        .update(JSON.stringify(originalGrants))
        .digest('hex') !==
        '857df0a89247fb3a630a0cfd8f1bb3048a0aba6a95c59e92a121a64e57158602'
    )
      throw new Error(
        'Historical actor requires preserved original 35 and exactly seven approved grants',
      );
  }, offline);
  const actor = Object.freeze({
    userId,
    roleId,
    departmentId,
    username,
    password,
  });
  actors.set(userId, actor);
  return actor;
}
async function assertCase(client, caseId) {
  if (!uuid.test(caseId) || !ownedCases.has(caseId))
    throw new Error('Unowned historical synthetic case');
  const result = await client.query(
    'SELECT id FROM cases WHERE id=$1 AND department_id=$2',
    [caseId, departmentA],
  );
  if (result.rows.length !== 1)
    throw new Error('Historical record probe outside synthetic department');
}

// Every inserted security row belongs to this UUID actor; baseline rows are read-only.
export async function createHistoricalRecordActor(
  { readOnly = false, foreign = false } = {},
  offline,
) {
  const userId = randomUUID(),
    roleId = randomUUID();
  const departmentId = foreign
    ? '10000000-0000-4000-8000-000000000002'
    : departmentA;
  const username = `historical-record-${randomUUID()}`,
    password = `H-${randomUUID()}-synthetic`;
  await withDatabase(async (client) => {
    const hashPassword =
      offline?.hashPassword ??
      requireBackend('./dist/auth/password.js').hashPassword;
    const passwordHash = await hashPassword(password);
    const prior = (
      await client.query(
        'SELECT action FROM role_grants WHERE role_template_id=$1 ORDER BY action',
        [baselineRoles[0]],
      )
    ).rows;
    if (prior.length === 0)
      throw new Error('Runner must prepare its preserved baseline first');
    await client.query('BEGIN');
    try {
      await client.query(
        'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES($1,$2,$2,now())',
        [userId, username],
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
        [roleId, departmentId, username],
      );
      const actions = readOnly
        ? ['case.read']
        : [
            ...new Set([
              ...prior.map((row) => row.action),
              'case.hearing.schedule',
              'case.hearing.correct',
              'case.judgment.register',
              'case.judgment.correct',
              'case.judgment.next_step',
              'case.second_instance.result',
              'case.execution.submit',
              'case.execution.confirm',
              'case.execution.mail',
              'case.execution.filing.submit',
              'case.execution.finish',
              'case.closure.record',
              'case.closure.correct',
              'case.archive',
              'case.archive.correct',
            ]),
          ];
      for (const action of actions) {
        await client.query(
          "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES($1,$2,$3::permission_action,'DEPARTMENT')",
          [randomUUID(), roleId, action],
        );
      }
      await client.query(
        'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,updated_at) VALUES($1,$2,$3,$4,now())',
        [randomUUID(), userId, departmentId, roleId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }, offline);
  const actor = Object.freeze({
    userId,
    roleId,
    departmentId,
    username,
    password,
  });
  actors.set(userId, actor);
  return actor;
}
export async function ownHistoricalRecordCase(caseId, actorUserId) {
  if (
    !uuid.test(caseId) ||
    !actors.has(actorUserId) ||
    actors.get(actorUserId).departmentId !== departmentA
  )
    throw new Error('Unowned historical actor or case');
  await withDatabase(async (client) => {
    const rows = (
      await client.query(
        'SELECT c.id FROM cases c JOIN leads l ON l.id=c.source_lead_id AND l.department_id=c.department_id WHERE c.id=$1 AND c.department_id=$2 AND l.pushed_by_user_id=$3',
        [caseId, departmentA, actorUserId],
      )
    ).rows;
    if (rows.length !== 1)
      throw new Error(
        'Historical case was not created through this run actor source',
      );
  });
  ownedCases.add(caseId);
}
export async function historicalBaselineSecuritySnapshot(offline) {
  return withDatabase(async (client) => {
    const result = {};
    for (const [table, column, ids] of [
      ['user_accounts', 'id', baselineUsers],
      ['local_credentials', 'user_id', baselineUsers],
      ['auth_sessions', 'user_id', baselineUsers],
      ['department_memberships', 'user_id', baselineUsers],
      ['role_assignments', 'user_id', baselineUsers],
      ['role_templates', 'id', baselineRoles],
      ['role_grants', 'role_template_id', baselineRoles],
    ])
      result[table] = (
        await client.query(
          `SELECT to_jsonb(t) AS row FROM "${table}" t WHERE "${column}"=ANY($1::uuid[]) ORDER BY to_jsonb(t)::text`,
          [ids],
        )
      ).rows;
    if (
      result.user_accounts.length !== 3 ||
      result.role_templates.length !== 3 ||
      result.role_grants.length !== 66
    )
      throw new Error('Unexpected preserved baseline security cohort');
    // Hash complete rows to prove all fields without exposing credential/session bytes on assertion failure.
    return Object.fromEntries(
      Object.entries(result).map(([table, rows]) => [
        table,
        {
          count: rows.length,
          sha256: createHash('sha256')
            .update(JSON.stringify(rows))
            .digest('hex'),
        },
      ]),
    );
  }, offline);
}

async function snapshot(client, caseId) {
  const result = {};
  result.case = (
    await client.query('SELECT to_jsonb(c) AS row FROM cases c WHERE id=$1', [
      caseId,
    ])
  ).rows;
  for (const table of [
    'case_trial_rounds',
    'case_acceptances',
    'case_acceptance_corrections',
    'case_second_instance_progresses',
    'case_second_instance_results',
    'case_second_instance_acceptance_changes',
    'case_hearing_arrangements',
    'case_hearing_advances',
    'case_hearing_corrections',
    'case_hearing_receipts',
    'case_judgment_facts',
    'case_judgment_versions',
    'case_judgment_receipts',
    'case_judgment_next_steps',
    'case_execution_submissions',
    'case_execution_confirmations',
    'case_execution_mailings',
    'case_execution_filings',
    'case_execution_finishes',
    'case_closures',
    'case_closure_versions',
    'case_closure_documents',
    'case_closure_receipts',
    'case_archives',
    'case_archive_versions',
    'case_archive_receipts',
  ]) {
    result[table] = (
      await client.query(
        `SELECT to_jsonb(t) AS row FROM "${table}" t WHERE case_id=$1 ORDER BY to_jsonb(t)::text`,
        [caseId],
      )
    ).rows;
  }
  result.oldAudits = (
    await client.query(
      "SELECT to_jsonb(a) AS row FROM audit_events a WHERE resource_type='CASE' AND resource_id=$1 AND action NOT LIKE '%.record-corrected' ORDER BY id",
      [caseId],
    )
  ).rows;
  return result;
}
export async function historicalRecordFrozenSnapshot(caseId) {
  return withDatabase(async (client) => {
    await assertCase(client, caseId);
    return snapshot(client, caseId);
  });
}
async function sectionState(client, caseId) {
  const result = {};
  for (const table of [
    'case_hearing_record_corrections',
    'case_judgment_record_corrections',
    'case_closure_record_corrections',
    'case_judgment_record_documents',
    'case_closure_record_documents',
    'case_section_record_edit_receipts',
  ]) {
    result[table] = (
      await client.query(
        `SELECT to_jsonb(t) AS row FROM "${table}" t WHERE case_id=$1 ORDER BY to_jsonb(t)::text`,
        [caseId],
      )
    ).rows;
  }
  result.audits = (
    await client.query(
      "SELECT to_jsonb(a) AS row FROM audit_events a WHERE resource_id=$1 AND action LIKE '%.record-corrected' ORDER BY id",
      [caseId],
    )
  ).rows;
  result.references = (
    await client.query(
      "SELECT to_jsonb(r) AS row FROM material_references r WHERE resource_type='case' AND resource_id=$1 ORDER BY id",
      [caseId],
    )
  ).rows;
  return result;
}
export async function historicalRecordSectionSnapshot(caseId) {
  return withDatabase(async (client) => {
    await assertCase(client, caseId);
    return sectionState(client, caseId);
  });
}
export async function historicalRecordMutationProbe(
  caseId,
  correctionId,
  kind,
) {
  if (
    !uuid.test(correctionId) ||
    !['hearing', 'judgment', 'closure'].includes(kind)
  )
    throw new Error('Invalid historical probe target');
  return withDatabase(async (client) => {
    await assertCase(client, caseId);
    const before = JSON.stringify(await sectionState(client, caseId));
    let code = null;
    await client.query('BEGIN');
    try {
      const result = await client.query(
        `UPDATE "case_${kind}_record_corrections" SET correction_reason='forbidden mutation' WHERE id=$1 AND case_id=$2 RETURNING id`,
        [correctionId, caseId],
      );
      if (result.rows.length !== 1)
        throw new Error('Historical probe did not reach exact correction');
    } catch (error) {
      code = error.code ?? 'PROBE_NOT_REACHED';
    } finally {
      await client.query('ROLLBACK');
    }
    return {
      code,
      unchanged: before === JSON.stringify(await sectionState(client, caseId)),
    };
  });
}
export async function withHistoricalRecordFault(caseId, kind, phase, command) {
  if (!['hearing', 'judgment', 'closure'].includes(kind))
    throw new Error('Invalid historical fault kind');
  const tables = {
    audit: 'audit_events',
    fact: `case_${kind}_record_corrections`,
    receipt: 'case_section_record_edit_receipts',
    document: `case_${kind}_record_documents`,
    reference: 'material_references',
  };
  if (
    !Object.hasOwn(tables, phase) ||
    (kind === 'hearing' && ['document', 'reference'].includes(phase))
  )
    throw new Error('Unsupported historical fault phase');
  return withDatabase(async (client) => {
    await assertCase(client, caseId);
    const before = JSON.stringify(await sectionState(client, caseId));
    const name = `h_record_fault_${randomUUID().replaceAll('-', '')}`;
    const table = tables[phase];
    const condition =
      phase === 'audit'
        ? `NEW.resource_id='${caseId}'::uuid AND NEW.action='case.${kind}.record-corrected'`
        : phase === 'reference'
          ? `NEW.resource_id='${caseId}'::uuid`
          : `NEW.case_id='${caseId}'::uuid`;
    let installed = false;
    try {
      await client.query(`CREATE SEQUENCE "${name}_hit"`);
      await client.query(
        `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN PERFORM nextval('"${name}_hit"'); RAISE EXCEPTION 'historical record injected fault' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`,
      );
      await client.query(
        `CREATE TRIGGER "${name}" BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION "${name}"()`,
      );
      installed = true;
      const response = await command();
      const reached = (
        await client.query(`SELECT is_called FROM "${name}_hit"`)
      ).rows[0].is_called;
      return {
        status: response.status(),
        reached,
        unchanged:
          before === JSON.stringify(await sectionState(client, caseId)),
      };
    } finally {
      if (installed) await client.query(`DROP TRIGGER "${name}" ON "${table}"`);
      await client.query(`DROP FUNCTION IF EXISTS "${name}"()`);
      await client.query(`DROP SEQUENCE IF EXISTS "${name}_hit"`);
    }
  });
}
