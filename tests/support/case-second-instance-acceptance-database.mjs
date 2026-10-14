import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { coreLeadFixtures } from './core-lead-database.mjs';
import { createSubmittedCaseThroughApi } from './case-complaint-confirmation-database.mjs';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

const requireBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { Client } = requireBackend('pg');
const action = 'case.second-instance-acceptance.update';
const departments = [
  coreLeadFixtures.departmentA,
  coreLeadFixtures.departmentB,
];
const roles = [
  coreLeadFixtures.roleA,
  coreLeadFixtures.roleB,
  coreLeadFixtures.roleSelf,
];
const operator = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const businessDate = () => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 3);
  return date.toISOString().slice(0, 10);
};

async function expectApi(response, status) {
  if (response.status() !== status)
    throw new Error(
      `Real fixture API returned ${response.status()}: ${await response.text()}`,
    );
  return response.json();
}

async function uploadFixtureFile(request, caseId, category) {
  const draft = await expectApi(
    await request.post('/api/v1/materials/upload-drafts', {
      headers: operator,
      data: {
        ownerType: 'CASE',
        ownerId: caseId,
        category,
        purpose: category,
        originalFilename: `CE002-migration-${category}.pdf`,
        declaredMimeType: 'application/pdf',
      },
    }),
    201,
  );
  return expectApi(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...operator, 'Content-Type': 'application/octet-stream' },
      data: Buffer.from('%PDF-1.4\nCE002 real migration source\n%%EOF\n'),
    }),
    200,
  );
}

/** Build an actual, still-current APPEAL root in the isolated public test schema. */
export async function createSecondInstanceAcceptanceAppealSource(request) {
  const source = await createSubmittedCaseThroughApi(request);
  const caseId = source.caseId;
  const prefix = `/api/v1/cases/${caseId}`;
  const date = businessDate();
  await expectApi(
    await request.post(`${prefix}/complaint-confirm`, {
      headers: operator,
      data: {
        expectedVersion: source.submitted.version,
        idempotencyKey: randomUUID(),
        confirmedComplaintContentVersionId: source.complaint.contentVersionId,
        amountState: 'KNOWN',
        amount: '123.45',
        pendingReason: null,
        confirmDisclose: true,
      },
    }),
    201,
  );
  const mail = await uploadFixtureFile(request, caseId, 'MAIL_RECEIPT');
  await expectApi(
    await request.post(`${prefix}/complaint-mail`, {
      headers: operator,
      data: {
        expectedVersion: source.submitted.version + 1,
        idempotencyKey: randomUUID(),
        mailedAt: date,
        mailReceiptContentVersionIds: [mail.contentVersionId],
      },
    }),
    201,
  );
  const court = await expectApi(
    await request.post(`${prefix}/filing-courts`, {
      headers: operator,
      data: { name: `CE002迁移法院${randomUUID().slice(0, 8)}` },
    }),
    201,
  );
  const filing = await uploadFixtureFile(request, caseId, 'FILING_EVIDENCE');
  await expectApi(
    await request.post(`${prefix}/filing-submit`, {
      headers: operator,
      data: {
        expectedVersion: source.submitted.version + 2,
        idempotencyKey: randomUUID(),
        courtId: court.id,
        submittedAt: date,
        filingEvidenceContentVersionIds: [filing.contentVersionId],
      },
    }),
    201,
  );
  const filed = await expectApi(
    await request.get(prefix, { headers: operator }),
    200,
  );
  const notice = await uploadFixtureFile(request, caseId, 'ACCEPTANCE_NOTICE');
  await expectApi(
    await request.post(`${prefix}/acceptance-register`, {
      headers: operator,
      data: {
        expectedVersion: filed.version,
        idempotencyKey: randomUUID(),
        acceptedAt: date,
        courtCaseNo: 'CE002迁移旧一审案号',
        acceptanceNoticeContentVersionIds: [notice.contentVersionId],
      },
    }),
    201,
  );
  const accepted = await expectApi(
    await request.get(prefix, { headers: operator }),
    200,
  );
  await expectApi(
    await request.post(`${prefix}/hearing-schedule`, {
      headers: operator,
      data: {
        expectedVersion: accepted.version,
        idempotencyKey: randomUUID(),
        hearingAt: date,
      },
    }),
    201,
  );
  let judgmentReady = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const detail = await expectApi(
      await request.get(prefix, { headers: operator }),
      200,
    );
    if (detail.stage === 'WAITING_JUDGMENT') {
      judgmentReady = detail;
      break;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  if (!judgmentReady)
    throw new Error('Real APPEAL predecessor did not reach judgment');
  const judgmentFile = await uploadFixtureFile(request, caseId, 'JUDGMENT');
  const judgment = await expectApi(
    await request.post(`${prefix}/judgment-register`, {
      headers: operator,
      data: {
        expectedVersion: judgmentReady.version,
        idempotencyKey: randomUUID(),
        judgmentReceivedAt: date,
        judgmentAmountState: 'KNOWN',
        judgmentAmount: '88.00',
        paidLitigationFeeState: 'KNOWN',
        paidLitigationFee: '0.00',
        judgmentContentVersionIds: [judgmentFile.contentVersionId],
      },
    }),
    201,
  );
  await expectApi(
    await request.post(`${prefix}/judgment-next-step`, {
      headers: operator,
      data: {
        expectedVersion: judgment.version,
        idempotencyKey: randomUUID(),
        judgmentId: judgment.judgmentId,
        next: 'APPEAL',
        plaintiffAppeals: true,
        defendantIds: [],
      },
    }),
    201,
  );
  const detail = await expectApi(
    await request.get(prefix, { headers: operator }),
    200,
  );
  if (detail.judgmentNextStep.current?.next !== 'APPEAL')
    throw new Error('Real APPEAL source was not created');
  return {
    caseId,
    choiceId: detail.judgmentNextStep.current.id,
    trialRoundId: detail.judgmentNextStep.current.trialRoundId,
    date,
  };
}

export async function withSecondInstanceAcceptanceDatabase(operation) {
  const url = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== 'test' || !url)
    throw new Error(
      'Second-instance acceptance fixture requires an isolated test database',
    );
  validateIsolatedTestDatabaseUrl(url);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      'SELECT current_database() AS db,current_schema() AS schema',
    );
    if (rows[0]?.db !== 'dev_cor_test' || rows[0]?.schema !== 'public')
      throw new Error('Unexpected second-instance acceptance fixture database');
    return await operation(client);
  } finally {
    await client.end();
  }
}

export async function setSecondInstanceAcceptanceGrant(roleId, scope, enabled) {
  if (
    !roles.includes(roleId) ||
    !['SELF', 'TEAM', 'DEPARTMENT'].includes(scope)
  )
    throw new Error('Grant outside synthetic roles or scopes');
  await withSecondInstanceAcceptanceDatabase(async (client) => {
    const { rows } = await client.query(
      'SELECT id FROM role_templates WHERE id=$1 AND department_id=ANY($2::uuid[])',
      [roleId, departments],
    );
    if (rows.length !== 1) throw new Error('Synthetic role missing');
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
  });
}

export async function grantSecondInstanceAcceptancePredecessors() {
  const actions = [
    'case.hearing.schedule',
    'case.judgment.register',
    'case.judgment.next_step',
    'case.judgment.next_step.revoke',
    'case.second_instance.save',
    'case.second_instance.result',
    'case.second_instance.result.revoke',
  ];
  await withSecondInstanceAcceptanceDatabase(async (client) => {
    for (const predecessor of actions)
      await client.query(
        'INSERT INTO role_grants(id,role_template_id,action,scope) VALUES($1,$2,$3::permission_action,$4::permission_scope) ON CONFLICT DO NOTHING',
        [randomUUID(), coreLeadFixtures.roleA, predecessor, 'TEAM'],
      );
  });
}

export async function secondInstanceAcceptanceSnapshot(caseId) {
  return withSecondInstanceAcceptanceDatabase(async (client) => {
    const { rows: owned } = await client.query(
      'SELECT id FROM cases WHERE id=$1 AND department_id=ANY($2::uuid[])',
      [caseId, departments],
    );
    if (owned.length !== 1) throw new Error('Case outside synthetic fixture');
    const rows = async (statement) =>
      (await client.query(statement, [caseId])).rows.map((r) => r.row);
    return {
      case: await rows('SELECT to_jsonb(t) AS row FROM cases t WHERE id=$1'),
      choices: await rows(
        'SELECT to_jsonb(t) AS row FROM case_judgment_next_steps t WHERE case_id=$1 ORDER BY id',
      ),
      changes: await rows(
        'SELECT to_jsonb(t) AS row FROM case_second_instance_acceptance_changes t WHERE case_id=$1 ORDER BY recorded_at,id',
      ),
      receipts: await rows(
        "SELECT to_jsonb(t) AS row FROM case_record_edit_receipts t WHERE case_id=$1 AND command='SECOND_INSTANCE_ACCEPTANCE_SAVE' ORDER BY id",
      ),
      oldReceipts: await rows(
        "SELECT to_jsonb(t) AS row FROM case_record_edit_receipts t WHERE case_id=$1 AND command<>'SECOND_INSTANCE_ACCEPTANCE_SAVE' ORDER BY id",
      ),
      acceptances: await rows(
        'SELECT to_jsonb(t) AS row FROM case_acceptances t WHERE case_id=$1 ORDER BY id',
      ),
      matchingReceipts: await rows(
        'SELECT to_jsonb(t) AS row FROM case_match_receipts t WHERE case_id=$1 ORDER BY id',
      ),
      acceptanceReceipts: await rows(
        'SELECT to_jsonb(t) AS row FROM case_acceptance_receipts t WHERE case_id=$1 ORDER BY id',
      ),
      judgmentChoiceReceipts: await rows(
        'SELECT to_jsonb(t) AS row FROM case_judgment_next_step_receipts t WHERE case_id=$1 ORDER BY id',
      ),
      secondInstanceReceipts: await rows(
        'SELECT to_jsonb(t) AS row FROM case_second_instance_receipts t WHERE case_id=$1 ORDER BY id',
      ),
      secondProgress: await rows(
        'SELECT to_jsonb(t) AS row FROM case_second_instance_progresses t WHERE case_id=$1 ORDER BY id',
      ),
      secondResults: await rows(
        'SELECT to_jsonb(t) AS row FROM case_second_instance_results t WHERE case_id=$1 ORDER BY id',
      ),
      archive: await rows(
        'SELECT to_jsonb(t) AS row FROM case_archive_versions t WHERE case_id=$1 ORDER BY id',
      ),
      materials: await rows(
        "SELECT to_jsonb(t) AS row FROM material_references t WHERE resource_type='case' AND resource_id=$1 ORDER BY id",
      ),
      audits: await rows(
        "SELECT to_jsonb(t) AS row FROM audit_events t WHERE resource_type='CASE' AND resource_id=$1 ORDER BY id",
      ),
    };
  });
}

export async function clearSecondInstanceAcceptanceFault() {
  await withSecondInstanceAcceptanceDatabase(async (client) => {
    if (
      (
        await client.query(
          "SELECT to_regclass('public.case_second_instance_acceptance_changes') AS present",
        )
      ).rows[0]?.present === null
    )
      return;
    await client.query(
      'DROP TRIGGER IF EXISTS ce002_reject_insert ON case_second_instance_acceptance_changes',
    );
    await client.query('DROP FUNCTION IF EXISTS ce002_reject_insert()');
  });
}

export async function rejectSecondInstanceAcceptanceWrite() {
  await clearSecondInstanceAcceptanceFault();
  await withSecondInstanceAcceptanceDatabase(async (client) => {
    await client.query(
      "CREATE FUNCTION ce002_reject_insert() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected CE002 failure' USING ERRCODE='P0001'; END; $$ LANGUAGE plpgsql",
    );
    await client.query(
      'CREATE TRIGGER ce002_reject_insert BEFORE INSERT ON case_second_instance_acceptance_changes FOR EACH ROW EXECUTE FUNCTION ce002_reject_insert()',
    );
  });
}

export async function clearSecondInstanceAcceptanceFixture() {
  await clearSecondInstanceAcceptanceFault();
  const available = await withSecondInstanceAcceptanceDatabase(
    async (client) => {
      const { rows } = await client.query(
        "SELECT to_regclass('public.case_second_instance_acceptance_changes') AS present",
      );
      if (rows[0]?.present === null) return false;
      await client.query('BEGIN');
      try {
        const audits = (
          await client.query(
            'SELECT audit_event_id FROM case_second_instance_acceptance_changes WHERE department_id=ANY($1::uuid[])',
            [departments],
          )
        ).rows.map((r) => r.audit_event_id);
        await client.query(
          'ALTER TABLE case_record_edit_receipts DISABLE TRIGGER USER',
        );
        await client.query(
          'ALTER TABLE case_second_instance_acceptance_changes DISABLE TRIGGER USER',
        );
        await client.query('ALTER TABLE audit_events DISABLE TRIGGER USER');
        await client.query(
          "DELETE FROM case_record_edit_receipts WHERE department_id=ANY($1::uuid[]) AND command='SECOND_INSTANCE_ACCEPTANCE_SAVE'",
          [departments],
        );
        await client.query(
          'DELETE FROM case_second_instance_acceptance_changes WHERE department_id=ANY($1::uuid[])',
          [departments],
        );
        if (audits.length)
          await client.query(
            'DELETE FROM audit_events WHERE id=ANY($1::uuid[])',
            [audits],
          );
        await client.query('ALTER TABLE audit_events ENABLE TRIGGER USER');
        await client.query(
          'ALTER TABLE case_second_instance_acceptance_changes ENABLE TRIGGER USER',
        );
        await client.query(
          'ALTER TABLE case_record_edit_receipts ENABLE TRIGGER USER',
        );
        await client.query('COMMIT');
        return true;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    },
  );
  if (!available) return;
  for (const role of roles)
    for (const scope of ['SELF', 'TEAM', 'DEPARTMENT'])
      await setSecondInstanceAcceptanceGrant(role, scope, false);
}
