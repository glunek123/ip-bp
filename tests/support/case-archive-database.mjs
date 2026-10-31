import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';
import { admitManagedWorkerDatabase } from '../../scripts/managed-e2e-worker-admission.mjs';
import { coreLeadFixtures } from './core-lead-database.mjs';
import {
  createFinishedCaseClosureSourceThroughApi,
  setCaseClosureFixtureGrant,
} from './case-closure-database.mjs';

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
const archiveTables = [
  'case_archives',
  'case_archive_versions',
  'case_archive_receipts',
  'case_archive_evidence_snapshots',
];
const priorTables = [
  'case_closures',
  'case_closure_versions',
  'case_closure_documents',
  'case_closure_receipts',
  'case_execution_finishes',
  'case_execution_finish_versions',
  'case_execution_finish_receipts',
];
const operator = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
async function connect() {
  if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL)
    throw new Error('Archive fixtures require isolated tests');
  const managed = await admitManagedWorkerDatabase({
    databaseUrl: process.env.DATABASE_URL,
  });
  if (managed === null)
    validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
  if (
    resolve(process.env.PRIVATE_FILE_ROOT ?? '') !==
    resolve(process.cwd(), '.local/private-files/test')
  )
    throw new Error('Archive fixtures require isolated file root');
  const backend = createRequire(resolve(process.cwd(), 'backend/package.json'));
  const { Client } = backend('pg');
  const client = new Client({
    connectionString: managed?.connectionString ?? process.env.DATABASE_URL,
  });
  await client.connect();
  const identity = (
    await client.query(
      'SELECT current_database() AS db,current_schema() AS schema',
    )
  ).rows[0];
  if (identity.db !== 'dev_cor_test' || identity.schema !== 'public') {
    await client.end();
    throw new Error('Unexpected archive fixture target');
  }
  return client;
}
async function assertCase(client, caseId) {
  if (!uuid.test(caseId)) throw new Error('Invalid synthetic case identity');
  if (
    (
      await client.query(
        'SELECT id FROM cases WHERE id=$1 AND department_id=ANY($2::uuid[])',
        [caseId, departments],
      )
    ).rows.length !== 1
  )
    throw new Error('Archive case outside synthetic fixture departments');
}
export async function setCaseArchiveFixtureGrant(
  roleId,
  action,
  scope,
  enabled = true,
) {
  if (
    !roles.includes(roleId) ||
    !['case.archive', 'case.archive.correct'].includes(action) ||
    !['SELF', 'TEAM', 'DEPARTMENT'].includes(scope)
  )
    throw new Error('Grant outside synthetic archive setup');
  const client = await connect();
  try {
    if (
      (
        await client.query(
          'SELECT id FROM role_templates WHERE id=$1 AND department_id=ANY($2::uuid[])',
          [roleId, departments],
        )
      ).rows.length !== 1
    )
      throw new Error('Synthetic role missing');
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
export async function createClosedCaseArchiveSourceThroughApi(
  request,
  options = {},
) {
  const source = await createFinishedCaseClosureSourceThroughApi(request);
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleA,
    'case.closure.record',
    'TEAM',
  );
  let file = null;
  if (options.bytes) {
    const created = await request.post('/api/v1/materials/upload-drafts', {
      headers: operator,
      data: {
        ownerType: 'CASE',
        ownerId: source.caseId,
        category: 'CASE_CLOSURE_DOCUMENT',
        purpose: 'CASE_CLOSURE_DOCUMENT',
        originalFilename: 'ca017-prior-closure.pdf',
        declaredMimeType: 'application/pdf',
      },
    });
    if (created.status() !== 201)
      throw new Error('Normal prior closure upload draft failed');
    const draft = await created.json();
    const uploaded = await request.put(
      `/api/v1/materials/upload-drafts/${draft.id}/content`,
      {
        headers: { ...operator, 'Content-Type': 'application/octet-stream' },
        data: Buffer.from(options.bytes),
      },
    );
    if (uploaded.status() !== 200)
      throw new Error('Normal prior closure bytes upload failed');
    const completed = await uploaded.json();
    file = {
      materialId: completed.materialId,
      contentVersionId: completed.contentVersionId,
      originalFilename: 'ca017-prior-closure.pdf',
      mimeType: 'application/pdf',
    };
  }
  const closureInput = {
    expectedVersion: source.finished.version,
    idempotencyKey: randomUUID(),
    expectedFinishId: source.finished.finishId,
    closeAt: null,
    closeAmountState: options.realZero ? 'KNOWN' : 'PENDING',
    closeAmt: options.realZero ? '0.00' : null,
    note: null,
    closeContentVersionIds: file ? [file.contentVersionId] : [],
  };
  const response = await request.post(
    `/api/v1/cases/${source.caseId}/closure`,
    { headers: operator, data: closureInput },
  );
  if (response.status() !== 201)
    throw new Error('Normal prior closure registration failed');
  const originalClosureResult = await response.json();
  let closureResult = originalClosureResult;
  if (
    closureResult.stage !== 'WAITING_ARCHIVE' ||
    closureResult.version !== source.finished.version + 1
  )
    throw new Error('Prior closure receipt mismatch');
  if (options.realZero)
    closureResult = await prepareZeroAmountArchiveThroughApi(
      request,
      source.caseId,
      closureResult,
      {
        ...closureInput,
        closeAt: new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date()),
      },
    );
  return {
    ...source,
    closureResult,
    originalClosureResult,
    closureInput,
    file,
  };
}
export async function prepareZeroAmountArchiveThroughApi(
  request,
  caseId,
  closure,
  closureInput,
) {
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleA,
    'case.closure.correct',
    'TEAM',
  );
  const response = await request.post(
    `/api/v1/cases/${caseId}/closure-settlement-updates`,
    {
      headers: operator,
      data: {
        expectedVersion: closure.version,
        expectedClosureVersionId: closure.closureVersionId,
        idempotencyKey: randomUUID(),
        closeAt: closureInput.closeAt,
        closeAmountState: 'KNOWN',
        closeAmt: '0.00',
        closeContentVersionIds: closureInput.closeContentVersionIds,
        paymentType: 'ONE_TIME',
        paymentRecords: [],
        correctionReason:
          '合成案件明确零金额并确认没有诉讼退费，保留原结案资料',
        refund: {
          expectedVersionId: null,
          kind: 'DECLARE_NOT_APPLICABLE',
          items: [],
        },
      },
    },
  );
  if (response.status() !== 201)
    throw new Error(
      `Archive zero/refund declaration failed: ${await response.text()}`,
    );
  const updated = await response.json();
  if (
    updated.stage !== 'WAITING_ARCHIVE' ||
    updated.version !== closure.version + 1 ||
    updated.closureVersionId === closure.closureVersionId
  )
    throw new Error('Known-date financial update receipt mismatch');
  const currentResponse = await request.get(`/api/v1/cases/${caseId}`, {
    headers: operator,
  });
  if (currentResponse.status() !== 200)
    throw new Error('Known-date closure read failed');
  const current = await currentResponse.json();
  if (
    current.version !== updated.version ||
    current.stage !== 'WAITING_ARCHIVE' ||
    current.closure?.current?.id !== updated.closureVersionId ||
    current.closure.current.closeAt !== closureInput.closeAt ||
    current.closure.current.closeAmountState !== 'KNOWN' ||
    current.closure.current.closeAmt !== '0.00'
  )
    throw new Error(
      'Known-date zero closure was not retained in the current head',
    );
  return updated;
}

export async function readCaseArchiveSnapshot(caseId) {
  const client = await connect();
  try {
    await assertCase(client, caseId);
    return await snapshot(client, caseId);
  } finally {
    await client.end();
  }
}
export async function caseArchiveSourceSnapshot(client, caseId) {
  const result = {};
  result.case = (
    await client.query('SELECT to_jsonb(t) AS row FROM cases t WHERE id=$1', [
      caseId,
    ])
  ).rows;
  for (const table of priorTables)
    result[table] = (
      await client.query(
        `SELECT to_jsonb(t) AS row FROM "${table}" t WHERE case_id=$1 ORDER BY to_jsonb(t)::text`,
        [caseId],
      )
    ).rows;
  for (const [key, query] of [
    [
      'materials',
      "SELECT to_jsonb(t) AS row FROM materials t WHERE owner_type='CASE' AND owner_id=$1 ORDER BY id",
    ],
    [
      'content',
      "SELECT to_jsonb(t) AS row FROM content_versions t JOIN materials m ON m.id=t.material_id WHERE m.owner_type='CASE' AND m.owner_id=$1 ORDER BY t.id",
    ],
    [
      'references',
      "SELECT to_jsonb(t) AS row FROM material_references t WHERE resource_type='case' AND resource_id=$1 ORDER BY id",
    ],
    [
      'audits',
      "SELECT to_jsonb(t) AS row FROM audit_events t WHERE resource_type='CASE' AND resource_id=$1 ORDER BY id",
    ],
  ])
    result[key] = (await client.query(query, [caseId])).rows;
  result.grants = (
    await client.query(
      'SELECT to_jsonb(t) AS row FROM role_grants t ORDER BY id',
    )
  ).rows;
  return result;
}
async function snapshot(client, caseId) {
  const prior = await caseArchiveSourceSnapshot(client, caseId);
  for (const table of [
    ...archiveTables,
    'case_closure_settlement_update_receipts',
    'case_closure_settlement_update_payments',
    'case_settlement_update_child_links',
    'case_refund_inventory_versions',
    'case_refund_inventory_items',
    'case_refund_inventory_receipts',
  ])
    prior[table] = (
      await client.query(
        `SELECT to_jsonb(t) AS row FROM "${table}" t WHERE case_id=$1 ORDER BY to_jsonb(t)::text`,
        [caseId],
      )
    ).rows;
  for (const [key, query] of [
    [
      'refundAmounts',
      'SELECT to_jsonb(a) AS row FROM case_refund_inventory_item_amounts a JOIN case_refund_inventory_versions v ON v.id=a.inventory_version_id WHERE v.case_id=$1 ORDER BY a.inventory_version_id,a.item_id',
    ],
    [
      'snapshotPayments',
      'SELECT to_jsonb(i) AS row FROM case_archive_snapshot_payments i JOIN case_archive_evidence_snapshots s ON s.id=i.snapshot_id WHERE s.case_id=$1 ORDER BY i.snapshot_id,i.payment_version_id',
    ],
    [
      'snapshotAllocations',
      'SELECT to_jsonb(i) AS row FROM case_archive_snapshot_allocations i JOIN case_archive_evidence_snapshots s ON s.id=i.snapshot_id WHERE s.case_id=$1 ORDER BY i.snapshot_id,i.allocation_id',
    ],
    [
      'financialAudits',
      'SELECT to_jsonb(a) AS row FROM audit_events a WHERE a.id IN (SELECT audit_event_id FROM case_refund_inventory_versions WHERE case_id=$1 UNION SELECT audit_event_id FROM case_closure_settlement_update_receipts WHERE case_id=$1) ORDER BY a.id',
    ],
  ])
    prior[key] = (await client.query(query, [caseId])).rows;
  return JSON.stringify(prior);
}
export async function caseArchiveSqlRejection(caseId, probe) {
  const client = await connect();
  try {
    await assertCase(client, caseId);
    const before = await snapshot(client, caseId);
    const probes = {
      'case-version-only': 'UPDATE cases SET version=version+1 WHERE id=$1',
      'version-update':
        'UPDATE case_archive_versions SET case_id=case_id WHERE case_id=$1',
      'version-delete': 'DELETE FROM case_archive_versions WHERE case_id=$1',
      'receipt-update':
        'UPDATE case_archive_receipts SET case_id=case_id WHERE case_id=$1',
      'receipt-delete': 'DELETE FROM case_archive_receipts WHERE case_id=$1',
      'audit-delete':
        "DELETE FROM audit_events WHERE resource_type='CASE' AND resource_id=$1 AND action IN ('case.archived','case.archive.corrected')",
      'head-foreign-current':
        'UPDATE case_archives SET current_version_id=gen_random_uuid() WHERE case_id=$1',
      'head-change-closure':
        'UPDATE case_archives SET closure_version_id=gen_random_uuid() WHERE case_id=$1',
      'prior-closure-update':
        'UPDATE case_closure_versions SET case_id=case_id WHERE case_id=$1',
      'prior-document-delete':
        'DELETE FROM case_closure_documents WHERE case_id=$1',
      'stage-reopen': "UPDATE cases SET stage='WAITING_ARCHIVE' WHERE id=$1",
    };
    if (!Object.hasOwn(probes, probe))
      throw new Error('Unknown archive SQL probe');
    let code = null;
    await client.query('BEGIN');
    try {
      await client.query(probes[probe], [caseId]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    } catch (e) {
      code = e.code;
    } finally {
      await client.query('ROLLBACK');
    }
    return { code, unchanged: before === (await snapshot(client, caseId)) };
  } finally {
    await client.end();
  }
}
export async function withCaseArchiveFault(caseId, phase, command) {
  const client = await connect();
  const name = `ca017_fault_${randomUUID().replaceAll('-', '')}`;
  const sequence = `${name}_hit`;
  let installed = false;
  const targets = {
    audit: [
      'audit_events',
      'INSERT',
      `NEW.resource_id='${caseId}' AND NEW.action IN ('case.archived','case.archive.corrected')`,
    ],
    head: ['case_archives', 'INSERT OR UPDATE', `NEW.case_id='${caseId}'`],
    version: ['case_archive_versions', 'INSERT', `NEW.case_id='${caseId}'`],
    case: [
      'cases',
      'UPDATE',
      `NEW.id='${caseId}' AND NEW.version<>OLD.version`,
    ],
    receipt: ['case_archive_receipts', 'INSERT', `NEW.case_id='${caseId}'`],
  };
  try {
    await assertCase(client, caseId);
    if (!Object.hasOwn(targets, phase))
      throw new Error('Unknown archive fault phase');
    const [table, event, condition] = targets[phase];
    const before = await snapshot(client, caseId);
    await client.query(`CREATE SEQUENCE "${sequence}"`);
    await client.query(
      `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN PERFORM nextval('"${sequence}"'); RAISE EXCEPTION 'ca017 injected ${phase} fault' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`,
    );
    await client.query(
      `CREATE TRIGGER "${name}" BEFORE ${event} ON "${table}" FOR EACH ROW EXECUTE FUNCTION "${name}"()`,
    );
    installed = true;
    const response = await command();
    const reached = (await client.query(`SELECT is_called FROM "${sequence}"`))
      .rows[0].is_called;
    return {
      status: response.status(),
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
export async function clearCaseArchiveFixture() {
  const client = await connect();
  try {
    if (
      !(
        await client.query(
          "SELECT to_regclass('case_archives') IS NOT NULL AS yes",
        )
      ).rows[0].yes
    )
      return;
    await client.query('BEGIN');
    try {
      // Only the established 15433 synthetic fixture departments, never preview data.
      // Guard every row before truncating this fixture's new financial closure.
      // This runs with constraints and triggers enabled. Unknown FK dependents
      // cause PostgreSQL to reject the TRUNCATE; there is deliberately no CASCADE.
      const financialTables = [
        'case_archive_evidence_snapshots',
        'case_archive_snapshot_payments',
        'case_archive_snapshot_allocations',
        'case_closure_settlement_update_receipts',
        'case_closure_settlement_update_payments',
        'case_settlement_update_child_links',
        'case_refund_inventory_versions',
        'case_refund_inventory_items',
        'case_refund_inventory_receipts',
        'case_refund_inventory_item_amounts',
      ];
      const existingFinancialTables = [];
      for (const table of financialTables) {
        if (
          !(
            await client.query(
              'SELECT to_regclass($1) IS NOT NULL AS present',
              [table],
            )
          ).rows[0].present
        )
          continue;
        existingFinancialTables.push(table);
        let scope;
        if (
          table === 'case_archive_snapshot_payments' ||
          table === 'case_archive_snapshot_allocations'
        )
          scope = `SELECT 1 FROM "${table}" i LEFT JOIN case_archive_evidence_snapshots p ON p.id=i.snapshot_id LEFT JOIN cases c ON c.id=p.case_id AND c.department_id=p.department_id WHERE c.id IS NULL OR NOT(c.department_id=ANY($1::uuid[])) LIMIT 1`;
        else if (table === 'case_refund_inventory_item_amounts')
          scope = `SELECT 1 FROM "${table}" i LEFT JOIN case_refund_inventory_versions p ON p.id=i.inventory_version_id LEFT JOIN cases c ON c.id=p.case_id AND c.department_id=p.department_id WHERE c.id IS NULL OR NOT(c.department_id=ANY($1::uuid[])) LIMIT 1`;
        else
          scope = `SELECT 1 FROM "${table}" p LEFT JOIN cases c ON c.id=p.case_id AND c.department_id=p.department_id WHERE c.id IS NULL OR NOT(c.department_id=ANY($1::uuid[])) LIMIT 1`;
        if ((await client.query(scope, [departments])).rows.length)
          throw new Error(
            `Financial cleanup outside isolated synthetic cases: ${table}`,
          );
      }
      if (existingFinancialTables.length)
        await client.query(
          `TRUNCATE TABLE ${existingFinancialTables.map((table) => `"${table}"`).join(', ')}`,
        );
      await client.query('SET LOCAL session_replication_role=replica');
      await client.query(
        "UPDATE cases c SET version=v.to_version,stage='WAITING_ARCHIVE' FROM case_closures h JOIN case_closure_versions v ON v.id=h.current_version_id WHERE c.id=h.case_id AND c.department_id=ANY($1::uuid[]) AND EXISTS(SELECT 1 FROM case_archives a WHERE a.case_id=c.id)",
        [departments],
      );
      for (const table of [
        'case_archive_receipts',
        'case_archives',
        'case_archive_versions',
      ])
        await client.query(
          `DELETE FROM "${table}" WHERE department_id=ANY($1::uuid[])`,
          [departments],
        );
      await client.query(
        "DELETE FROM audit_events WHERE department_id=ANY($1::uuid[]) AND action IN ('case.archived','case.archive.corrected')",
        [departments],
      );
      await client.query(
        "DELETE FROM role_grants WHERE role_template_id=ANY($1::uuid[]) AND action IN ('case.archive','case.archive.correct')",
        [roles],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } finally {
    await client.end();
  }
}
