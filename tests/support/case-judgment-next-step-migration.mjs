import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const directory = resolve(root, 'backend/prisma/migrations');
const names = readdirSync(directory).filter((name) => /^\d{14}_/u.test(name)).sort();
const previous = '20261010013000_restore_customer_deletion_guard';
const added = [
  '20261010030000_add_case_judgment_next_step_enums',
  '20261010031000_add_case_judgment_next_step_facts',
  '20261010032000_guard_case_judgment_next_step_chain',
  '20261010033000_allow_lawyer_judgment_next_step_audit',
  '20261010034000_guard_case_judgment_plaintiff_snapshot',
];
const sql = (name) => readFileSync(resolve(directory, name, 'migration.sql'), 'utf8');

async function seedPrior112Rows(client) {
  const ids = Object.fromEntries(['department','actor','customer','holder','case','judgment','audit',
    'receipt','correction','correctionAudit','correctionReceipt','hearing','advance','material',
    'version','reference','correctionVersion','correctionReference'].map((name) => [name, randomUUID()]));
  await client.query('BEGIN');
  try {
    // Isolated migration fixture: seed a pre-CA-009 REGISTER -> CORRECT chain and both frozen references.
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query('INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
      [ids.department, 'CA009 prior112']);
    await client.query('INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
      [ids.actor, `ca009-${ids.actor}`, 'CA009 prior actor']);
    await client.query('INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [randomUUID(), ids.actor, ids.department]);
    await client.query(`INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at)
      VALUES ($1,$2,$3,$4,$5,now())`, [ids.customer, 'CA009 prior customer', 'ca009 prior customer', ids.department, ids.actor]);
    await client.query('INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [ids.holder, 'CA009 prior plaintiff', ids.department]);
    await client.query(`INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,
      certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at,
      complaint_amount_state,complaint_amount,complaint_submitted_at,complaint_submitted_by_user_id,
      court_case_no,current_judgment_id,current_hearing_arrangement_id,current_hearing_advance_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_JUDGMENT',11,now(),'KNOWN',100,now(),$9,
        'CA009-prior',$10,$11,$12)`,
      [ids.case, `CA009-prior-${ids.case}`, ids.department, randomUUID(), randomUUID(), randomUUID(),
        ids.customer, ids.holder, ids.actor, ids.correction, ids.hearing, ids.advance]);
    await client.query(`INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,
      resource_type,resource_id,action,details)
      VALUES ($1,$2,$3,$3,'CASE',$4,'case.judgment.registered',$5::jsonb)`,
      [ids.audit, ids.department, ids.actor, ids.case, JSON.stringify({
        judgmentId: ids.judgment, fromVersion: 9, toVersion: 10, judgmentReceivedAt: '2026-10-08',
        judgmentAmountState: 'KNOWN', judgmentAmount: '0', paidLitigationFeeState: 'PENDING',
        paidLitigationFee: null, judgmentContentVersionIds: [ids.version],
      })]);
    await client.query(`INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,
      resource_type,resource_id,action,details)
      VALUES ($1,$2,$3,$3,'CASE',$4,'case.judgment.corrected',$5::jsonb)`,
      [ids.correctionAudit, ids.department, ids.actor, ids.case, JSON.stringify({
        judgmentId: ids.correction, priorFactId: ids.judgment, reason: '更正旧判决',
        fromVersion: 10, toVersion: 11, judgmentReceivedAt: '2026-10-08',
        judgmentAmountState: 'KNOWN', judgmentAmount: '0', paidLitigationFeeState: 'PENDING',
        paidLitigationFee: null, judgmentContentVersionIds: [ids.correctionVersion],
      })]);
    await client.query(`INSERT INTO case_judgment_facts(id,department_id,case_id,kind,judgment_received_at,
      judgment_amount_state,judgment_amount,paid_litigation_fee_state,recorded_by_user_id,
      from_version,to_version,audit_event_id)
      VALUES ($1,$2,$3,'REGISTER','2026-10-08','KNOWN',0,'PENDING',$4,9,10,$5)`,
      [ids.judgment, ids.department, ids.case, ids.actor, ids.audit]);
    await client.query(`INSERT INTO case_judgment_facts(id,department_id,case_id,kind,prior_fact_id,
      judgment_received_at,judgment_amount_state,judgment_amount,paid_litigation_fee_state,
      reason,recorded_by_user_id,from_version,to_version,audit_event_id)
      VALUES ($1,$2,$3,'CORRECT',$4,'2026-10-08','KNOWN',0,'PENDING','更正旧判决',$5,10,11,$6)`,
      [ids.correction, ids.department, ids.case, ids.judgment, ids.actor, ids.correctionAudit]);
    await client.query(`INSERT INTO case_hearing_arrangements(id,department_id,case_id,hearing_at,source,
      recorded_by_user_id,from_version,to_version,audit_event_id)
      VALUES ($1,$2,$3,'2026-10-02','SCHEDULE',$4,7,8,$5)`,
      [ids.hearing, ids.department, ids.case, ids.actor, randomUUID()]);
    await client.query(`INSERT INTO case_hearing_advances(id,department_id,case_id,arrangement_id,due_at,
      executed_at,from_version,to_version,audit_event_id)
      VALUES ($1,$2,$3,$4,'2026-10-02T16:00:00Z','2026-10-02T16:00:01Z',8,9,$5)`,
      [ids.advance, ids.department, ids.case, ids.hearing, randomUUID()]);
    await client.query(`INSERT INTO materials(id,department_id,owner_type,owner_id,category,purpose,
      current_version_id,status,version,updated_at)
      VALUES ($1,$2,'CASE',$3,'JUDGMENT','JUDGMENT',$4,'ACTIVE',2,now())`,
      [ids.material, ids.department, ids.case, ids.correctionVersion]);
    await client.query(`INSERT INTO content_versions(id,material_id,storage_key,original_filename,mime_type,
      size_bytes,sha256,uploaded_by,status)
      VALUES ($1,$2,$3,'prior-judgment.pdf','application/pdf',16,$4,$5,'AVAILABLE')`,
      [ids.version, ids.material, `ca009-prior-${ids.version}`, 'a'.repeat(64), ids.actor]);
    await client.query(`INSERT INTO content_versions(id,material_id,storage_key,original_filename,mime_type,
      size_bytes,sha256,uploaded_by,status)
      VALUES ($1,$2,$3,'corrected-judgment.pdf','application/pdf',19,$4,$5,'AVAILABLE')`,
      [ids.correctionVersion, ids.material, `ca009-prior-${ids.correctionVersion}`, 'c'.repeat(64), ids.actor]);
    await client.query(`INSERT INTO case_judgment_versions(fact_id,case_id,department_id,material_id,content_version_id)
      VALUES ($1,$2,$3,$4,$5)`, [ids.judgment, ids.case, ids.department, ids.material, ids.version]);
    await client.query(`INSERT INTO case_judgment_versions(fact_id,case_id,department_id,material_id,content_version_id)
      VALUES ($1,$2,$3,$4,$5)`, [ids.correction, ids.case, ids.department, ids.material, ids.correctionVersion]);
    await client.query(`INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,
      material_id,content_version_id,action_event_id)
      VALUES ($1,$2,'case',$3,'JUDGMENT',$4,$5,$6)`,
      [ids.reference, ids.department, ids.case, ids.material, ids.version, ids.audit]);
    await client.query(`INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,
      material_id,content_version_id,action_event_id)
      VALUES ($1,$2,'case',$3,'JUDGMENT',$4,$5,$6)`,
      [ids.correctionReference, ids.department, ids.case, ids.material,
        ids.correctionVersion, ids.correctionAudit]);
    await client.query(`INSERT INTO case_judgment_receipts(id,department_id,actor_user_id,case_id,action,
      idempotency_key,request_fingerprint,result_snapshot)
      VALUES ($1,$2,$3,$4,'REGISTER',$5,$6,$7::jsonb)`,
      [ids.receipt, ids.department, ids.actor, ids.case, `ca009-prior-${ids.case}`, 'b'.repeat(64),
        JSON.stringify({ id: ids.case, stage: 'WAITING_JUDGMENT', version: 10,
          judgmentId: ids.judgment, recordedAt: new Date().toISOString() })]);
    await client.query(`INSERT INTO case_judgment_receipts(id,department_id,actor_user_id,case_id,action,
      idempotency_key,request_fingerprint,result_snapshot)
      VALUES ($1,$2,$3,$4,'CORRECT',$5,$6,$7::jsonb)`,
      [ids.correctionReceipt, ids.department, ids.actor, ids.case,
        `ca009-correct-${ids.case}`, 'd'.repeat(64),
        JSON.stringify({ id: ids.case, stage: 'WAITING_JUDGMENT', version: 11,
          judgmentId: ids.correction, recordedAt: new Date().toISOString() })]);
    await client.query('COMMIT');
    return ids;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

async function priorRowsSnapshot(client, ids) {
  const rows = await client.query(`SELECT jsonb_build_object(
    'case', (SELECT jsonb_build_object('stage',stage,'version',version,'judgment',current_judgment_id,
      'hearing',current_hearing_arrangement_id,'advance',current_hearing_advance_id) FROM cases WHERE id=$1),
    'facts', (SELECT jsonb_agg(to_jsonb(f) ORDER BY f.to_version) FROM case_judgment_facts f WHERE case_id=$1),
    'receipts', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.action) FROM case_judgment_receipts r WHERE case_id=$1),
    'audits', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.action) FROM audit_events a
      WHERE a.id IN ($3,$8)),
    'hearing', (SELECT to_jsonb(h) FROM case_hearing_arrangements h WHERE id=$4),
    'advance', (SELECT to_jsonb(v) FROM case_hearing_advances v WHERE id=$5),
    'frozenVersions', (SELECT jsonb_agg(to_jsonb(v) ORDER BY v.fact_id) FROM case_judgment_versions v
      WHERE v.fact_id IN ($2,$9)),
    'frozenReferences', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM material_references r
      WHERE r.id IN ($6,$10)),
    'contents', (SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM content_versions v
      WHERE v.id IN ($7,$11))
  ) AS value`, [ids.case, ids.judgment, ids.audit, ids.hearing, ids.advance,
    ids.reference, ids.version, ids.correctionAudit, ids.correction,
    ids.correctionReference, ids.correctionVersion]);
  return JSON.stringify(rows.rows[0].value);
}

async function chooseCorrectedHeadWithGuards(client, ids) {
  const choiceId = randomUUID();
  const auditId = randomUUID();
  const recordedAt = new Date().toISOString();
  await client.query('BEGIN');
  try {
    // Origin mode is deliberate: this is the new CA-009 path whose guards are being proved.
    const role = (await client.query('SHOW session_replication_role')).rows[0].session_replication_role;
    if (role !== 'origin') throw new Error('Corrected-head choice must exercise normal database guards');
    await client.query(`INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,
      resource_type,resource_id,action,details)
      VALUES ($1,$2,$3,$3,'CASE',$4,'case.judgment.next_step',$5::jsonb)`,
      [auditId, ids.department, ids.actor, ids.case, JSON.stringify({
        choiceId, judgmentId: ids.correction, next: 'EXECUTION', fromVersion: 11, toVersion: 12,
        plaintiffAppeals: false, defendantIds: [], executionReadinessConfirmed: true,
      })]);
    await client.query(`INSERT INTO case_judgment_next_steps(id,case_id,department_id,judgment_id,next,
      execution_readiness_confirmed,from_version,to_version,recorded_at,recorded_by_user_id,audit_event_id)
      VALUES ($1,$2,$3,$4,'EXECUTION',true,11,12,$5,$6,$7)`,
      [choiceId, ids.case, ids.department, ids.correction, recordedAt, ids.actor, auditId]);
    await client.query(`UPDATE cases SET stage='WAITING_EXECUTION_DOCUMENTS',version=12,
      current_judgment_next_step_id=$1 WHERE id=$2`, [choiceId, ids.case]);
    await client.query(`INSERT INTO case_judgment_next_step_receipts(department_id,actor_user_id,
      case_id,action,idempotency_key,request_fingerprint,result_snapshot)
      VALUES ($1,$2,$3,'CHOOSE',$4,$5,$6::jsonb)`,
      [ids.department, ids.actor, ids.case, `prior-correct-choice-${ids.case}`, 'e'.repeat(64),
        JSON.stringify({ id: ids.case, stage: 'WAITING_EXECUTION_DOCUMENTS', version: 12,
          choiceId, judgmentId: ids.correction, recordedAt })]);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  const { rows } = await client.query(`SELECT c.stage,c.version,c.current_judgment_id,
    c.current_judgment_next_step_id,s.judgment_id,
    (SELECT count(*)::int FROM case_judgment_facts f WHERE f.case_id=c.id) AS fact_count
    FROM cases c JOIN case_judgment_next_steps s ON s.id=c.current_judgment_next_step_id
    WHERE c.id=$1`, [ids.case]);
  const row = rows[0];
  return row?.stage === 'WAITING_EXECUTION_DOCUMENTS' && row.version === 12 &&
    row.current_judgment_id === ids.correction && row.current_judgment_next_step_id === choiceId &&
    row.judgment_id === ids.correction && row.fact_count === 2;
}

export async function verifyCaseJudgmentNextStepMigration() {
  if (process.env.NODE_ENV !== 'test') throw new Error('Isolated migration probe requires NODE_ENV=test');
  validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL, { allowRandomPort: true });
  const previousNames = names.filter((name) => name <= previous);
  if (previousNames.length !== 112 || previousNames.at(-1) !== previous ||
      names.length !== 117 || added.some((name, i) => names[112 + i] !== name))
    throw new Error('Unexpected prior 112 migration chain or CA-009 suffix');
  const schema = `ca009_next_${randomUUID().replaceAll('-', '')}`;
  if (!/^ca009_next_[0-9a-f]{32}$/u.test(schema)) throw new Error('Unsafe temporary schema');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  let created = false;
  let priorRows;
  let before;
  try {
    await client.connect();
    const location = (await client.query('SELECT current_database() AS db, current_schema() AS schema')).rows[0];
    if (location.db !== 'dev_cor_test' || location.schema !== 'public') throw new Error('Isolated public test database required');
    await client.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await client.query(`SET search_path TO "${schema}"`);
    for (const name of names) {
      if (name === added[0]) {
        priorRows = await seedPrior112Rows(client);
        before = await priorRowsSnapshot(client, priorRows);
      }
      try { await client.query(sql(name)); }
      catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
    }
    const rows = (await client.query(`SELECT
      to_regclass('case_judgment_next_steps') IS NOT NULL AS choice,
      to_regclass('case_judgment_next_step_revocations') IS NOT NULL AS revoke,
      to_regclass('case_judgment_next_step_receipts') IS NOT NULL AS receipt,
      (SELECT count(*)::int FROM pg_trigger t
        JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema() AND t.tgname IN
        ('case_judgment_next_step_case_guard','case_judgment_next_step_fact_guard','case_judgment_next_step_revoke_guard','case_judgment_plaintiff_snapshot_guard')) AS guards`)).rows[0];
    if (!rows.choice || !rows.revoke || !rows.receipt || rows.guards !== 4)
      throw new Error('CA-009 migrated schema incomplete');
    const legacyPreserved = before === await priorRowsSnapshot(client, priorRows);
    if (!legacyPreserved) throw new Error('Prior 112 case, judgment, hearing, receipt or frozen reference changed');
    const oldRows = JSON.parse(before);
    const legacyCorrectionPreserved = oldRows.case.judgment === priorRows.correction &&
      oldRows.facts.length === 2 && oldRows.receipts.length === 2 &&
      oldRows.frozenVersions.length === 2 && oldRows.frozenReferences.length === 2 &&
      oldRows.contents.length === 2 && oldRows.facts.some((fact) =>
        fact.id === priorRows.correction && fact.kind === 'CORRECT' &&
        fact.prior_fact_id === priorRows.judgment);
    if (!legacyCorrectionPreserved) throw new Error('Prior 112 corrected judgment chain incomplete');
    const correctedHeadSelectable = await chooseCorrectedHeadWithGuards(client, priorRows);
    if (!correctedHeadSelectable) throw new Error('Migrated corrected head could not be chosen normally');
    return { migrationCount: names.length, priorMigrationCount: previousNames.length,
      guards: rows.guards, legacyPreserved, legacyCorrectionPreserved, correctedHeadSelectable };
  } finally {
    if (created) {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
    await client.end();
  }
}
