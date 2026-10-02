import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';
import { coreLeadFixtures } from './core-lead-database.mjs';

const url = process.env.DATABASE_URL;
if (process.env.NODE_ENV !== 'test' || !url)
  throw new Error('An isolated test database is required');
validateIsolatedTestDatabaseUrl(url, { allowRandomPort: true });
const requireBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { PrismaPg } = requireBackend('@prisma/adapter-pg');
const { PrismaClient } = requireBackend('./dist/generated/prisma/client.js');
const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url, max: 8 }),
});

export async function createBatchWaitingReturnMatter(options = {}) {
  const departmentId = options.departmentId ?? coreLeadFixtures.departmentA;
  const actorUserId =
    options.actorUserId ??
    (departmentId === coreLeadFixtures.departmentA
      ? coreLeadFixtures.userA
      : coreLeadFixtures.userB);
  const responsibleUserId = options.responsibleUserId ?? actorUserId;
  const customerId =
    departmentId === coreLeadFixtures.departmentA
      ? coreLeadFixtures.admittedCustomer
      : coreLeadFixtures.foreignCustomer;
  const rightsHolderId =
    departmentId === coreLeadFixtures.departmentA
      ? coreLeadFixtures.holder
      : coreLeadFixtures.foreignHolder;
  const sourceLeadId = randomUUID();
  const matterId = randomUUID();
  const officeId = randomUUID();
  const sampleFeeState = options.sampleFeeState ?? 'KNOWN';
  const sampleFeeAmount =
    sampleFeeState === 'KNOWN' ? (options.sampleFeeAmount ?? '100.00') : null;
  await database.lead.create({
    data: {
      id: sourceLeadId,
      departmentId,
      businessNo: `NT010-L-${sourceLeadId}`,
      customerId,
      rightsHolderId,
      responsibleUserId,
      teamId:
        departmentId === coreLeadFixtures.departmentA
          ? coreLeadFixtures.teamA
          : null,
      caseType: 'CIVIL',
      source: 'ONLINE',
      platform: 'TAOBAO',
      foundAt: new Date('2026-09-21T02:30:00.000Z'),
      shopName: '批量归档测试店铺',
      needDisclose: false,
    },
  });
  await database.notaryOffice.create({
    data: {
      id: officeId,
      departmentId,
      name: `NT010-${officeId}`,
      createdByUserId: actorUserId,
    },
  });
  await database.notaryMatter.create({
    data: {
      id: matterId,
      businessNo: `NT010-M-${matterId}`,
      departmentId,
      sourceLeadId,
      customerId,
      rightsHolderId,
      responsibleUserId,
      notaryOfficeId: officeId,
      stage: options.stage ?? 'WAITING_RETURN',
      version: 5,
      evidenceMode: 'ONLINE_PURCHASE',
      batchPurpose: 'NT-010数据库风险探针',
      sourceSnapshot: {},
      createdByUserId: actorUserId,
      fromLeadVersion: 1,
      toLeadVersion: 2,
    },
  });
  await database.notaryMatterEvidence.create({
    data: {
      matterId,
      departmentId,
      evidenceAt: new Date('2026-09-24T00:00:00.000Z'),
      sampleFeeState,
      sampleFeeAmount,
      recordedByUserId: actorUserId,
    },
  });
  await database.notaryMatterOpening.create({
    data: {
      matterId,
      departmentId,
      recordedByUserId: actorUserId,
      internalActorUserId: actorUserId,
    },
  });
  const openingDecisionId = randomUUID();
  await database.notaryOpeningReviewDecision.create({
    data: {
      id: openingDecisionId,
      matterId,
      departmentId,
      customerId,
      actorUserId,
      actorKind: 'INTERNAL',
      internalActorUserId: actorUserId,
      actorDisplayNameSnapshot: '测试运营',
      result: 'INFRINGEMENT',
      fromVersion: 3,
      toVersion: 4,
    },
  });
  await database.notaryIssuanceDecision.create({
    data: {
      matterId,
      departmentId,
      openingReviewDecisionId: openingDecisionId,
      actorUserId,
      actorDisplayNameSnapshot: '测试运营',
      decision: options.decision ?? 'NO_ISSUE',
      fromVersion: 4,
      toVersion: 5,
    },
  });
  return {
    matterId,
    sourceLeadId,
    departmentId,
    sampleFeeState,
    sampleFeeAmount,
  };
}

export async function batchMatterState(matterId) {
  const matter = await database.notaryMatter.findUnique({
    where: { id: matterId },
    select: { stage: true, version: true },
  });
  const [archives, amounts, audits, evidence] = await Promise.all([
    database.notaryReturnArchive.count({ where: { matterId } }),
    database.notaryReturnAmount.findMany({
      where: { matterId },
      orderBy: { kind: 'asc' },
    }),
    database.auditEvent.count({
      where: {
        resourceId: matterId,
        action: 'notary.return.archive.succeeded',
      },
    }),
    database.notaryMatterEvidence.findUnique({
      where: { matterId },
      select: { sampleFeeState: true, sampleFeeAmount: true },
    }),
  ]);
  return { matter, archives, amounts, audits, evidence };
}

export async function batchReceiptCount() {
  return database.notaryReturnArchiveBatchReceipt.count();
}

export async function batchAuditCount() {
  return database.auditEvent.count({
    where: { action: 'notary.return.archive.batch.succeeded' },
  });
}

export async function corruptBatchReceipt(batchId) {
  await database.$executeRawUnsafe(
    'ALTER TABLE "notary_return_archive_batch_receipts" DISABLE TRIGGER USER',
  );
  try {
    await database.$executeRawUnsafe(
      'UPDATE "notary_return_archive_batch_receipts" SET result_snapshot = $1::jsonb WHERE id = $2::uuid',
      JSON.stringify({ batchId, items: [] }),
      batchId,
    );
  } finally {
    await database.$executeRawUnsafe(
      'ALTER TABLE "notary_return_archive_batch_receipts" ENABLE TRIGGER USER',
    );
  }
}

export async function rejectBatchReceiptWrites() {
  await database.$executeRawUnsafe(
    'ALTER TABLE "notary_return_archive_batch_receipts" ADD CONSTRAINT "nt010_reject_receipt" CHECK (false) NOT VALID',
  );
}

export async function rejectBatchAuditWrites() {
  await database.$executeRawUnsafe(`CREATE FUNCTION nt010_reject_batch_audit() RETURNS trigger AS $$
    BEGIN IF NEW.action='notary.return.archive.batch.succeeded' THEN
      RAISE EXCEPTION 'injected batch audit failure' USING ERRCODE='23514';
    END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await database.$executeRawUnsafe(
    'CREATE TRIGGER nt010_reject_batch_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION nt010_reject_batch_audit()',
  );
}

export async function allowBatchInjectedFailures() {
  await database.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS nt010_reject_batch_audit ON audit_events',
  );
  await database.$executeRawUnsafe(
    'DROP FUNCTION IF EXISTS nt010_reject_batch_audit()',
  );
  await database.$executeRawUnsafe(
    'ALTER TABLE "notary_return_archive_batch_receipts" DROP CONSTRAINT IF EXISTS "nt010_reject_receipt"',
  );
}

export async function disconnectBatchDatabase() {
  await database.$disconnect();
}
