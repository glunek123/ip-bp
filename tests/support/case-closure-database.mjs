import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';
import { coreLeadFixtures } from './core-lead-database.mjs';
import { createCaseExecutionFilingSourceThroughApi } from './case-execution-filing-database.mjs';

const departments = [
  coreLeadFixtures.departmentA,
  coreLeadFixtures.departmentB,
];
const roles = [
  coreLeadFixtures.roleA,
  coreLeadFixtures.roleB,
  coreLeadFixtures.roleSelf,
];
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const tables = [
  'case_closures',
  'case_closure_versions',
  'case_closure_documents',
  'case_closure_receipts',
];

async function connect() {
  if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL)
    throw new Error('Closure fixtures require the isolated test runtime');
  // These probes are deliberately fixed to backend/.env.test (15433), never 15436.
  validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
  if (
    resolve(process.env.PRIVATE_FILE_ROOT ?? '') !==
    resolve(process.cwd(), '.local/private-files/test')
  )
    throw new Error('Closure fixtures require the isolated test file root');
  const backend = createRequire(resolve(process.cwd(), 'backend/package.json'));
  const { Client } = backend('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const identity = (
    await client.query(
      'SELECT current_database() AS db,current_schema() AS schema',
    )
  ).rows[0];
  if (identity.db !== 'dev_cor_test' || identity.schema !== 'public') {
    await client.end();
    throw new Error('Unexpected closure fixture database');
  }
  return client;
}

async function assertCase(client, caseId) {
  if (!uuid.test(caseId)) throw new Error('Invalid fixture case identity');
  const rows = (
    await client.query(
      'SELECT id FROM cases WHERE id=$1 AND department_id=ANY($2::uuid[])',
      [caseId, departments],
    )
  ).rows;
  if (rows.length !== 1)
    throw new Error('Case is outside the synthetic fixture departments');
}

export async function setCaseClosureFixtureGrant(
  roleId,
  action,
  scope,
  enabled = true,
) {
  if (
    !roles.includes(roleId) ||
    ![
      'case.closure.record',
      'case.closure.correct',
      'case.execution.finish',
      'case.judgment.register',
      'case.judgment.next_step',
      'case.execution.submit',
    ].includes(action) ||
    !['SELF', 'TEAM', 'DEPARTMENT'].includes(scope)
  )
    throw new Error('Grant is outside the explicit synthetic closure setup');
  const client = await connect();
  try {
    const row = (
      await client.query(
        'SELECT id FROM role_templates WHERE id=$1 AND department_id=ANY($2::uuid[])',
        [roleId, departments],
      )
    ).rows;
    if (row.length !== 1) throw new Error('Synthetic role missing');
    if (enabled)
      await client.query(
        'INSERT INTO role_grants(id,role_template_id,action,scope) VALUES($1,$2,$3::permission_action,$4::permission_scope) ON CONFLICT DO NOTHING',
        [randomUUID(), roleId, action, scope],
      );
    else
      await client.query(
        'DELETE FROM role_grants WHERE role_template_id=$1 AND action=$2::permission_action AND scope=$3::permission_scope',
        [roleId, action, scope],
      );
  } finally {
    await client.end();
  }
}

export async function createFinishedCaseClosureSourceThroughApi(request) {
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleA,
    'case.execution.finish',
    'TEAM',
  );
  const source = await createCaseExecutionFilingSourceThroughApi(request, {
    onComplaintSubmitted: async () => {
      for (const action of [
        'case.judgment.register',
        'case.judgment.next_step',
        'case.execution.submit',
        'case.execution.finish',
      ])
        await setCaseClosureFixtureGrant(
          coreLeadFixtures.roleA,
          action,
          'TEAM',
        );
    },
  });
  const headers = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
  const read = await request.get(`/api/v1/cases/${source.caseId}`, { headers });
  if (read.status() !== 200)
    throw new Error('Normal execution source detail unavailable');
  const item = await read.json();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const input = {
    expectedVersion: item.version,
    idempotencyKey: randomUUID(),
    expectedFilingId: item.executionFiling.id,
    finishedAt: today,
    reason: '合成验收：执行程序已实际结束',
    basisNote: '独立真实结束说明；不代表已收款或已归档',
    basisContentVersionIds: [],
  };
  const response = await request.post(
    `/api/v1/cases/${source.caseId}/execution-finish`,
    { headers, data: input },
  );
  if (response.status() !== 201)
    throw new Error('Normal API execution finish failed');
  const finished = await response.json();
  return { ...source, finished, finishInput: input };
}

async function snapshot(client, caseId) {
  const result = {};
  result.case = (
    await client.query('SELECT stage,version FROM cases WHERE id=$1', [caseId])
  ).rows;
  for (const table of tables)
    result[table] = (
      await client.query(
        `SELECT to_jsonb(t) AS row FROM "${table}" t WHERE case_id=$1 ORDER BY to_jsonb(t)::text`,
        [caseId],
      )
    ).rows;
  result.audit = (
    await client.query(
      "SELECT to_jsonb(t) AS row FROM audit_events t WHERE resource_type='CASE' AND resource_id=$1 AND action IN ('case.closure.recorded','case.closure.corrected') ORDER BY id",
      [caseId],
    )
  ).rows;
  result.refs = (
    await client.query(
      "SELECT to_jsonb(t) AS row FROM material_references t WHERE resource_type='case' AND resource_id=$1 AND purpose='CASE_CLOSURE_DOCUMENT' ORDER BY id",
      [caseId],
    )
  ).rows;
  return JSON.stringify(result);
}

export async function caseClosureSqlRejection(caseId, probe) {
  const client = await connect();
  try {
    await assertCase(client, caseId);
    const before = await snapshot(client, caseId);
    const probes = {
      'case-version-only': 'UPDATE cases SET version=version+1 WHERE id=$1',
      'version-update':
        'UPDATE case_closure_versions SET case_id=case_id WHERE case_id=$1',
      'version-delete': 'DELETE FROM case_closure_versions WHERE case_id=$1',
      'document-delete': 'DELETE FROM case_closure_documents WHERE case_id=$1',
      'receipt-update':
        'UPDATE case_closure_receipts SET case_id=case_id WHERE case_id=$1',
      'receipt-delete': 'DELETE FROM case_closure_receipts WHERE case_id=$1',
      'audit-delete':
        "DELETE FROM audit_events WHERE resource_type='CASE' AND resource_id=$1 AND action IN ('case.closure.recorded','case.closure.corrected')",
      'head-foreign-current':
        'UPDATE case_closures SET current_version_id=gen_random_uuid() WHERE case_id=$1',
    };
    if (!Object.hasOwn(probes, probe))
      throw new Error('Unsupported closure SQL probe');
    let code = null;
    await client.query('BEGIN');
    try {
      await client.query(probes[probe], [caseId]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    } catch (error) {
      code = error.code;
    } finally {
      await client.query('ROLLBACK');
    }
    return { code, unchanged: before === (await snapshot(client, caseId)) };
  } finally {
    await client.end();
  }
}

export async function withCaseClosureFault(caseId, phase, command) {
  const client = await connect();
  const name = `ca016_fault_${randomUUID().replaceAll('-', '')}`;
  const sequence = `${name}_hit`;
  const targets = {
    audit: [
      'audit_events',
      'INSERT',
      `NEW.resource_id='${caseId}' AND NEW.action IN ('case.closure.recorded','case.closure.corrected')`,
    ],
    head: ['case_closures', 'INSERT', `NEW.case_id='${caseId}'`],
    version: ['case_closure_versions', 'INSERT', `NEW.case_id='${caseId}'`],
    document: ['case_closure_documents', 'INSERT', `NEW.case_id='${caseId}'`],
    reference: [
      'material_references',
      'INSERT',
      `NEW.resource_id='${caseId}' AND NEW.purpose='CASE_CLOSURE_DOCUMENT'`,
    ],
    case: [
      'cases',
      'UPDATE',
      `NEW.id='${caseId}' AND NEW.version<>OLD.version`,
    ],
    receipt: ['case_closure_receipts', 'INSERT', `NEW.case_id='${caseId}'`],
  };
  let installed = false;
  try {
    await assertCase(client, caseId);
    if (!Object.hasOwn(targets, phase))
      throw new Error('Unsupported closure fault phase');
    const [table, event, condition] = targets[phase];
    const before = await snapshot(client, caseId);
    // Sequence increments survive the deliberately rolled-back transaction:
    // this records that the tested write actually reached the injected fault.
    await client.query(`CREATE SEQUENCE "${sequence}"`);
    await client.query(
      `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN PERFORM nextval('"${sequence}"'); RAISE EXCEPTION 'ca016 injected ${phase} fault' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`,
    );
    await client.query(
      `CREATE TRIGGER "${name}" BEFORE ${event} ON "${table}" FOR EACH ROW EXECUTE FUNCTION "${name}"()`,
    );
    installed = true;
    const result = await command();
    const reached = (await client.query(`SELECT is_called FROM "${sequence}"`))
      .rows[0].is_called;
    return {
      status: result.status(),
      reached,
      unchanged: before === (await snapshot(client, caseId)),
    };
  } finally {
    if (installed)
      await client.query(`DROP TRIGGER "${name}" ON "${targets[phase][0]}"`);
    await client.query(`DROP FUNCTION IF EXISTS "${name}"()`);
    await client.query(`DROP SEQUENCE IF EXISTS "${sequence}"`);
    await client.end();
  }
}

export async function clearCaseClosureFixture() {
  const client = await connect();
  try {
    if (
      !(
        await client.query(
          "SELECT to_regclass('case_closures') IS NOT NULL AS yes",
        )
      ).rows[0].yes
    )
      return;
    await client.query('BEGIN');
    try {
      // Only this isolated synthetic fixture cleanup bypasses triggers/FKs, and
      // only inside a transaction; normal commands and probes never do so.
      await client.query('SET LOCAL session_replication_role=replica');
      await client.query(
        'UPDATE cases c SET version=f.to_version FROM case_execution_finishes f WHERE c.id=f.case_id AND c.department_id=ANY($1::uuid[])',
        [departments],
      );
      for (const table of [
        'case_closure_documents',
        'case_closure_receipts',
        'case_closures',
        'case_closure_versions',
      ])
        await client.query(
          `DELETE FROM "${table}" WHERE department_id=ANY($1::uuid[])`,
          [departments],
        );
      await client.query(
        "DELETE FROM material_references WHERE department_id=ANY($1::uuid[]) AND purpose='CASE_CLOSURE_DOCUMENT'",
        [departments],
      );
      await client.query(
        "DELETE FROM audit_events WHERE department_id=ANY($1::uuid[]) AND resource_type='CASE' AND action IN ('case.closure.recorded','case.closure.corrected')",
        [departments],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.end();
  }
}
