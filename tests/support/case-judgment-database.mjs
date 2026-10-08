import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';

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
validateIsolatedTestDatabaseUrl(databaseUrl);
const privateRoot = resolve(process.env.PRIVATE_FILE_ROOT ?? '');
if (privateRoot !== resolve(root, '.local/private-files/test'))
  throw new Error('Isolated test blob root required');

export async function verifyCaseJudgmentDatabase() {
  const client = new Client({ connectionString: databaseUrl });
  const database = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  const storage = new LocalPrivateBlobStorage(privateRoot);
  const ids = {
    department: randomUUID(),
    actor: randomUUID(),
    role: randomUUID(),
    case: randomUUID(),
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
          randomUUID(),
          randomUUID(),
          ids.actor,
          ids.arrangement,
          ids.advance,
        ],
      );
      await client.query(
        "INSERT INTO case_acceptances(id,department_id,case_id,accepted_at,court_case_no,recorded_by_user_id,audit_event_id) VALUES ($1,$2,$3,'2026-10-01','CA008-db',$4,$5)",
        [ids.acceptance, ids.department, ids.case, ids.actor, randomUUID()],
      );
      await client.query(
        "INSERT INTO case_hearing_arrangements(id,department_id,case_id,hearing_at,source,recorded_by_user_id,from_version,to_version,audit_event_id) VALUES ($1,$2,$3,'2026-10-02','SCHEDULE',$4,7,8,$5)",
        [ids.arrangement, ids.department, ids.case, ids.actor, randomUUID()],
      );
      await client.query(
        "INSERT INTO case_hearing_advances(id,department_id,case_id,arrangement_id,due_at,executed_at,from_version,to_version,audit_event_id) VALUES ($1,$2,$3,$4,'2026-10-02T16:00:00Z','2026-10-02T16:00:01Z',8,9,$5)",
        [ids.advance, ids.department, ids.case, ids.arrangement, randomUUID()],
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
    const input = {
      expectedVersion: 9,
      idempotencyKey: `register-${ids.case}`,
      judgmentReceivedAt: '2026-10-08',
      judgmentAmountState: 'KNOWN',
      judgmentAmount: '0',
      paidLitigationFeeState: 'PENDING',
      paidLitigationFee: null,
      judgmentContentVersionIds: [uploaded.contentVersionId],
    };
    const result = await judgment.register(actor, ids.case, input);
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
      })) === 1;
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
      const tables = [
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
      await client.query(
        'DELETE FROM material_references WHERE resource_type=$1 AND resource_id=$2',
        ['case', ids.case],
      );
      for (const table of tables)
        await client.query(`DELETE FROM "${table}" WHERE case_id=$1`, [
          ids.case,
        ]);
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
      await client.query(
        'DELETE FROM role_assignments WHERE role_template_id=$1',
        [ids.role],
      );
      await client.query('DELETE FROM role_grants WHERE role_template_id=$1', [
        ids.role,
      ]);
      await client.query('DELETE FROM role_templates WHERE id=$1', [ids.role]);
      await client.query(
        'DELETE FROM department_memberships WHERE user_id=$1',
        [ids.actor],
      );
      await client.query('DELETE FROM user_accounts WHERE id=$1', [ids.actor]);
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
