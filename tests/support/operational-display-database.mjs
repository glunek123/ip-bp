import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';
import { coreLeadFixtures } from './core-lead-database.mjs';

const url = process.env.DATABASE_URL;
if (!url || process.env.NODE_ENV !== 'test')
  throw new Error(
    'Operational display fixtures require the isolated test database',
  );
validateIsolatedTestDatabaseUrl(url, { allowRandomPort: true });
if (
  resolve(process.env.PRIVATE_FILE_ROOT ?? '') !==
  resolve(process.cwd(), '.local/private-files/test')
)
  throw new Error(
    'Operational display fixtures require the isolated test file root',
  );
function assertFixtureUser(userId) {
  if (userId !== coreLeadFixtures.userA && userId !== coreLeadFixtures.userSelf)
    throw new Error(
      'Operational display fixture user is outside the test scope',
    );
}
const requireBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { PrismaPg } = requireBackend('@prisma/adapter-pg');
const { PrismaClient } = requireBackend('./dist/generated/prisma/client.js');
const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url, max: 2 }),
});

export async function installLegacyNotaryPreference(userId) {
  assertFixtureUser(userId);
  await database.notaryListPreference.create({
    data: {
      userId,
      columnOrder: [
        'businessNo',
        'stage',
        'createdAt',
        'sourceLead',
        'notaryOffice',
      ],
      hiddenColumns: ['notaryOffice'],
    },
  });
}

export async function readStoredNotaryPreference(userId) {
  assertFixtureUser(userId);
  return database.notaryListPreference.findUnique({
    where: { userId },
    select: { columnOrder: true, hiddenColumns: true },
  });
}

export async function readIssuedCertificateReferences(matterId) {
  const certificate = await database.notaryCertificate.findUnique({
    where: { matterId },
    select: { id: true },
  });
  if (!certificate) throw new Error('Test certificate is missing');
  return database.materialReference.findMany({
    where: {
      departmentId: coreLeadFixtures.departmentA,
      resourceType: 'notary_matter',
      resourceId: matterId,
      purpose: 'NOTARY_CERTIFICATE',
      actionEvent: {
        action: 'notary.certificate_issued',
        resourceType: 'notary_matter',
        resourceId: matterId,
        departmentId: coreLeadFixtures.departmentA,
        details: { path: ['certificateId'], equals: certificate.id },
      },
    },
    select: {
      purpose: true,
      materialId: true,
      contentVersionId: true,
      contentVersion: { select: { originalFilename: true, mimeType: true } },
    },
  });
}

export async function disconnectOperationalDisplayDatabase() {
  await database.$disconnect();
}
