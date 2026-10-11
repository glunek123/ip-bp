import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const directory = resolve(root, 'backend/prisma/migrations');
const names = readdirSync(directory)
  .filter((name) => /^\d{14}_/u.test(name))
  .sort();
const target = '20261010040000_add_case_trial_round_foundation';
const repair = '20261010041000_repair_case_trial_round_guard';
const detachRepair = '20261010042000_reject_detached_initial_trial_round';
const secondInstanceMigrations = [
  '20261010043000_add_case_second_instance_enums',
  '20261010044000_add_case_second_instance_facts',
  '20261010045000_guard_case_second_instance_chain',
  '20261010046000_repair_case_second_instance_version_guard',
  '20261010047000_allow_second_instance_frozen_version_reuse',
  '20261010048000_allow_remand_after_revoked_child',
  '20261010049000_guard_empty_remand_child_version',
  '20261010050000_guard_retrial_prejudgment_version',
  '20261011010000_allow_lawyer_second_instance_material_upload',
];
const sql = (name) =>
  readFileSync(resolve(directory, name, 'migration.sql'), 'utf8');

async function replay(client, migrations) {
  for (const name of migrations) {
    try {
      await client.query(sql(name));
    } catch (error) {
      throw new Error(`Migration ${name}: ${error.message}`, { cause: error });
    }
  }
}

async function seedLegacyCase(client, { invalid = false, early = false } = {}) {
  const ids = Object.fromEntries(
    [
      'department',
      'actor',
      'customer',
      'holder',
      'case',
      'acceptance',
      'audit',
      'receipt',
      'hearing',
      'advance',
      'judgment',
      'choice',
    ].map((name) => [name, randomUUID()]),
  );
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
      [ids.department, 'CA010 migration fixture'],
    );
    await client.query(
      'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
      [ids.actor, `ca010-${ids.actor}`, 'CA010 fixture actor'],
    );
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [randomUUID(), ids.actor, ids.department],
    );
    await client.query(
      'INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at) VALUES ($1,$2,$3,$4,$5,now())',
      [
        ids.customer,
        'CA010 fixture customer',
        'ca010 fixture customer',
        ids.department,
        ids.actor,
      ],
    );
    await client.query(
      'INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [ids.holder, 'CA010 fixture holder', ids.department],
    );
    await client.query(
      `INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at,complaint_amount_state,complaint_amount,complaint_submitted_at,complaint_submitted_by_user_id,court_case_no,current_hearing_arrangement_id,current_hearing_advance_id,current_judgment_id,current_judgment_next_step_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::case_stage,$11,now(),'KNOWN',100,now(),$9,'CA010-old',$12,$13,$14,$15)`,
      [
        ids.case,
        `CA010-${ids.case}`,
        ids.department,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        ids.customer,
        ids.holder,
        ids.actor,
        invalid || early ? 'WAITING_HEARING' : 'SECOND_INSTANCE',
        invalid || early ? 7 : 11,
        early ? null : ids.hearing,
        invalid || early ? null : ids.advance,
        invalid || early ? null : ids.judgment,
        invalid || early ? null : ids.choice,
      ],
    );
    await client.query(
      `INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action,details)
      VALUES ($1,$2,$3,$3,'CASE',$4,'case.acceptance.registered','{}'::jsonb)`,
      [ids.audit, ids.department, ids.actor, ids.case],
    );
    if (!invalid) {
      await client.query(
        `INSERT INTO case_acceptances(id,department_id,case_id,accepted_at,court_case_no,recorded_by_user_id,audit_event_id)
        VALUES ($1,$2,$3,'2026-10-01','CA010-old',$4,$5)`,
        [ids.acceptance, ids.department, ids.case, ids.actor, ids.audit],
      );
      await client.query(
        `INSERT INTO case_acceptance_receipts(id,department_id,actor_user_id,case_id,idempotency_key,request_fingerprint,result_snapshot)
        VALUES ($1,$2,$3,$4,'ca010-old-receipt',$5,$6::jsonb)`,
        [
          ids.receipt,
          ids.department,
          ids.actor,
          ids.case,
          'a'.repeat(64),
          JSON.stringify({
            id: ids.case,
            stage: 'WAITING_HEARING',
            version: 7,
            acceptedAt: '2026-10-01',
            courtCaseNo: 'CA010-old',
            recordedAt: '2026-10-01T10:00:00.000Z',
          }),
        ],
      );
      if (!early) {
        await client.query(
          `INSERT INTO case_hearing_arrangements(id,department_id,case_id,hearing_at,source,recorded_by_user_id,from_version,to_version,audit_event_id)
        VALUES ($1,$2,$3,'2026-10-02','SCHEDULE',$4,7,8,$5)`,
          [ids.hearing, ids.department, ids.case, ids.actor, randomUUID()],
        );
        await client.query(
          `INSERT INTO case_hearing_advances(id,department_id,case_id,arrangement_id,due_at,executed_at,from_version,to_version,audit_event_id)
        VALUES ($1,$2,$3,$4,'2026-10-02T16:00:00Z','2026-10-02T16:00:01Z',8,9,$5)`,
          [ids.advance, ids.department, ids.case, ids.hearing, randomUUID()],
        );
        await client.query(
          `INSERT INTO case_judgment_facts(id,department_id,case_id,kind,judgment_received_at,judgment_amount_state,judgment_amount,paid_litigation_fee_state,recorded_by_user_id,from_version,to_version,audit_event_id)
        VALUES ($1,$2,$3,'REGISTER','2026-10-05','KNOWN',100,'PENDING',$4,9,10,$5)`,
          [ids.judgment, ids.department, ids.case, ids.actor, randomUUID()],
        );
        await client.query(
          `INSERT INTO case_judgment_next_steps(id,department_id,case_id,judgment_id,next,plaintiff_rights_holder_id,plaintiff_name,execution_readiness_confirmed,from_version,to_version,recorded_by_user_id,audit_event_id)
        VALUES ($1,$2,$3,$4,'APPEAL',$5,'CA010 fixture holder',false,10,11,$6,$7)`,
          [
            ids.choice,
            ids.department,
            ids.case,
            ids.judgment,
            ids.holder,
            ids.actor,
            randomUUID(),
          ],
        );
      }
    }
    await client.query('COMMIT');
    return ids;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function verifyCaseSecondInstanceMigration() {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('Isolated test database required');
  validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL, {
    allowRandomPort: true,
  });
  if (
    names.length !== 129 ||
    names[116] !== '20261010034000_guard_case_judgment_plaintiff_snapshot' ||
    names[117] !== target ||
    names[118] !== repair ||
    names[119] !== detachRepair ||
    secondInstanceMigrations.some((name, index) => names[120 + index] !== name)
  )
    throw new Error('Unexpected 117 migration baseline or CA-010 suffix');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const schemas = ['empty', 'upgrade', 'repair', 'upgrade128'].map(
    (part) => `ca010_${part}_${randomUUID().replaceAll('-', '')}`,
  );
  const use = (schema) => client.query(`SET search_path TO "${schema}"`);
  try {
    await client.connect();
    const location = (
      await client.query(
        'SELECT current_database() AS db, current_schema() AS schema',
      )
    ).rows[0];
    if (location.db !== 'dev_cor_test' || location.schema !== 'public')
      throw new Error('Isolated public test database required');
    for (const schema of schemas)
      await client.query(`CREATE SCHEMA "${schema}"`);
    await use(schemas[0]);
    await replay(client, names);
    const emptyRoundTable = (
      await client.query(
        "SELECT to_regclass('case_trial_rounds') IS NOT NULL AS exists",
      )
    ).rows[0].exists;
    await use(schemas[1]);
    await replay(client, names.slice(0, -12));
    const legacy = await seedLegacyCase(client);
    const earlyAccepted = await seedLegacyCase(client, { early: true });
    const prior = (
      await client.query(
        'SELECT a.accepted_at::text AS date, a.recorded_by_user_id AS actor, r.result_snapshot AS receipt FROM case_acceptances a JOIN case_acceptance_receipts r ON r.case_id=a.case_id WHERE a.case_id=$1',
        [legacy.case],
      )
    ).rows[0];
    const factsBefore = (
      await client.query(
        `SELECT
          (SELECT jsonb_build_array(hearing_at,source,recorded_by_user_id,from_version,to_version,audit_event_id) FROM case_hearing_arrangements WHERE id=$1) AS hearing,
          (SELECT jsonb_build_array(arrangement_id,due_at,executed_at,from_version,to_version,audit_event_id) FROM case_hearing_advances WHERE id=$2) AS advance,
          (SELECT jsonb_build_array(kind,judgment_received_at,judgment_amount_state,judgment_amount,paid_litigation_fee_state,recorded_by_user_id,from_version,to_version,audit_event_id) FROM case_judgment_facts WHERE id=$3) AS judgment,
          (SELECT jsonb_build_array(judgment_id,next,plaintiff_rights_holder_id,plaintiff_name,from_version,to_version,recorded_by_user_id,audit_event_id) FROM case_judgment_next_steps WHERE id=$4) AS choice`,
        [legacy.hearing, legacy.advance, legacy.judgment, legacy.choice],
      )
    ).rows[0];
    await replay(client, [target, repair, detachRepair]);
    await replay(client, secondInstanceMigrations);
    let combinedDetachRejected = false;
    await client.query('BEGIN');
    try {
      await client.query(
        `UPDATE cases SET stage='WAITING_FORMAL_ACCEPTANCE',
          current_trial_round_id=NULL,current_acceptance_id=NULL,court_case_no=NULL
          WHERE id=$1`,
        [earlyAccepted.case],
      );
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    } catch (error) {
      combinedDetachRejected = error.code === '23514';
    } finally {
      await client.query('ROLLBACK');
    }
    const combinedDetachAtomic = (
      await client.query(
        `SELECT stage='WAITING_HEARING' AND current_trial_round_id IS NOT NULL
          AND current_acceptance_id=$2 AND court_case_no='CA010-old' AS preserved
          FROM cases WHERE id=$1`,
        [earlyAccepted.case, earlyAccepted.acceptance],
      )
    ).rows[0].preserved;
    const migrated = (
      await client.query(
        `SELECT c.current_trial_round_id AS round_id, c.current_acceptance_id AS acceptance_id, a.trial_round_id AS acceptance_round_id, a.accepted_at::text AS date, a.recorded_by_user_id AS actor, r.result_snapshot AS receipt
      FROM cases c JOIN case_acceptances a ON a.id=c.current_acceptance_id JOIN case_acceptance_receipts r ON r.case_id=c.id WHERE c.id=$1`,
        [legacy.case],
      )
    ).rows[0];
    const factsAfter = (
      await client.query(
        `SELECT
          (SELECT jsonb_build_array(hearing_at,source,recorded_by_user_id,from_version,to_version,audit_event_id) FROM case_hearing_arrangements WHERE id=$1) AS hearing,
          (SELECT jsonb_build_array(arrangement_id,due_at,executed_at,from_version,to_version,audit_event_id) FROM case_hearing_advances WHERE id=$2) AS advance,
          (SELECT jsonb_build_array(kind,judgment_received_at,judgment_amount_state,judgment_amount,paid_litigation_fee_state,recorded_by_user_id,from_version,to_version,audit_event_id) FROM case_judgment_facts WHERE id=$3) AS judgment,
          (SELECT jsonb_build_array(judgment_id,next,plaintiff_rights_holder_id,plaintiff_name,from_version,to_version,recorded_by_user_id,audit_event_id) FROM case_judgment_next_steps WHERE id=$4) AS choice`,
        [legacy.hearing, legacy.advance, legacy.judgment, legacy.choice],
      )
    ).rows[0];
    const factRounds = (
      await client.query(
        `SELECT (SELECT trial_round_id FROM case_hearing_arrangements WHERE id=$1) AS hearing,
      (SELECT trial_round_id FROM case_hearing_advances WHERE id=$2) AS advance,
      (SELECT trial_round_id FROM case_judgment_facts WHERE id=$3) AS judgment,
      (SELECT trial_round_id FROM case_judgment_next_steps WHERE id=$4) AS choice`,
        [legacy.hearing, legacy.advance, legacy.judgment, legacy.choice],
      )
    ).rows[0];
    const oldChainPreserved =
      migrated.round_id === migrated.acceptance_round_id &&
      migrated.acceptance_id === legacy.acceptance &&
      migrated.date === prior.date &&
      migrated.actor === prior.actor &&
      JSON.stringify(migrated.receipt) === JSON.stringify(prior.receipt) &&
      JSON.stringify(factsAfter) === JSON.stringify(factsBefore) &&
      Object.values(factRounds).every((id) => id === migrated.round_id);
    await client.query('UPDATE cases SET stage=stage WHERE id=$1', [
      legacy.case,
    ]);
    const guardsEnabled =
      (
        await client.query(`SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace p ON p.oid=c.relnamespace WHERE p.nspname=current_schema() AND t.tgenabled='O'
      AND t.tgname IN ('case_acceptances_immutable','case_acceptance_receipts_immutable','case_trial_round_case_guard','case_trial_round_round_guard','case_trial_rounds_immutable')`)
      ).rows[0].n === 5;
    let oldFactImmutable = false;
    try {
      await client.query(
        'UPDATE case_acceptances SET accepted_at=$2 WHERE id=$1',
        [legacy.acceptance, '2026-10-02'],
      );
    } catch (error) {
      oldFactImmutable = error.code === '23514';
    }
    const immutableQueries = [
      ['case_hearing_arrangements', 'hearing_at', legacy.hearing],
      ['case_hearing_advances', 'due_at', legacy.advance],
      ['case_judgment_facts', 'judgment_received_at', legacy.judgment],
      ['case_judgment_next_steps', 'next', legacy.choice],
      ['case_acceptance_receipts', 'result_snapshot', legacy.receipt],
      ['audit_events', 'details', legacy.audit],
    ];
    let oldChainImmutable = true;
    for (const [table, column, id] of immutableQueries) {
      try {
        await client.query(
          `UPDATE "${table}" SET "${column}"="${column}" WHERE id=$1`,
          [id],
        );
        oldChainImmutable = false;
      } catch (error) {
        if (error.code !== '23514') oldChainImmutable = false;
      }
    }
    let pointerDetachRejected = false;
    await client.query('BEGIN');
    try {
      await client.query(
        'UPDATE cases SET current_acceptance_id=NULL WHERE id=$1',
        [legacy.case],
      );
      await client.query('COMMIT');
    } catch (error) {
      pointerDetachRejected = error.code === '23514';
      await client.query('ROLLBACK');
    }
    let arbitraryRoundRejected = false;
    await client.query('BEGIN');
    try {
      await client.query(
        'INSERT INTO case_trial_rounds(id,case_id,department_id,sequence) VALUES ($1,$2,$3,2)',
        [randomUUID(), legacy.case, legacy.department],
      );
      await client.query('COMMIT');
    } catch (error) {
      arbitraryRoundRejected = error.code === '23514';
      await client.query('ROLLBACK');
    }
    await use(schemas[2]);
    await replay(client, names.slice(0, -12));
    const broken = await seedLegacyCase(client, { invalid: true });
    const guardsBeforeFailure = (
      await client.query(`SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace p ON p.oid=c.relnamespace WHERE p.nspname=current_schema() AND t.tgenabled='O'
          AND t.tgname IN ('case_acceptances_immutable','case_acceptance_receipts_immutable')`)
    ).rows[0].n;
    let invalidRejected = false;
    try {
      await client.query(sql(target));
    } catch (error) {
      invalidRejected = error.code === '23514';
      await client.query('ROLLBACK');
    }
    const atomic = (
      await client.query(
        "SELECT to_regclass('case_trial_rounds') IS NULL AS clean",
      )
    ).rows[0].clean;
    const guardsAfterFailure = (
      await client.query(`SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace p ON p.oid=c.relnamespace WHERE p.nspname=current_schema() AND t.tgenabled='O'
          AND t.tgname IN ('case_acceptances_immutable','case_acceptance_receipts_immutable')`)
    ).rows[0].n;
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(
      'UPDATE cases SET current_hearing_arrangement_id=NULL WHERE id=$1',
      [broken.case],
    );
    await client.query(
      `INSERT INTO case_acceptances(id,department_id,case_id,accepted_at,court_case_no,recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,'2026-10-01','CA010-old',$4,$5)`,
      [
        broken.acceptance,
        broken.department,
        broken.case,
        broken.actor,
        broken.audit,
      ],
    );
    await client.query('COMMIT');
    await replay(client, [target, repair, detachRepair]);
    await replay(client, secondInstanceMigrations);
    const retry = (
      await client.query(
        'SELECT current_acceptance_id=$2 AS accepted FROM cases WHERE id=$1',
        [broken.case, broken.acceptance],
      )
    ).rows[0].accepted;
    await use(schemas[3]);
    await replay(client, names.slice(0, -1));
    const before128 = (
      await client.query(
        "SELECT pg_get_functiondef('enforce_case_client_mailing_actor_path()'::regprocedure) AS body",
      )
    ).rows[0].body;
    await replay(client, [secondInstanceMigrations.at(-1)]);
    const after128 = (
      await client.query(
        "SELECT pg_get_functiondef('enforce_case_client_mailing_actor_path()'::regprocedure) AS body",
      )
    ).rows[0].body;
    const prior128Upgraded =
      !before128.includes("'SECOND_INSTANCE_DOCUMENT'") &&
      after128.includes("'SECOND_INSTANCE_DOCUMENT'") &&
      after128.includes("'SECOND_INSTANCE_SERVICE'") &&
      after128.includes("'SECOND_INSTANCE_JUDGMENT'") &&
      after128.includes("THEN 'SECOND_INSTANCE'");
    return {
      migrationCount: names.length,
      priorMigrationCount: names.length - 12,
      prior128Upgraded,
      emptyRoundTable,
      oldChainPreserved,
      combinedDetachRejected,
      combinedDetachAtomic,
      guardsEnabled,
      oldFactImmutable,
      oldChainImmutable,
      pointerDetachRejected,
      arbitraryRoundRejected,
      invalidRejected,
      atomic,
      rollbackGuardsRestored:
        guardsBeforeFailure === 2 && guardsAfterFailure === 2,
      retry,
    };
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.query('SET search_path TO public').catch(() => undefined);
    for (const schema of schemas)
      await client
        .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        .catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}
