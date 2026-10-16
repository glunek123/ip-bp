import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  captureTestEnvironment,
  validateBrowserTestDatabaseUrl,
} from '../../scripts/test-environment.mjs';
import { admitSectionMigration } from './case-section-record-migration.mjs';

const root = process.cwd();
const migrationRoot = resolve(root, 'backend/prisma/migrations');
const oldName = '20261015150000_case_section_record_edits';
const uploadName = '20261015170000_case_section_record_uploads';
const repairName = '20261016090000_case_record_material_guard_repair';
const oldHash =
  '10760cf6e9969822a6b6a631760645625d227c4541a018560473e34c164953c7';
const uploadHash =
  '883f2f80b615a0f746adb2ebbb6e17cc24d0ac577a61d236f3bb6375fbc0367d';
const names = [
  'check_execution_mailing_record_correction',
  'check_execution_filing_record_correction',
  'check_execution_finish_record_correction',
  'check_judgment_record_correction',
  'check_closure_record_correction',
];
const replacements = [
  [
    ' r "case_section_record_edit_receipts"%ROWTYPE;',
    ' receipt_row "case_section_record_edit_receipts"%ROWTYPE;',
  ],
  [
    'SELECT * INTO r FROM "case_section_record_edit_receipts"',
    'SELECT * INTO receipt_row FROM "case_section_record_edit_receipts"',
  ],
  [
    'IF r."id" IS NULL OR r."result_snapshot"',
    'IF receipt_row."id" IS NULL OR receipt_row."result_snapshot"',
  ],
  ['CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'],
];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const uuid = () => randomUUID();

function exactlyOnce(haystack, needle) {
  assert.equal(haystack.split(needle).length, 2, `Expected one ${needle}`);
}

export async function recordMaterialGuardSources() {
  const files = await Promise.all(
    [oldName, uploadName, repairName].map((name) =>
      readFile(resolve(migrationRoot, name, 'migration.sql')),
    ),
  );
  assert.equal(sha(files[0]), oldHash);
  assert.equal(sha(files[1]), uploadHash);
  const oldSql = files[0].toString('utf8');
  const repairSql = files[2].toString('utf8');
  assert.match(repairSql, /^--[^\n]*\n--[^\n]*\nBEGIN;\n/u);
  assert.match(repairSql, /\nCOMMIT;\n$/u);
  assert.doesNotMatch(
    repairSql,
    /\bpublic\b|\bsearch_path\b|\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|SCHEMA|ROLE)\b/iu,
  );
  const oldFunctions = [];
  const repairedFunctions = [];
  for (const name of names) {
    const pattern = new RegExp(
      `CREATE FUNCTION "${name}"\\(\\) RETURNS trigger LANGUAGE plpgsql AS \\$\\$[\\s\\S]*?END; \\$\\$;`,
      'gu',
    );
    const found = [...oldSql.matchAll(pattern)];
    assert.equal(found.length, 1, `One original ${name}`);
    const oldBody = found[0][0];
    let repaired = oldBody;
    for (const [before, after] of replacements) {
      exactlyOnce(repaired, before);
      repaired = repaired.replace(before, after);
    }
    exactlyOnce(repairSql, repaired);
    let restored = repaired;
    for (const [before, after] of [...replacements].reverse()) {
      exactlyOnce(restored, after);
      restored = restored.replace(after, before);
    }
    assert.equal(restored, oldBody, `Exact inverse of ${name}`);
    oldFunctions.push(oldBody);
    repairedFunctions.push(repaired);
  }
  assert.equal(
    (repairSql.match(/CREATE OR REPLACE FUNCTION/gu) ?? []).length,
    5,
  );
  const expected = `-- Rename the receipt row variable so the material_references r alias resolves as a table row.\n-- CREATE OR REPLACE preserves function identity, trigger bindings, owner and grants.\nBEGIN;\n\n${repairedFunctions.join('\n\n')}\n\nCOMMIT;\n`;
  assert.equal(
    repairSql,
    expected,
    'No other function body or migration changes',
  );
  return { oldFunctions, repairSql, sourceSha256: sha(files[2]) };
}

const kinds = [
  {
    name: names[0],
    original: 'case_execution_mailings',
    correction: 'case_execution_mailing_record_corrections',
    documents: 'case_execution_mailing_record_documents',
    versions: 'case_execution_mailing_versions',
    sourceKey: 'mailing_id',
    dateKey: 'mailed_at',
    resultKey: 'mailingId',
    revisionKey: 'mailingRevision',
    dateResultKey: 'mailedAt',
    action: 'case.execution.mailing.record-corrected',
    command: 'EXECUTION_MAILING_CORRECTION',
    purpose: 'MAIL_RECEIPT',
  },
  {
    name: names[1],
    original: 'case_execution_filings',
    correction: 'case_execution_filing_record_corrections',
    documents: 'case_execution_filing_record_documents',
    versions: 'case_execution_filing_versions',
    sourceKey: 'filing_id',
    dateKey: 'submitted_at',
    resultKey: 'filingId',
    revisionKey: 'filingRevision',
    dateResultKey: 'submittedAt',
    action: 'case.execution.filing.record-corrected',
    command: 'EXECUTION_FILING_CORRECTION',
    purpose: 'EXECUTION_FILING_PROOF',
  },
  {
    name: names[2],
    original: 'case_execution_finishes',
    correction: 'case_execution_finish_record_corrections',
    documents: 'case_execution_finish_record_documents',
    versions: 'case_execution_finish_versions',
    sourceKey: 'finish_id',
    dateKey: 'finished_at',
    resultKey: 'finishId',
    revisionKey: 'finishRevision',
    dateResultKey: 'finishedAt',
    action: 'case.execution.finish.record-corrected',
    command: 'EXECUTION_FINISH_CORRECTION',
    purpose: 'EXECUTION_FINISH_BASIS',
  },
  {
    name: names[3],
    original: 'case_judgment_facts',
    correction: 'case_judgment_record_corrections',
    documents: 'case_judgment_record_documents',
    versions: 'case_judgment_versions',
    sourceKey: 'judgment_id',
    versionKey: 'fact_id',
    dateKey: 'judgment_received_at',
    resultKey: 'judgmentId',
    revisionKey: 'judgmentRevision',
    dateResultKey: 'judgmentReceivedAt',
    action: 'case.judgment.record-corrected',
    command: 'JUDGMENT_RECORD_CORRECTION',
    purpose: 'JUDGMENT',
  },
  {
    name: names[4],
    original: 'case_closure_versions',
    correction: 'case_closure_record_corrections',
    documents: 'case_closure_record_documents',
    versions: 'case_closure_documents',
    sourceKey: 'source_closure_version_id',
    versionKey: 'closure_version_id',
    dateKey: 'close_at',
    resultKey: 'closureId',
    revisionKey: 'closureRevision',
    dateResultKey: 'closeAt',
    action: 'case.closure.record-corrected',
    command: 'CLOSURE_RECORD_CORRECTION',
    purpose: 'CASE_CLOSURE_DOCUMENT',
  },
];

async function publicSnapshot(client) {
  const rows = await client.query(`SELECT
    (SELECT count(*)::int FROM public.cases) AS cases,
    (SELECT count(*)::int FROM public.material_references) AS material_references,
    (SELECT count(*)::int FROM public.audit_events) AS audit_events,
    (SELECT jsonb_agg(jsonb_build_array(migration_name,checksum,finished_at,rolled_back_at) ORDER BY migration_name) FROM public._prisma_migrations) AS ledger,
    (SELECT jsonb_agg(jsonb_build_array(p.proname,p.oid::text) ORDER BY p.proname,p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') AS functions`);
  return sha(JSON.stringify(rows.rows[0]));
}

async function assertSourceLedger(client) {
  const entries = await readdir(migrationRoot);
  const local = new Map();
  for (const name of entries.filter((value) => /^\d{14}_/u.test(value))) {
    local.set(
      name,
      sha(await readFile(resolve(migrationRoot, name, 'migration.sql'))),
    );
  }
  assert.equal(local.get(oldName), oldHash);
  assert.equal(local.get(uploadName), uploadHash);
  assert.ok(local.has(repairName));
  const ledger = (
    await client.query(
      'SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name',
    )
  ).rows;
  assert.ok(
    [157, 158].includes(ledger.length),
    'Public must be the expected 157/158 migration predecessor',
  );
  for (const row of ledger) {
    assert.ok(
      row.finished_at && row.rolled_back_at === null,
      'No unfinished public migration',
    );
    assert.equal(
      row.checksum,
      local.get(row.migration_name),
      `Source ledger mismatch: ${row.migration_name}`,
    );
    assert.notEqual(
      row.migration_name,
      repairName,
      'Repair migration must not already be public',
    );
  }
  assert.ok(ledger.some((row) => row.migration_name === oldName));
  assert.ok(ledger.some((row) => row.migration_name === uploadName));
  return ledger.length;
}

async function buildOwnedSchema(client, schema, oldFunctions) {
  await client.query(`CREATE SCHEMA ${quote(schema)}`);
  await client.query(
    `COMMENT ON SCHEMA ${quote(schema)} IS 'record-material-guard:${schema}'`,
  );
  await client.query(`SET search_path TO ${quote(schema)}, pg_catalog`);
  await client.query(
    'CREATE TABLE cases (id uuid PRIMARY KEY, department_id uuid NOT NULL)',
  );
  await client.query(
    'CREATE TABLE case_closures (id uuid PRIMARY KEY, current_version_id uuid)',
  );
  await client.query(
    `CREATE TABLE audit_events (id uuid PRIMARY KEY, department_id uuid, resource_type text, resource_id uuid, actor_user_id uuid, internal_actor_user_id uuid, action text, details jsonb)`,
  );
  await client.query(
    `CREATE TABLE case_section_record_edit_receipts (id uuid PRIMARY KEY, department_id uuid, case_id uuid, actor_user_id uuid, command text, result_snapshot jsonb)`,
  );
  await client.query(
    `CREATE TABLE material_references (material_id uuid, content_version_id uuid, department_id uuid, resource_type text, resource_id uuid, purpose text, action_event_id uuid)`,
  );
  await client.query(
    `CREATE FUNCTION case_record_edit_actor_authorized(uuid,uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$`,
  );
  const originalColumns = `id uuid PRIMARY KEY, case_id uuid, department_id uuid, mailed_at date, submitted_at date, finished_at date, reason text, basis_note text, judgment_received_at date, judgment_amount_state text, judgment_amount numeric, paid_litigation_fee_state text, paid_litigation_fee numeric, close_at date, close_amount_state text, close_amt numeric, note text`;
  const correctionColumns = `id uuid PRIMARY KEY, case_id uuid, department_id uuid, mailing_id uuid, filing_id uuid, finish_id uuid, judgment_id uuid, closure_id uuid, source_closure_version_id uuid, trial_round_id uuid, prior_correction_id uuid, from_revision int, to_revision int, mailed_at date, submitted_at date, finished_at date, business_reason text, basis_note text, judgment_received_at date, judgment_amount_state text, judgment_amount numeric, paid_litigation_fee_state text, paid_litigation_fee numeric, close_at date, close_amount_state text, close_amt numeric, note text, correction_reason text, recorded_at timestamptz, recorded_by_user_id uuid, audit_event_id uuid, case_anchor_snapshot jsonb`;
  for (const kind of kinds) {
    await client.query(
      `CREATE TABLE ${quote(kind.original)} (${originalColumns})`,
    );
    await client.query(
      `CREATE TABLE ${quote(kind.correction)} (${correctionColumns})`,
    );
    await client.query(
      `CREATE TABLE ${quote(kind.documents)} (correction_id uuid, case_id uuid, department_id uuid, material_id uuid, content_version_id uuid)`,
    );
    await client.query(
      `CREATE TABLE ${quote(kind.versions)} (mailing_id uuid, filing_id uuid, finish_id uuid, fact_id uuid, closure_version_id uuid, content_version_id uuid)`,
    );
  }
  for (const body of oldFunctions) await client.query(body);
  for (const kind of kinds) {
    await client.query(
      `CREATE CONSTRAINT TRIGGER ${quote(`${kind.name}_guard`)} AFTER INSERT ON ${quote(kind.correction)} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${quote(kind.name)}()`,
    );
  }
}

function businessValues(kind, date, fileId) {
  const result = { [kind.dateResultKey]: date, contentVersionIds: [fileId] };
  if (kind.sourceKey === 'finish_id')
    Object.assign(result, { reason: 'business reason', basisNote: null });
  if (kind.sourceKey === 'judgment_id')
    Object.assign(result, {
      judgmentAmountState: 'PENDING',
      judgmentAmount: null,
      paidLitigationFeeState: 'PENDING',
      paidLitigationFee: null,
    });
  if (kind.sourceKey === 'source_closure_version_id')
    Object.assign(result, {
      closeAmountState: 'PENDING',
      closeAmt: null,
      note: 'closure note',
    });
  return result;
}

async function seedSource(client, kind, fixture) {
  const { caseId, departmentId, sourceId, closureId, oldFileId } = fixture;
  await client.query('INSERT INTO cases(id,department_id) VALUES($1,$2)', [
    caseId,
    departmentId,
  ]);
  await client.query(
    `INSERT INTO ${quote(kind.original)} (id,case_id,department_id,${quote(kind.dateKey)},reason,basis_note,judgment_amount_state,paid_litigation_fee_state,close_amount_state,note) VALUES($1,$2,$3,$4,'business reason',NULL,'PENDING','PENDING','PENDING','closure note')`,
    [sourceId, caseId, departmentId, '2026-09-01'],
  );
  if (kind.sourceKey === 'source_closure_version_id')
    await client.query(
      'INSERT INTO case_closures(id,current_version_id) VALUES($1,$2)',
      [closureId, sourceId],
    );
  await client.query(
    `INSERT INTO ${quote(kind.versions)} (${quote(kind.versionKey ?? kind.sourceKey)},content_version_id) VALUES($1,$2)`,
    [sourceId, oldFileId],
  );
}

async function attempt(client, kind, fixture, reference) {
  const {
    caseId,
    departmentId,
    actorId,
    sourceId,
    closureId,
    trialRoundId,
    oldFileId,
  } = fixture;
  const correctionId = uuid();
  const auditId = uuid();
  const fileId = uuid();
  const materialId = uuid();
  const recordedAt = '2026-10-01T00:00:00.000Z';
  const before = businessValues(kind, '2026-09-01', oldFileId);
  const after = businessValues(kind, '2026-10-01', fileId);
  const details = {
    correctionId,
    [kind.resultKey]: kind.resultKey === 'closureId' ? closureId : sourceId,
    fromRevision: 0,
    toRevision: 1,
    correctionReason: 'repair proof',
    before,
    after,
  };
  if (kind.sourceKey === 'judgment_id') details.trialRoundId = trialRoundId;
  const snapshot = {
    caseId,
    correctionId,
    recordedAt,
    [kind.resultKey]: details[kind.resultKey],
    [kind.revisionKey]: 1,
    [kind.dateResultKey]: '2026-10-01',
  };
  if (kind.sourceKey === 'judgment_id') snapshot.trialRoundId = trialRoundId;
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO ${quote(kind.correction)} (id,case_id,department_id,${quote(kind.sourceKey)},closure_id,trial_round_id,from_revision,to_revision,${quote(kind.dateKey)},business_reason,judgment_amount_state,paid_litigation_fee_state,close_amount_state,note,correction_reason,recorded_at,recorded_by_user_id,audit_event_id,case_anchor_snapshot) VALUES ($1,$2,$3,$4,$5,$6,0,1,$7,'business reason','PENDING','PENDING','PENDING','closure note','repair proof',$8,$9,$10,(SELECT to_jsonb(c) FROM cases c WHERE c.id=$2))`,
      [
        correctionId,
        caseId,
        departmentId,
        sourceId,
        kind.sourceKey === 'source_closure_version_id' ? closureId : null,
        kind.sourceKey === 'judgment_id' ? trialRoundId : null,
        '2026-10-01',
        recordedAt,
        actorId,
        auditId,
      ],
    );
    await client.query(
      `INSERT INTO ${quote(kind.documents)} (correction_id,case_id,department_id,material_id,content_version_id) VALUES($1,$2,$3,$4,$5)`,
      [correctionId, caseId, departmentId, materialId, fileId],
    );
    if (reference !== 'missing') {
      await client.query(
        'INSERT INTO material_references(material_id,content_version_id,department_id,resource_type,resource_id,purpose,action_event_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          reference === 'wrong' ? uuid() : materialId,
          fileId,
          departmentId,
          'case',
          caseId,
          kind.purpose,
          auditId,
        ],
      );
    }
    await client.query(
      'INSERT INTO audit_events(id,department_id,resource_type,resource_id,actor_user_id,internal_actor_user_id,action,details) VALUES($1,$2,$3,$4,$5,$5,$6,$7)',
      [auditId, departmentId, 'CASE', caseId, actorId, kind.action, details],
    );
    await client.query(
      'INSERT INTO case_section_record_edit_receipts(id,department_id,case_id,actor_user_id,command,result_snapshot) VALUES($1,$2,$3,$4,$5,$6)',
      [uuid(), departmentId, caseId, actorId, kind.command, snapshot],
    );
    await client.query('COMMIT');
    return correctionId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function expectFailure(client, kind, fixture, reference, code, message) {
  await assert.rejects(attempt(client, kind, fixture, reference), (error) => {
    assert.equal(error.code, code, `${kind.name}: SQLSTATE`);
    if (message) assert.equal(error.message, message);
    return true;
  });
}

export async function verifyRecordMaterialGuardRepair() {
  // Exact environment admission happens before capture, pg import, or connection.
  const admission = admitSectionMigration(process.env);
  const sources = await recordMaterialGuardSources();
  const capture = captureTestEnvironment(root, {
    pnpmVersion: admission.pnpmVersion,
  });
  const checked = validateBrowserTestDatabaseUrl(
    admission.connectionString,
    root,
  );
  assert.equal(checked.connectionString, admission.connectionString);
  assert.equal(
    capture.childEnvironment.DATABASE_URL,
    admission.connectionString,
  );
  const backend = createRequire(resolve(root, 'backend/package.json'));
  const { Client } = backend('pg');
  const client = new Client({ connectionString: admission.connectionString });
  const schema = `record_guard_${uuid().replaceAll('-', '')}`;
  let created = false;
  let publicBefore;
  let success = false;
  const checks = [];
  await client.connect();
  try {
    const ledgerCount = await assertSourceLedger(client);
    publicBefore = await publicSnapshot(client);
    await buildOwnedSchema(client, schema, sources.oldFunctions);
    created = true;
    for (const kind of kinds) {
      const fixture = {
        caseId: uuid(),
        departmentId: uuid(),
        actorId: uuid(),
        sourceId: uuid(),
        closureId: uuid(),
        trialRoundId: uuid(),
        oldFileId: uuid(),
      };
      await seedSource(client, kind, fixture);
      await expectFailure(
        client,
        kind,
        fixture,
        'valid',
        '42703',
        'record "r" has no field "material_id"',
      );
      checks.push(`${kind.name}:old-42703`);
    }
    await client.query(sources.repairSql);
    for (const kind of kinds) {
      const fixture = {
        caseId: uuid(),
        departmentId: uuid(),
        actorId: uuid(),
        sourceId: uuid(),
        closureId: uuid(),
        trialRoundId: uuid(),
        oldFileId: uuid(),
      };
      await seedSource(client, kind, fixture);
      await expectFailure(
        client,
        kind,
        fixture,
        'missing',
        '23514',
        'correction document lacks exact retained material reference',
      );
      await expectFailure(
        client,
        kind,
        fixture,
        'wrong',
        '23514',
        'correction document lacks exact retained material reference',
      );
      const correctionId = await attempt(client, kind, fixture, 'valid');
      const persisted = await client.query(
        `SELECT count(*)::int AS count FROM ${quote(kind.correction)} WHERE id=$1`,
        [correctionId],
      );
      assert.equal(persisted.rows[0].count, 1);
      checks.push(`${kind.name}:repaired-valid-missing-wrong`);
    }
    assert.equal(
      await publicSnapshot(client),
      publicBefore,
      'Selected public rows/catalog/ledger changed',
    );
    success = true;
    return {
      checks,
      ledgerCount,
      repairSha256: sources.sourceSha256,
      publicUnchanged: true,
      authorizationScope:
        'owned-schema explicit true shim; guard SQL path only',
    };
  } finally {
    try {
      await client.query('SET search_path TO pg_catalog').catch(() => {});
      if (created && success) {
        const marker = (
          await client.query(
            "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
            [schema],
          )
        ).rows[0]?.marker;
        assert.equal(
          marker,
          `record-material-guard:${schema}`,
          'Owned schema marker changed; retain schema',
        );
        const inbound = (
          await client.query(
            "SELECT count(*)::int AS count FROM pg_depend d CROSS JOIN LATERAL pg_identify_object(d.classid,d.objid,d.objsubid) obj CROSS JOIN LATERAL pg_identify_object(d.refclassid,d.refobjid,d.refobjsubid) ref WHERE d.deptype='n' AND ref.schema=$1 AND obj.schema IS NOT NULL AND obj.schema<>$1",
            [schema],
          )
        ).rows[0].count;
        assert.equal(
          inbound,
          0,
          'Cross-schema dependent object; retain owned schema',
        );
        assert.equal(
          await publicSnapshot(client),
          publicBefore,
          'Public changed; retain owned schema',
        );
        await client.query(`DROP SCHEMA ${quote(schema)} CASCADE`);
        assert.equal(
          await publicSnapshot(client),
          publicBefore,
          'Public changed during owned cleanup',
        );
      }
    } finally {
      await client.end();
    }
  }
}
