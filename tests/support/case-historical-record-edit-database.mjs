import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { validateBrowserTestDatabaseUrl } from '../../scripts/test-environment.mjs';
import { coreLeadFixtures } from './core-lead-database.mjs';

const requireBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { Client } = requireBackend('pg');
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
async function withDatabase(operation) {
  const url = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== 'test' || !url)
    throw new Error('Historical record probes require isolated test runtime');
  validateBrowserTestDatabaseUrl(url, process.cwd());
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema',
      )
    ).rows[0];
    if (identity.db !== 'dev_cor_test' || identity.schema !== 'public')
      throw new Error('Unexpected historical record probe database');
    return await operation(client);
  } finally {
    await client.end();
  }
}
async function assertCase(client, caseId) {
  if (!uuid.test(caseId)) throw new Error('Invalid synthetic case identity');
  const result = await client.query(
    'SELECT id FROM cases WHERE id=$1 AND department_id=$2',
    [caseId, coreLeadFixtures.departmentA],
  );
  if (result.rows.length !== 1)
    throw new Error('Historical record probe outside synthetic department');
}

// Append grants only to the existing synthetic role. Never provision a real user or clear data.
export async function grantHistoricalRecordFixtureActions() {
  return withDatabase(async (client) => {
    const role = await client.query(
      'SELECT id FROM role_templates WHERE id=$1 AND department_id=$2',
      [coreLeadFixtures.roleA, coreLeadFixtures.departmentA],
    );
    if (role.rows.length !== 1)
      throw new Error('Historical record synthetic role missing');
    await client.query('BEGIN');
    try {
      for (const action of [
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
      ]) {
        await client.query(
          "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES($1,$2,$3::permission_action,'TEAM') ON CONFLICT DO NOTHING",
          [randomUUID(), coreLeadFixtures.roleA, action],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
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
