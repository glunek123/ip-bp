import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { validateBrowserTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const { PrismaClient } = requireBackend('./dist/generated/prisma/client.js');
const { PrismaPg } = requireBackend('@prisma/adapter-pg');
const { AccessControlService } = requireBackend(
  './dist/access-control/access-control.service.js',
);
const { PrismaAccessControlStore } = requireBackend(
  './dist/access-control/prisma-access-control.store.js',
);
const { MaterialService } = requireBackend(
  './dist/modules/materials/material.service.js',
);
const { LocalPrivateBlobStorage } = requireBackend(
  './dist/modules/materials/local-private-blob-storage.js',
);
const { MaterialStorageKeyCoordinator } = requireBackend(
  './dist/modules/materials/material-storage-key-coordinator.js',
);
const { CaseJudgmentService } = requireBackend(
  './dist/modules/cases/case-judgment.service.js',
);
const { CaseHearingService } = requireBackend(
  './dist/modules/cases/case-hearing.service.js',
);
const { CaseHearingSignal } = requireBackend(
  './dist/modules/cases/case-hearing-signal.js',
);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || process.env.NODE_ENV !== 'test')
  throw new Error('Isolated test database required');
validateBrowserTestDatabaseUrl(databaseUrl, root);
const privateRoot = resolve(process.env.PRIVATE_FILE_ROOT ?? '');
if (privateRoot !== resolve(root, '.local/private-files/test'))
  throw new Error('Isolated test blob root required');

const coreJudgmentOwners = Object.freeze({
  '10000000-0000-4000-8000-000000000001': [
    [
      '20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
    ],
    [
      '20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002',
    ],
    [
      '20000000-0000-4000-8000-000000000003',
      '50000000-0000-4000-8000-000000000004',
    ],
  ],
  '10000000-0000-4000-8000-000000000002': [
    [
      '20000000-0000-4000-8000-000000000002',
      '50000000-0000-4000-8000-000000000003',
    ],
  ],
});

const judgmentCleanupGuards = [
  ['material_references', 'material_references_judgment_immutable_guard'],
  ['case_judgment_receipts', 'case_judgment_receipts_immutable'],
  ['case_judgment_versions', 'case_judgment_versions_immutable'],
  ['case_judgment_facts', 'case_judgment_facts_immutable'],
  ['audit_events', 'case_judgment_audit_immutable'],
];

// The order is shared by the canonical CA-010 fixture and core-case cleanup.
const secondInstanceDependentTables = [
  'case_execution_filing_receipts',
  'case_execution_filing_versions',
  'case_execution_filings',
  'case_execution_mailing_receipts',
  'case_execution_mailing_versions',
  'case_execution_mailings',
  'case_execution_confirmation_receipts',
  'case_execution_confirmations',
  'case_execution_submission_receipts',
  'case_execution_submission_versions',
  'case_execution_submissions',
  'case_second_instance_receipts',
  'case_second_instance_result_revocations',
  'case_second_instance_result_versions',
  'case_second_instance_results',
  'case_second_instance_progress_versions',
  'case_second_instance_progresses',
  'case_judgment_next_step_receipts',
  'case_judgment_appeal_defendants',
  'case_judgment_next_step_revocations',
  'case_judgment_next_steps',
  'case_judgment_receipts',
  'case_judgment_versions',
  'case_judgment_facts',
  'case_hearing_receipts',
  'case_hearing_corrections',
  'case_hearing_advances',
  'case_hearing_arrangements',
  'case_acceptance_receipts',
  'case_acceptance_versions',
  'case_acceptances',
];
const secondInstanceDependentActions = [
  'case.execution.filing.submitted',
  'case.execution.mailed',
  'case.execution.confirmed',
  'case.execution.submitted',
  'case.second_instance.save',
  'case.second_instance.result',
  'case.second_instance.result.revoke',
  'case.judgment.next_step',
  'case.judgment.next_step.revoke',
  'case.judgment.registered',
  'case.judgment.corrected',
  'case.hearing.scheduled',
  'case.hearing.corrected',
  'case.hearing.auto_advanced',
  'case.acceptance.registered',
];

// Call only inside a test-only transaction with LOCAL replica mode: the
// remand child round points back to its result, so the whole chain is cleared.
async function clearSecondInstanceDependentFacts(client, caseIds) {
  await client.query(
    `UPDATE cases SET stage='WAITING_FORMAL_ACCEPTANCE',
      current_trial_round_id=NULL,current_acceptance_id=NULL,
      current_hearing_arrangement_id=NULL,current_hearing_advance_id=NULL,
      current_judgment_id=NULL,current_judgment_next_step_id=NULL,
      current_second_instance_progress_id=NULL,current_second_instance_result_id=NULL,
      current_execution_submission_id=NULL,
      court_case_no=NULL WHERE id=ANY($1::uuid[])`,
    [caseIds],
  );
  await client.query(
    `DELETE FROM material_references WHERE resource_type='case'
      AND resource_id=ANY($1::uuid[]) AND action_event_id IN (
        SELECT id FROM audit_events WHERE resource_type='CASE'
          AND resource_id=ANY($1::uuid[]) AND action=ANY($2::text[]))`,
    [caseIds, secondInstanceDependentActions],
  );
  for (const table of secondInstanceDependentTables)
    await client.query(`DELETE FROM "${table}" WHERE case_id=ANY($1::uuid[])`, [
      caseIds,
    ]);
  await client.query(
    `DELETE FROM audit_events WHERE resource_type='CASE'
      AND resource_id=ANY($1::uuid[]) AND action=ANY($2::text[])`,
    [caseIds, secondInstanceDependentActions],
  );
  await client.query(
    'DELETE FROM case_trial_rounds WHERE case_id=ANY($1::uuid[])',
    [caseIds],
  );
}

async function assertSecondInstanceCleanupGuards(client) {
  const guards = [
    ['case_execution_mailings', 'case_execution_mailings_immutable'],
    ['case_execution_filings', 'case_execution_filings_immutable'],
    [
      'case_execution_mailing_versions',
      'case_execution_mailing_versions_immutable',
    ],
    [
      'case_execution_filing_versions',
      'case_execution_filing_versions_immutable',
    ],
    [
      'case_execution_mailing_receipts',
      'case_execution_mailing_receipts_immutable',
    ],
    [
      'case_execution_filing_receipts',
      'case_execution_filing_receipts_immutable',
    ],
    ['cases', 'case_trial_round_case_guard'],
    ['cases', 'cases_empty_remand_child_version_guard'],
    ['cases', 'cases_retrial_prejudgment_version_guard'],
    ['cases', 'case_execution_head_guard'],
    ['case_trial_rounds', 'case_trial_rounds_immutable'],
    ['case_execution_submissions', 'case_execution_submissions_immutable'],
    ['case_execution_confirmations', 'case_execution_confirmations_immutable'],
    [
      'case_execution_confirmation_receipts',
      'case_execution_confirmation_receipts_immutable',
    ],
    [
      'case_execution_submission_versions',
      'case_execution_submission_versions_immutable',
    ],
    [
      'case_execution_submission_receipts',
      'case_execution_submission_receipts_immutable',
    ],
    [
      'case_second_instance_progresses',
      'case_second_instance_progresses_immutable',
    ],
    ['case_second_instance_results', 'case_second_instance_results_immutable'],
    ['case_judgment_next_steps', 'case_judgment_next_steps_immutable'],
  ];
  for (const [table, trigger] of guards) {
    const rows = (
      await client.query(
        'SELECT tgenabled FROM pg_trigger WHERE tgrelid=$1::regclass AND tgname=$2',
        [table, trigger],
      )
    ).rows;
    if (rows.length !== 1 || rows[0].tgenabled !== 'O')
      throw new Error(`Second-instance cleanup guard unavailable: ${trigger}`);
  }
}

/** Clear CA-010/CA-011 facts on exact core-fixture cases, before legacy cleanup. */
export async function clearCoreCaseSecondInstanceFixture() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const context = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema',
      )
    ).rows[0];
    if (context.db !== 'dev_cor_test' || context.schema !== 'public')
      throw new Error(
        'Second-instance cleanup requires isolated public test schema',
      );
    await client.query('BEGIN');
    try {
      await assertSecondInstanceCleanupGuards(client);
      const cases = (
        await client.query(
          `SELECT c.id,c.department_id,c.responsible_user_id,c.customer_id,
              c.current_execution_submission_id,
              EXISTS (SELECT 1 FROM case_execution_submissions s
                WHERE s.id=c.current_execution_submission_id AND s.case_id=c.id)
                AS has_current_execution_submission
            FROM cases c JOIN leads l ON l.id=c.source_lead_id
            WHERE c.department_id=$1 AND c.responsible_user_id=$2
              AND c.customer_id=$3 AND l.shop_name LIKE '确认诉状店铺-%'
              AND (EXISTS (SELECT 1 FROM case_second_instance_progresses p WHERE p.case_id=c.id)
                OR EXISTS (SELECT 1 FROM case_second_instance_results r WHERE r.case_id=c.id)
                OR EXISTS (SELECT 1 FROM case_second_instance_receipts q WHERE q.case_id=c.id)
                OR EXISTS (SELECT 1 FROM case_execution_submissions s WHERE s.case_id=c.id)
                OR EXISTS (SELECT 1 FROM case_execution_submission_receipts r WHERE r.case_id=c.id)
                OR EXISTS (SELECT 1 FROM case_execution_confirmations f WHERE f.case_id=c.id)
                OR EXISTS (SELECT 1 FROM case_execution_confirmation_receipts r WHERE r.case_id=c.id)
                OR c.current_execution_submission_id IS NOT NULL)
            ORDER BY c.id FOR UPDATE OF c`,
          [
            '10000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000001',
            '50000000-0000-4000-8000-000000000002',
          ],
        )
      ).rows;
      if (
        cases.some(
          (row) =>
            row.current_execution_submission_id !== null &&
            !row.has_current_execution_submission,
        )
      )
        throw new Error(
          'Second-instance cleanup found an execution pointer without its fact',
        );
      const caseIds = cases.map((row) => row.id);
      if (caseIds.length > 0) {
        await client.query('SET LOCAL session_replication_role = replica');
        await clearSecondInstanceDependentFacts(client, caseIds);
      }
      await client.query('COMMIT');
      const role = (await client.query('SHOW session_replication_role')).rows[0]
        .session_replication_role;
      if (role !== 'origin')
        throw new Error(
          'Second-instance cleanup trigger mode was not restored',
        );
      await assertSecondInstanceCleanupGuards(client);
      return caseIds;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    await client.end();
  }
}

async function assertJudgmentCleanupGuards(client) {
  for (const [table, trigger] of judgmentCleanupGuards) {
    const rows = (
      await client.query(
        'SELECT tgenabled FROM pg_trigger WHERE tgrelid=$1::regclass AND tgname=$2 AND NOT tgisinternal',
        [table, trigger],
      )
    ).rows;
    if (rows.length !== 1 || rows[0].tgenabled !== 'O')
      throw new Error(`Judgment cleanup guard unavailable: ${trigger}`);
  }
}

/** Remove only judgment chains of the fixed core-lead fixture owners. */
export async function clearCoreCaseJudgmentFixture(departmentIds) {
  if (
    !Array.isArray(departmentIds) ||
    departmentIds.length < 1 ||
    new Set(departmentIds).size !== departmentIds.length ||
    departmentIds.some((id) => !Object.hasOwn(coreJudgmentOwners, id))
  )
    throw new Error('Unexpected judgment cleanup departments');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const context = (
      await client.query(
        'SELECT current_database() AS db, current_schema() AS schema',
      )
    ).rows[0];
    if (context.db !== 'dev_cor_test' || context.schema !== 'public')
      throw new Error('Judgment cleanup requires isolated public test schema');
    await client.query('BEGIN');
    try {
      await assertJudgmentCleanupGuards(client);
      const cases = (
        await client.query(
          `SELECT c.id,c.department_id,c.responsible_user_id,c.customer_id
             FROM cases c WHERE c.department_id=ANY($1::uuid[])
               AND (c.current_judgment_id IS NOT NULL
                 OR EXISTS (SELECT 1 FROM case_judgment_facts f WHERE f.case_id=c.id)
                 OR EXISTS (SELECT 1 FROM case_judgment_receipts r WHERE r.case_id=c.id)
                 OR EXISTS (SELECT 1 FROM material_references m WHERE m.resource_type='case'
                   AND m.resource_id=c.id AND m.purpose='JUDGMENT')
                 OR EXISTS (SELECT 1 FROM audit_events a WHERE a.resource_type='CASE'
                   AND a.resource_id=c.id AND a.action IN ('case.judgment.registered','case.judgment.corrected')))
             ORDER BY c.id FOR UPDATE OF c`,
          [departmentIds],
        )
      ).rows;
      for (const row of cases) {
        const allowed = coreJudgmentOwners[row.department_id].some(
          ([owner, customer]) =>
            row.responsible_user_id === owner && row.customer_id === customer,
        );
        if (!allowed)
          throw new Error('Judgment cleanup found a non-fixture case owner');
      }
      const caseIds = cases.map((row) => row.id);
      if (caseIds.length > 0) {
        const facts = (
          await client.query(
            'SELECT id,audit_event_id FROM case_judgment_facts WHERE case_id=ANY($1::uuid[]) ORDER BY to_version DESC',
            [caseIds],
          )
        ).rows;
        const auditIds = facts.map((row) => row.audit_event_id);
        const unexpected = (
          await client.query(
            `SELECT EXISTS (
              SELECT 1 FROM case_judgment_facts f
                JOIN cases c ON c.id=f.case_id
                LEFT JOIN audit_events a ON a.id=f.audit_event_id
                WHERE f.case_id=ANY($1::uuid[])
                  AND (f.department_id<>c.department_id
                    OR a.id IS NULL OR a.department_id<>f.department_id
                    OR a.resource_type<>'CASE' OR a.resource_id<>f.case_id
                    OR a.action<>CASE WHEN f.kind='REGISTER'
                      THEN 'case.judgment.registered' ELSE 'case.judgment.corrected' END)
              UNION ALL SELECT 1 FROM material_references m
                JOIN cases c ON c.id=m.resource_id
                WHERE m.resource_type='case' AND m.resource_id=ANY($1::uuid[])
                  AND m.purpose='JUDGMENT'
                  AND (m.department_id<>c.department_id
                    OR m.action_event_id IS NULL
                    OR NOT (m.action_event_id=ANY($2::uuid[])))
              UNION ALL SELECT 1 FROM audit_events a WHERE a.resource_type='CASE'
                AND a.resource_id=ANY($1::uuid[])
                AND a.action IN ('case.judgment.registered','case.judgment.corrected')
                AND NOT (a.id=ANY($2::uuid[]))
            ) AS present`,
            [caseIds, auditIds],
          )
        ).rows[0].present;
        if (unexpected)
          throw new Error('Judgment cleanup found an unbound judgment event');
        await client.query(
          'UPDATE cases SET current_judgment_id=NULL WHERE id=ANY($1::uuid[]) AND current_judgment_id IS NOT NULL',
          [caseIds],
        );
        for (const [table, trigger] of judgmentCleanupGuards)
          await client.query(
            `ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`,
          );
        await client.query(
          "DELETE FROM material_references WHERE resource_type='case' AND purpose='JUDGMENT' AND resource_id=ANY($1::uuid[]) AND action_event_id=ANY($2::uuid[])",
          [caseIds, auditIds],
        );
        await client.query(
          'DELETE FROM case_judgment_receipts WHERE case_id=ANY($1::uuid[])',
          [caseIds],
        );
        await client.query(
          'DELETE FROM case_judgment_versions WHERE case_id=ANY($1::uuid[])',
          [caseIds],
        );
        for (const fact of facts)
          await client.query('DELETE FROM case_judgment_facts WHERE id=$1', [
            fact.id,
          ]);
        await client.query(
          'DELETE FROM audit_events WHERE id=ANY($1::uuid[])',
          [auditIds],
        );
        for (const [table, trigger] of [...judgmentCleanupGuards].reverse())
          await client.query(
            `ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`,
          );
      }
      await assertJudgmentCleanupGuards(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    await client.end();
  }
}

export async function verifyCoreCaseJudgmentFixtureCleanup(
  coreLeadFixtures,
  resetCoreLeadE2eData,
) {
  const client = new Client({ connectionString: databaseUrl });
  const target = {
    case: randomUUID(),
    trialRound: randomUUID(),
    acceptance: randomUUID(),
    fact: randomUUID(),
    audit: randomUUID(),
    receipt: randomUUID(),
    reference: randomUUID(),
    material: randomUUID(),
    version: randomUUID(),
  };
  const other = {
    department: randomUUID(),
    actor: randomUUID(),
    customer: randomUUID(),
    holder: randomUUID(),
    case: randomUUID(),
    trialRound: randomUUID(),
    acceptance: randomUUID(),
    fact: randomUUID(),
    audit: randomUUID(),
    receipt: randomUUID(),
    reference: randomUUID(),
    material: randomUUID(),
    version: randomUUID(),
  };
  const unknown = {
    case: randomUUID(),
    fact: randomUUID(),
    audit: randomUUID(),
    receipt: randomUUID(),
    reference: randomUUID(),
  };
  const fault = `ca008_cleanup_fault_${randomUUID().replaceAll('-', '')}`;
  let faultInstalled = false;
  await client.connect();
  const role = async () =>
    (await client.query('SHOW session_replication_role')).rows[0]
      .session_replication_role;
  const counts = async (fixture) => {
    const result = await client.query(
      `SELECT
        (SELECT COUNT(*) FROM cases WHERE id=$1)::int AS cases,
        (SELECT COUNT(*) FROM case_judgment_facts WHERE id=$2)::int AS facts,
        (SELECT COUNT(*) FROM case_judgment_versions WHERE fact_id=$2)::int AS versions,
        (SELECT COUNT(*) FROM case_judgment_receipts WHERE id=$3)::int AS receipts,
        (SELECT COUNT(*) FROM material_references WHERE id=$4)::int AS refs,
        (SELECT COUNT(*) FROM audit_events WHERE id=$5)::int AS audits,
        (SELECT COUNT(*) FROM cases WHERE id=$1 AND current_judgment_id=$2)::int AS pointers`,
      [
        fixture.case,
        fixture.fact,
        fixture.receipt,
        fixture.reference,
        fixture.audit,
      ],
    );
    return result.rows[0];
  };
  try {
    const context = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema',
      )
    ).rows[0];
    if (
      context.db !== 'dev_cor_test' ||
      context.schema !== 'public' ||
      (await role()) !== 'origin'
    )
      throw new Error(
        'Cleanup fixture requires isolated public database and origin role',
      );
    await resetCoreLeadE2eData();
    const owner = (
      await client.query(
        `SELECT
          EXISTS(SELECT 1 FROM departments WHERE id=$1) AND
          EXISTS(SELECT 1 FROM user_accounts WHERE id=$2) AND
          EXISTS(SELECT 1 FROM customers WHERE id=$3) AND
          EXISTS(SELECT 1 FROM rights_holders WHERE id=$4) AS present`,
        [
          coreLeadFixtures.departmentA,
          coreLeadFixtures.userA,
          coreLeadFixtures.admittedCustomer,
          coreLeadFixtures.holder,
        ],
      )
    ).rows[0].present;
    if (!owner)
      throw new Error('Core-lead fixture must be seeded before cleanup test');
    await client.query('BEGIN');
    try {
      await client.query(
        'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
        [other.department, 'CA008 cleanup other department'],
      );
      await client.query(
        'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
        [other.actor, `ca008-cleanup-${other.actor}`, 'CA008 other actor'],
      );
      await client.query(
        'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES (gen_random_uuid(),$1,$2,now())',
        [other.actor, other.department],
      );
      await client.query(
        'INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at) VALUES ($1,$2,$2,$3,$4,now())',
        [other.customer, 'CA008 other customer', other.department, other.actor],
      );
      await client.query(
        'INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,$2,$3,now())',
        [other.holder, 'CA008 other holder', other.department],
      );
      await client.query('SET LOCAL session_replication_role = replica');
      for (const [fixture, department] of [
        [target, coreLeadFixtures.departmentA],
        [other, other.department],
      ]) {
        const actorId =
          fixture === other ? other.actor : coreLeadFixtures.userA;
        const customerId =
          fixture === other
            ? other.customer
            : coreLeadFixtures.admittedCustomer;
        const holderId =
          fixture === other ? other.holder : coreLeadFixtures.holder;
        await client.query(
          `INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at,complaint_amount_state,complaint_amount,complaint_submitted_at,complaint_submitted_by_user_id,court_case_no,current_judgment_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_JUDGMENT',2,now(),'KNOWN',100,now(),$9,'CA008-cleanup',$10)`,
          [
            fixture.case,
            `CA008-cleanup-${fixture.case}`,
            department,
            randomUUID(),
            randomUUID(),
            randomUUID(),
            customerId,
            holderId,
            actorId,
            fixture.fact,
          ],
        );
        await client.query(
          `INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action,details)
           VALUES ($1,$2,$3,$3,'CASE',$4,'case.judgment.registered','{}'::jsonb)`,
          [fixture.audit, department, actorId, fixture.case],
        );
        await client.query(
          'INSERT INTO case_trial_rounds(id,case_id,department_id,sequence) VALUES ($1,$2,$3,1)',
          [fixture.trialRound, fixture.case, department],
        );
        await client.query(
          "INSERT INTO case_acceptances(id,case_id,department_id,trial_round_id,accepted_at,court_case_no,recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,$4,'2026-10-01','CA008-cleanup',$5,$6)",
          [
            fixture.acceptance,
            fixture.case,
            department,
            fixture.trialRound,
            actorId,
            randomUUID(),
          ],
        );
        await client.query(
          `INSERT INTO case_judgment_facts(id,department_id,case_id,trial_round_id,kind,judgment_received_at,judgment_amount_state,judgment_amount,paid_litigation_fee_state,recorded_by_user_id,from_version,to_version,audit_event_id)
           VALUES ($1,$2,$3,$6,'REGISTER','2026-10-08','KNOWN',0,'PENDING',$4,1,2,$5)`,
          [
            fixture.fact,
            department,
            fixture.case,
            actorId,
            fixture.audit,
            fixture.trialRound,
          ],
        );
        await client.query(
          'UPDATE cases SET current_trial_round_id=$2,current_acceptance_id=$3 WHERE id=$1',
          [fixture.case, fixture.trialRound, fixture.acceptance],
        );
        await client.query(
          `INSERT INTO case_judgment_versions(fact_id,case_id,department_id,material_id,content_version_id)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            fixture.fact,
            fixture.case,
            department,
            fixture.material,
            fixture.version,
          ],
        );
        await client.query(
          `INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,material_id,content_version_id,action_event_id)
           VALUES ($1,$2,'case',$3,'JUDGMENT',$4,$5,$6)`,
          [
            fixture.reference,
            department,
            fixture.case,
            fixture.material,
            fixture.version,
            fixture.audit,
          ],
        );
        await client.query(
          `INSERT INTO case_judgment_receipts(id,department_id,actor_user_id,case_id,action,idempotency_key,request_fingerprint,result_snapshot)
           VALUES ($1,$2,$3,$4,'REGISTER',$5,$6,$7::jsonb)`,
          [
            fixture.receipt,
            department,
            actorId,
            fixture.case,
            `cleanup-${fixture.case}`,
            'a'.repeat(64),
            JSON.stringify({ judgmentId: fixture.fact }),
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
    if ((await role()) !== 'origin')
      throw new Error('Synthetic cleanup fixture did not restore origin role');
    const before = await counts(target);
    await client.query(
      `CREATE FUNCTION "${fault}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'cleanup injected fault' USING ERRCODE='23514'; END $$`,
    );
    faultInstalled = true;
    await client.query(
      `CREATE TRIGGER "${fault}" BEFORE DELETE ON case_judgment_facts FOR EACH ROW EXECUTE FUNCTION "${fault}"()`,
    );
    let faultRejected = false;
    try {
      await clearCoreCaseJudgmentFixture([
        coreLeadFixtures.departmentA,
        coreLeadFixtures.departmentB,
      ]);
    } catch (error) {
      faultRejected =
        error.code === '23514' &&
        error.message.includes('cleanup injected fault');
    }
    const rollbackPreserved =
      JSON.stringify(await counts(target)) === JSON.stringify(before);
    await assertJudgmentCleanupGuards(client);
    const guardsRestored = true;
    await client.query(`DROP TRIGGER "${fault}" ON case_judgment_facts`);
    await client.query(`DROP FUNCTION "${fault}"()`);
    faultInstalled = false;
    await resetCoreLeadE2eData();
    const after = await counts(target);
    const sentinel = await counts(other);
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL session_replication_role = replica');
      await client.query(
        `INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at,complaint_amount_state,complaint_amount,complaint_submitted_at,complaint_submitted_by_user_id,court_case_no,current_judgment_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_JUDGMENT',2,now(),'KNOWN',100,now(),$9,'CA008-unknown',$10)`,
        [
          unknown.case,
          `CA008-unknown-${unknown.case}`,
          coreLeadFixtures.departmentA,
          randomUUID(),
          randomUUID(),
          randomUUID(),
          other.customer,
          other.holder,
          other.actor,
          unknown.fact,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
    let unknownOwnerRejected = false;
    try {
      await clearCoreCaseJudgmentFixture([coreLeadFixtures.departmentA]);
    } catch (error) {
      unknownOwnerRejected = error.message.includes('non-fixture case owner');
    }
    await client.query('BEGIN');
    let disabledGuardRejected = false;
    try {
      await client.query(
        'ALTER TABLE material_references DISABLE TRIGGER "material_references_judgment_immutable_guard"',
      );
      try {
        await assertJudgmentCleanupGuards(client);
      } catch (error) {
        disabledGuardRejected = error.message.includes(
          'material_references_judgment_immutable_guard',
        );
      }
    } finally {
      await client.query('ROLLBACK');
    }
    await assertJudgmentCleanupGuards(client);
    return {
      faultRejected,
      rollbackPreserved,
      guardsRestored,
      targetRemoved: Object.values(after).every((value) => value === 0),
      otherDepartmentPreserved: Object.values(sentinel).every(
        (value) => value === 1,
      ),
      unknownOwnerRejected,
      unknownOwnerPreserved: (await counts(unknown)).cases === 1,
      disabledGuardRejected,
      replicationRoleRestored: (await role()) === 'origin',
    };
  } finally {
    if (faultInstalled) {
      await client
        .query(`DROP TRIGGER IF EXISTS "${fault}" ON case_judgment_facts`)
        .catch(() => undefined);
      await client
        .query(`DROP FUNCTION IF EXISTS "${fault}"()`)
        .catch(() => undefined);
    }
    await client.query('BEGIN').catch(() => undefined);
    let cleanupCommitted = false;
    try {
      await client.query('SET LOCAL session_replication_role = replica');
      for (const fixture of [target, other, unknown]) {
        await client.query('DELETE FROM material_references WHERE id=$1', [
          fixture.reference,
        ]);
        await client.query('DELETE FROM case_judgment_receipts WHERE id=$1', [
          fixture.receipt,
        ]);
        await client.query(
          'DELETE FROM case_judgment_versions WHERE fact_id=$1',
          [fixture.fact],
        );
        await client.query('DELETE FROM case_judgment_facts WHERE id=$1', [
          fixture.fact,
        ]);
        await client.query('DELETE FROM audit_events WHERE id=$1', [
          fixture.audit,
        ]);
        await client.query('DELETE FROM cases WHERE id=$1', [fixture.case]);
        if (fixture.acceptance)
          await client.query('DELETE FROM case_acceptances WHERE id=$1', [
            fixture.acceptance,
          ]);
        if (fixture.trialRound)
          await client.query('DELETE FROM case_trial_rounds WHERE id=$1', [
            fixture.trialRound,
          ]);
      }
      await client.query('DELETE FROM customers WHERE id=$1', [other.customer]);
      await client.query('DELETE FROM rights_holders WHERE id=$1', [
        other.holder,
      ]);
      await client.query(
        'DELETE FROM department_memberships WHERE user_id=$1 AND department_id=$2',
        [other.actor, other.department],
      );
      await client.query('DELETE FROM user_accounts WHERE id=$1', [
        other.actor,
      ]);
      await client.query('DELETE FROM departments WHERE id=$1', [
        other.department,
      ]);
      await client.query('COMMIT');
      cleanupCommitted = true;
    } finally {
      if (!cleanupCommitted)
        await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  }
}

export async function verifyCaseJudgmentDatabase(options = {}) {
  const client = new Client({ connectionString: databaseUrl });
  const database = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  const storage = new LocalPrivateBlobStorage(privateRoot);
  const ids = {
    department: randomUUID(),
    actor: randomUUID(),
    role: randomUUID(),
    customer: randomUUID(),
    holder: randomUUID(),
    case: randomUUID(),
    trialRound: randomUUID(),
    acceptance: randomUUID(),
    arrangement: randomUUID(),
    advance: randomUUID(),
  };
  const actor = {
    userId: ids.actor,
    departmentId: ids.department,
    authorizationRevision: 1,
  };
  const keys = [];
  const extraUserIds = [];
  const fault = `ca008_fault_${randomUUID().replaceAll('-', '')}`;
  let faultInstalled = false;
  await client.connect();
  try {
    const location = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema',
      )
    ).rows[0];
    if (location.db !== 'dev_cor_test' || location.schema !== 'public')
      throw new Error('Judgment test requires isolated public schema');
    await client.query(
      'INSERT INTO departments(id,name,updated_at) VALUES ($1,$2,now())',
      [ids.department, 'CA008 database test'],
    );
    await client.query(
      'INSERT INTO user_accounts(id,external_subject,display_name,updated_at) VALUES ($1,$2,$3,now())',
      [ids.actor, `ca008-${ids.actor}`, 'CA008 actor'],
    );
    await client.query(
      'INSERT INTO department_memberships(id,user_id,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [randomUUID(), ids.actor, ids.department],
    );
    await client.query(
      'INSERT INTO customers(id,name,normalized_name,department_id,responsible_user_id,updated_at) VALUES ($1,$2,$3,$4,$5,now())',
      [
        ids.customer,
        'CA008 judgment test customer',
        'ca008 judgment test customer',
        ids.department,
        ids.actor,
      ],
    );
    await client.query(
      'INSERT INTO rights_holders(id,name,department_id,updated_at) VALUES ($1,$2,$3,now())',
      [ids.holder, 'CA008 rights holder', ids.department],
    );
    await client.query(
      'INSERT INTO role_templates(id,department_id,name,updated_at) VALUES ($1,$2,$3,now())',
      [ids.role, ids.department, 'CA008 test role'],
    );
    for (const action of [
      'case.read',
      'case.judgment.register',
      'case.judgment.correct',
      'case.hearing.correct',
    ])
      await client.query(
        'INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,$3,$4)',
        [randomUUID(), ids.role, action, 'DEPARTMENT'],
      );
    await client.query(
      'INSERT INTO role_assignments(id,user_id,department_id,role_template_id,active,updated_at) VALUES ($1,$2,$3,$4,true,now())',
      [randomUUID(), ids.actor, ids.department, ids.role],
    );
    await client.query('SET session_replication_role = replica');
    try {
      await client.query(
        "INSERT INTO cases(id,business_no,department_id,source_lead_id,source_notary_matter_id,certificate_id,customer_id,rights_holder_id,responsible_user_id,stage,version,matched_at,complaint_amount_state,complaint_amount,complaint_submitted_at,complaint_submitted_by_user_id,court_case_no,current_hearing_arrangement_id,current_hearing_advance_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'WAITING_JUDGMENT',9,now(),'KNOWN',100,now(),$9,'CA008-db',$10,$11)",
        [
          ids.case,
          `CA008-${ids.case}`,
          ids.department,
          randomUUID(),
          randomUUID(),
          randomUUID(),
          ids.customer,
          ids.holder,
          ids.actor,
          ids.arrangement,
          ids.advance,
        ],
      );
      await client.query(
        'INSERT INTO case_trial_rounds(id,case_id,department_id,sequence) VALUES ($1,$2,$3,1)',
        [ids.trialRound, ids.case, ids.department],
      );
      await client.query(
        "INSERT INTO case_acceptances(id,department_id,case_id,trial_round_id,accepted_at,court_case_no,recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,$4,'2026-10-01','CA008-db',$5,$6)",
        [
          ids.acceptance,
          ids.department,
          ids.case,
          ids.trialRound,
          ids.actor,
          randomUUID(),
        ],
      );
      await client.query(
        "INSERT INTO case_hearing_arrangements(id,department_id,case_id,trial_round_id,hearing_at,source,recorded_by_user_id,from_version,to_version,audit_event_id) VALUES ($1,$2,$3,$4,'2026-10-02','SCHEDULE',$5,7,8,$6)",
        [
          ids.arrangement,
          ids.department,
          ids.case,
          ids.trialRound,
          ids.actor,
          randomUUID(),
        ],
      );
      await client.query(
        "INSERT INTO case_hearing_advances(id,department_id,case_id,trial_round_id,arrangement_id,due_at,executed_at,from_version,to_version,audit_event_id) VALUES ($1,$2,$3,$4,$5,'2026-10-02T16:00:00Z','2026-10-02T16:00:01Z',8,9,$6)",
        [
          ids.advance,
          ids.department,
          ids.case,
          ids.trialRound,
          ids.arrangement,
          randomUUID(),
        ],
      );
      await client.query(
        'UPDATE cases SET current_trial_round_id=$2,current_acceptance_id=$3 WHERE id=$1',
        [ids.case, ids.trialRound, ids.acceptance],
      );
    } finally {
      await client.query('SET session_replication_role = origin');
    }
    const access = new AccessControlService(
      new PrismaAccessControlStore(database),
    );
    const materials = new MaterialService(
      database,
      access,
      storage,
      new MaterialStorageKeyCoordinator(),
    );
    const judgment = new CaseJudgmentService(database, access, materials);
    const hearing = new CaseHearingService(
      database,
      access,
      new CaseHearingSignal(),
      { now: () => new Date('2026-10-08T10:00:00.000Z') },
    );
    const bytes = Buffer.from(
      '%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\nCA008 registered bytes\n%%EOF\n',
    );
    const draft = await materials.createUploadDraft(actor, {
      ownerType: 'CASE',
      ownerId: ids.case,
      category: 'JUDGMENT',
      purpose: 'JUDGMENT',
      originalFilename: 'judgment.pdf',
      declaredMimeType: 'application/pdf',
    });
    const uploaded = await materials.finalizeUpload(
      actor,
      draft.id,
      Readable.from(bytes),
    );
    const storageRow = await database.contentVersion.findUnique({
      where: { id: uploaded.contentVersionId },
      select: { storageKey: true },
    });
    keys.push(storageRow.storageKey);
    const registeredFiles = [{ ...uploaded, bytes }];
    for (let index = 1; index < 10; index += 1) {
      const fileBytes = Buffer.from(
        `%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\nCA008 registered file ${index}\n%%EOF\n`,
      );
      const fileDraft = await materials.createUploadDraft(actor, {
        ownerType: 'CASE',
        ownerId: ids.case,
        category: 'JUDGMENT',
        purpose: 'JUDGMENT',
        originalFilename: `judgment-${index}.pdf`,
        declaredMimeType: 'application/pdf',
      });
      const file = await materials.finalizeUpload(
        actor,
        fileDraft.id,
        Readable.from(fileBytes),
      );
      const stored = await database.contentVersion.findUnique({
        where: { id: file.contentVersionId },
        select: { storageKey: true },
      });
      keys.push(stored.storageKey);
      registeredFiles.push({ ...file, bytes: fileBytes });
    }
    const input = {
      expectedVersion: 9,
      idempotencyKey: `register-${ids.case}`,
      judgmentReceivedAt: '2026-10-08',
      judgmentAmountState: 'KNOWN',
      judgmentAmount: '0',
      paidLitigationFeeState: 'PENDING',
      paidLitigationFee: null,
      judgmentContentVersionIds: registeredFiles.map(
        (file) => file.contentVersionId,
      ),
    };
    const result = await judgment.register(actor, ids.case, input);
    if (options.afterRegistration) {
      return await options.afterRegistration({
        actor,
        roleId: ids.role,
        caseId: ids.case,
        judgmentId: result.judgmentId,
        judgment,
        materials,
        storage,
        database,
        client,
        registeredFiles,
        registrationInput: input,
        trackStorageKey: (key) => keys.push(key),
        trackExtraUserId: (id) => extraUserIds.push(id),
      });
    }
    const snapshot = {
      case: await database.case.findUnique({
        where: { id: ids.case },
        select: { stage: true, version: true, currentJudgmentId: true },
      }),
      judgmentFacts: await database.caseJudgmentFact.findMany({
        where: { caseId: ids.case },
      }),
      hearingAdvances: await database.caseHearingAdvance.findMany({
        where: { caseId: ids.case },
      }),
      versions: await database.caseJudgmentVersion.findMany({
        where: { caseId: ids.case },
      }),
      references: await database.materialReference.findMany({
        where: { resourceId: ids.case, purpose: 'JUDGMENT' },
      }),
    };
    const opened = await materials.openVersion(
      actor,
      uploaded.materialId,
      uploaded.contentVersionId,
    );
    const downloaded = Buffer.concat(await Array.fromAsync(opened.stream));
    const replay = await judgment.register(actor, ids.case, input);
    let hearingBlocked = null;
    try {
      await hearing.correct(actor, ids.case, {
        expectedVersion: 10,
        idempotencyKey: 'after-judgment',
        hearingAt: '2026-10-02',
        reason: '尝试更正',
      });
    } catch (error) {
      hearingBlocked = error.response?.code ?? null;
    }
    let stale = null;
    try {
      await judgment.correct(actor, ids.case, {
        ...input,
        idempotencyKey: 'stale',
        reason: '误录更正',
      });
    } catch (error) {
      stale = error.response?.code ?? null;
    }
    let noFile = null;
    try {
      await judgment.correct(actor, ids.case, {
        ...input,
        expectedVersion: 10,
        idempotencyKey: 'no-file',
        reason: '误录更正',
        judgmentContentVersionIds: [],
      });
    } catch (error) {
      noFile = error.response?.code ?? null;
    }
    await client.query(
      `CREATE FUNCTION "${fault}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected judgment receipt failure'; END $$`,
    );
    await client.query(
      `CREATE TRIGGER "${fault}" BEFORE INSERT ON case_judgment_receipts FOR EACH ROW EXECUTE FUNCTION "${fault}"()`,
    );
    faultInstalled = true;
    const beforeFault = await database.caseJudgmentFact.count({
      where: { caseId: ids.case },
    });
    let faultRaised = false;
    const correction = {
      ...input,
      expectedVersion: 10,
      idempotencyKey: 'correct-after-fault',
      judgmentAmountState: 'PENDING',
      judgmentAmount: null,
      paidLitigationFeeState: 'KNOWN',
      paidLitigationFee: '12.34',
      reason: '判决金额录入有误',
    };
    try {
      await judgment.correct(actor, ids.case, correction);
    } catch (error) {
      faultRaised = String(error.message).includes(
        'injected judgment receipt failure',
      );
      if (!faultRaised) throw error;
    }
    if (!faultRaised)
      throw new Error('Injected receipt failure did not reject correction');
    const rollbackFacts = await database.caseJudgmentFact.count({
      where: { caseId: ids.case },
    });
    const rollbackCase = await database.case.findUnique({
      where: { id: ids.case },
      select: { version: true, currentJudgmentId: true },
    });
    await client.query(`DROP TRIGGER "${fault}" ON case_judgment_receipts`);
    await client.query(`DROP FUNCTION "${fault}"()`);
    faultInstalled = false;
    const corrected = await judgment.correct(actor, ids.case, correction);
    const history = await database.caseJudgmentFact.findMany({
      where: { caseId: ids.case },
      orderBy: { toVersion: 'asc' },
    });
    const extraDraft = await materials.createUploadDraft(actor, {
      ownerType: 'CASE',
      ownerId: ids.case,
      category: 'JUDGMENT',
      purpose: 'JUDGMENT',
      originalFilename: 'extra-judgment.pdf',
      declaredMimeType: 'application/pdf',
    });
    const extraUploaded = await materials.finalizeUpload(
      actor,
      extraDraft.id,
      Readable.from(bytes),
    );
    const extraStorageRow = await database.contentVersion.findUnique({
      where: { id: extraUploaded.contentVersionId },
      select: { storageKey: true },
    });
    keys.push(extraStorageRow.storageKey);
    const referenceSql =
      'INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,material_id,content_version_id,action_event_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)';
    const referenceArgs = [
      ids.department,
      'case',
      ids.case,
      'JUDGMENT',
      uploaded.materialId,
      uploaded.contentVersionId,
    ];
    const nullEvent = await code(client, referenceSql, [
      randomUUID(),
      ...referenceArgs,
      null,
    ]);
    const sameEvent = await code(client, referenceSql, [
      randomUUID(),
      ...referenceArgs,
      history[0].auditEventId,
    ]);
    const extraReferenceArgs = [
      ids.department,
      'case',
      ids.case,
      'JUDGMENT',
      extraUploaded.materialId,
      extraUploaded.contentVersionId,
    ];
    const extraSameEvent = await code(client, referenceSql, [
      randomUUID(),
      ...extraReferenceArgs,
      history[0].auditEventId,
    ]);
    const fakeEvent = await database.auditEvent.create({
      data: {
        departmentId: ids.department,
        actorUserId: ids.actor,
        internalActorUserId: ids.actor,
        resourceType: 'CASE',
        resourceId: ids.case,
        action: 'case.judgment.registered',
        details: {},
      },
      select: { id: true },
    });
    const unmatchedFactEvent = await code(client, referenceSql, [
      randomUUID(),
      ...extraReferenceArgs,
      fakeEvent.id,
    ]);
    const originalReferenceSetPreserved =
      (await database.materialReference.count({
        where: { actionEventId: history[0].auditEventId, purpose: 'JUDGMENT' },
      })) === 10;
    const nonJudgmentArgs = [
      ids.department,
      'case',
      ids.case,
      'ACCEPTANCE_NOTICE',
      uploaded.materialId,
      uploaded.contentVersionId,
      history[0].auditEventId,
    ];
    const nonJudgmentFirst = await code(client, referenceSql, [
      randomUUID(),
      ...nonJudgmentArgs,
    ]);
    const nonJudgmentDuplicate = await code(client, referenceSql, [
      randomUUID(),
      ...nonJudgmentArgs,
    ]);
    const updateOtherPurposeReference = await code(
      client,
      "UPDATE material_references SET content_version_id=content_version_id WHERE resource_id=$1 AND purpose='ACCEPTANCE_NOTICE'",
      [ids.case],
    );
    const reusedVersionAcrossFacts = await database.materialReference.count({
      where: {
        resourceId: ids.case,
        purpose: 'JUDGMENT',
        contentVersionId: uploaded.contentVersionId,
      },
    });
    const frozenReference = snapshot.references[0];
    const changeFrozenReference = await code(
      client,
      'UPDATE material_references SET content_version_id=content_version_id WHERE id=$1',
      [frozenReference.id],
    );
    const deleteFrozenReference = await code(
      client,
      'DELETE FROM material_references WHERE id=$1',
      [frozenReference.id],
    );
    const deleteOtherPurposeReference = await code(
      client,
      "DELETE FROM material_references WHERE resource_id=$1 AND purpose='ACCEPTANCE_NOTICE'",
      [ids.case],
    );
    const preservedFrozenReference =
      (await database.materialReference.count({
        where: { id: frozenReference.id },
      })) === 1;
    const immutableFact = await code(
      client,
      'UPDATE case_judgment_facts SET reason=$2 WHERE id=$1',
      [result.judgmentId, 'tamper'],
    );
    const reverseStage = await code(
      client,
      "UPDATE cases SET stage='WAITING_HEARING' WHERE id=$1",
      [ids.case],
    );
    const concurrent = await Promise.allSettled(
      ['A', 'B'].map((label) =>
        judgment.correct(actor, ids.case, {
          ...correction,
          expectedVersion: 11,
          idempotencyKey: `race-${label}`,
          reason: `并发更正${label}`,
        }),
      ),
    );
    const concurrentResults = concurrent
      .map((item) =>
        item.status === 'fulfilled'
          ? `OK:${item.value.version}`
          : (item.reason.response?.code ?? 'UNKNOWN'),
      )
      .sort();
    const afterRace = await database.caseJudgmentFact.count({
      where: { caseId: ids.case },
    });
    let elevenSelected = null;
    try {
      await judgment.correct(actor, ids.case, {
        ...correction,
        expectedVersion: 12,
        idempotencyKey: 'eleven-selected',
        judgmentContentVersionIds: [
          ...registeredFiles.map((file) => file.contentVersionId),
          extraUploaded.contentVersionId,
        ],
      });
    } catch (error) {
      elevenSelected = error.response?.code ?? null;
    }
    const replacement = await judgment.correct(actor, ids.case, {
      ...correction,
      expectedVersion: 12,
      idempotencyKey: 'replace-one-of-ten',
      judgmentContentVersionIds: [
        ...registeredFiles.slice(0, 9).map((file) => file.contentVersionId),
        extraUploaded.contentVersionId,
      ],
    });
    const originalReferencesAfterReplacement =
      await database.materialReference.count({
        where: { actionEventId: history[0].auditEventId, purpose: 'JUDGMENT' },
      });
    let originalBytesPreserved = true;
    for (const file of registeredFiles) {
      const openedOriginal = await materials.openVersion(
        actor,
        file.materialId,
        file.contentVersionId,
      );
      const actual = Buffer.concat(
        await Array.fromAsync(openedOriginal.stream),
      );
      originalBytesPreserved &&= actual.equals(file.bytes);
    }
    for (let index = 0; index < 10; index += 1) {
      const pendingDraft = await materials.createUploadDraft(actor, {
        ownerType: 'CASE',
        ownerId: ids.case,
        category: 'JUDGMENT',
        purpose: 'JUDGMENT',
        originalFilename: `pending-${index}.pdf`,
        declaredMimeType: 'application/pdf',
      });
      const pending = await materials.finalizeUpload(
        actor,
        pendingDraft.id,
        Readable.from(bytes),
      );
      const pendingStorage = await database.contentVersion.findUnique({
        where: { id: pending.contentVersionId },
        select: { storageKey: true },
      });
      keys.push(pendingStorage.storageKey);
    }
    const pendingPool = await database.material.count({
      where: {
        departmentId: ids.department,
        ownerType: 'CASE',
        ownerId: ids.case,
        category: 'JUDGMENT',
        status: 'ACTIVE',
        contentVersions: {
          none: { caseJudgmentVersions: { some: {} } },
        },
      },
    });
    const excessDraft = await materials.createUploadDraft(actor, {
      ownerType: 'CASE',
      ownerId: ids.case,
      category: 'JUDGMENT',
      purpose: 'JUDGMENT',
      originalFilename: 'pending-excess.pdf',
      declaredMimeType: 'application/pdf',
    });
    let pendingExcess = null;
    try {
      await materials.finalizeUpload(
        actor,
        excessDraft.id,
        Readable.from(bytes),
      );
    } catch (error) {
      pendingExcess = error.response?.code ?? null;
    }
    await client.query(
      "DELETE FROM role_grants WHERE role_template_id=$1 AND action='case.judgment.register'",
      [ids.role],
    );
    let revokedReplay = null;
    try {
      await judgment.register(actor, ids.case, input);
    } catch (error) {
      revokedReplay = error.response?.code ?? null;
    }
    let otherDepartment = null;
    try {
      await judgment.correct(
        { ...actor, departmentId: randomUUID() },
        ids.case,
        {
          ...correction,
          expectedVersion: 12,
          idempotencyKey: 'other-department',
        },
      );
    } catch (error) {
      otherDepartment = error.response?.code ?? null;
    }
    return {
      stage: result.stage,
      version: result.version,
      judgmentFacts: snapshot.judgmentFacts.length,
      hearingAdvances: snapshot.hearingAdvances.length,
      currentMatches: snapshot.case.currentJudgmentId === result.judgmentId,
      frozenVersions: snapshot.versions.length,
      frozenReferences: snapshot.references.length,
      elevenSelected,
      replacementVersion: replacement.version,
      originalReferencesAfterReplacement,
      originalBytesPreserved,
      pendingPool,
      pendingExcess,
      bytesMatch: downloaded.equals(bytes),
      replaySame: JSON.stringify(replay) === JSON.stringify(result),
      hearingBlocked,
      stale,
      noFile,
      faultRaised,
      rollbackFacts: rollbackFacts === beforeFault,
      rollbackCase:
        rollbackCase.version === 10 &&
        rollbackCase.currentJudgmentId === result.judgmentId,
      correctedStage: corrected.stage,
      correctedVersion: corrected.version,
      historyCount: history.length,
      priorMatches: history[1].priorFactId === history[0].id,
      nullEvent,
      sameEvent,
      extraSameEvent,
      unmatchedFactEvent,
      originalReferenceSetPreserved,
      nonJudgmentFirst,
      nonJudgmentDuplicate,
      updateOtherPurposeReference,
      reusedVersionAcrossFacts,
      changeFrozenReference,
      deleteFrozenReference,
      deleteOtherPurposeReference,
      preservedFrozenReference,
      immutableFact,
      reverseStage,
      concurrentResults,
      afterRace,
      revokedReplay,
      otherDepartment,
    };
  } finally {
    if (faultInstalled) {
      await client
        .query(`DROP TRIGGER IF EXISTS "${fault}" ON case_judgment_receipts`)
        .catch(() => undefined);
      await client
        .query(`DROP FUNCTION IF EXISTS "${fault}"()`)
        .catch(() => undefined);
    }
    await client.query('BEGIN').catch(() => undefined);
    let cleanupCommitted = false;
    try {
      await client.query('SET LOCAL session_replication_role = replica');
      await clearSecondInstanceDependentFacts(client, [ids.case]);
      await client.query(
        'DELETE FROM material_references WHERE resource_type=$1 AND resource_id=$2',
        ['case', ids.case],
      );
      await client.query(
        'DELETE FROM case_lawyer_assignments WHERE case_id=$1',
        [ids.case],
      );
      await client.query(
        'DELETE FROM case_complaint_confirmations WHERE case_id=$1',
        [ids.case],
      );
      await client.query(
        'DELETE FROM case_filing_submissions WHERE case_id=$1',
        [ids.case],
      );
      await client.query('DELETE FROM audit_events WHERE department_id=$1', [
        ids.department,
      ]);
      await client.query(
        'DELETE FROM upload_drafts WHERE owner_type=$1 AND owner_id=$2',
        ['CASE', ids.case],
      );
      await client.query(
        'DELETE FROM content_versions WHERE material_id IN (SELECT id FROM materials WHERE owner_type=$1 AND owner_id=$2)',
        ['CASE', ids.case],
      );
      await client.query(
        'DELETE FROM materials WHERE owner_type=$1 AND owner_id=$2',
        ['CASE', ids.case],
      );
      await client.query('DELETE FROM cases WHERE id=$1', [ids.case]);
      await client.query('DELETE FROM filing_courts WHERE department_id=$1', [
        ids.department,
      ]);
      await client.query('DELETE FROM case_trial_rounds WHERE case_id=$1', [
        ids.case,
      ]);
      await client.query(
        'DELETE FROM notary_certificates WHERE id IN (SELECT id FROM notary_certificates WHERE certificate_no=$1)',
        [`CA010-cert-${ids.case}`],
      );
      await client.query('DELETE FROM notary_matters WHERE business_no=$1', [
        `CA010-matter-${ids.case}`,
      ]);
      await client.query('DELETE FROM leads WHERE business_no=$1', [
        `CA010-lead-${ids.case}`,
      ]);
      await client.query('DELETE FROM rights_holders WHERE id=$1', [
        ids.holder,
      ]);
      await client.query('DELETE FROM customers WHERE id=$1', [ids.customer]);
      await client.query(
        'DELETE FROM customer_account_bindings WHERE department_id=$1',
        [ids.department],
      );
      await client.query(
        'DELETE FROM lawyer_account_bindings WHERE department_id=$1',
        [ids.department],
      );
      await client.query('DELETE FROM lawyer_profiles WHERE department_id=$1', [
        ids.department,
      ]);
      await client.query(
        'DELETE FROM role_assignments WHERE role_template_id=$1',
        [ids.role],
      );
      await client.query('DELETE FROM role_grants WHERE role_template_id=$1', [
        ids.role,
      ]);
      await client.query('DELETE FROM role_templates WHERE id=$1', [ids.role]);
      await client.query('DELETE FROM auth_sessions WHERE user_id=$1', [
        ids.actor,
      ]);
      await client.query('DELETE FROM local_credentials WHERE user_id=$1', [
        ids.actor,
      ]);
      await client.query(
        'DELETE FROM department_memberships WHERE user_id=$1',
        [ids.actor],
      );
      await client.query('DELETE FROM user_accounts WHERE id=$1', [ids.actor]);
      for (const id of extraUserIds)
        await client.query('DELETE FROM user_accounts WHERE id=$1', [id]);
      await client.query('DELETE FROM departments WHERE id=$1', [
        ids.department,
      ]);
      await client.query('COMMIT');
      cleanupCommitted = true;
    } finally {
      if (!cleanupCommitted)
        await client.query('ROLLBACK').catch(() => undefined);
      for (const key of keys) await storage.delete(key).catch(() => undefined);
      await database.$disconnect();
      await client.end();
    }
  }
}

async function code(client, sql, params) {
  try {
    await client.query('BEGIN');
    await client.query(sql, params);
    await client.query('COMMIT');
    return null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return error.code ?? null;
  }
}
