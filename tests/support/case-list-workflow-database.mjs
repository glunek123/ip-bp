import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  captureTestEnvironment,
  validateBrowserTestDatabaseUrl,
  validateIsolatedTestDatabaseUrl,
} from '../../scripts/test-environment.mjs';

const approvedContainerId =
  '45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236';

// Admission is deliberately narrower than the shared random-port validator.
// This suite may add synthetic actors only to the one approved UI003 instance.
export function assertCaseListWorkflowTarget(environment) {
  if (
    environment.NODE_ENV !== 'test' ||
    environment.DEV_COR_TEST_DATABASE_PROJECT !== 'dev-cor-ui003-r2' ||
    environment.DEV_COR_TEST_DATABASE_CONTAINER_ID !== approvedContainerId
  )
    throw new Error('Case list workflow requires the approved UI003 instance');
  const target = validateIsolatedTestDatabaseUrl(
    environment.DEV_COR_TEST_DATABASE_URL,
    { allowRandomPort: true },
  );
  if (
    target.hostname !== '127.0.0.1' ||
    target.port !== 15438 ||
    target.database !== 'dev_cor_test'
  )
    throw new Error('Case list workflow requires the approved UI003 database');
}

function captureApprovedEnvironment() {
  assertCaseListWorkflowTarget(process.env);
  const root = process.cwd();
  const captured = captureTestEnvironment(root, { pnpmVersion: '11.27.0' });
  assertCaseListWorkflowTarget(captured.childEnvironment);
  validateBrowserTestDatabaseUrl(captured.childEnvironment.DATABASE_URL, root);
  return captured;
}

// The runner owns the instance lock. This support adds isolated actors only;
// all customer, material and case facts in the spec use the normal HTTP commands.
export async function prepareCaseListWorkflowActors() {
  const captured = captureApprovedEnvironment();
  const root = process.cwd();
  const backendRequire = createRequire(resolve(root, 'backend/package.json'));
  const { PrismaClient } = backendRequire('./dist/generated/prisma/client.js');
  const { PrismaPg } = backendRequire('@prisma/adapter-pg');
  const { hashPassword } = backendRequire('./dist/auth/password.js');
  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: captured.childEnvironment.DATABASE_URL,
      max: 2,
    }),
  });
  const run = randomUUID();
  const departmentId = randomUUID();
  const operator = {
    id: randomUUID(),
    username: `c2-${run}`,
    password: `C2-Workflow-${randomUUID()}`,
  };
  const reader = {
    id: randomUUID(),
    username: `c2-read-${run}`,
    password: `C2-Readonly-${randomUUID()}`,
  };
  const roles = [randomUUID(), randomUUID()];
  const hashes = await Promise.all([
    hashPassword(operator.password),
    hashPassword(reader.password),
  ]);
  try {
    await db.$transaction(async (tx) => {
      await tx.department.create({
        data: { id: departmentId, name: `C2 synthetic ${run}` },
      });
      for (const [index, actor] of [operator, reader].entries()) {
        await tx.userAccount.create({
          data: {
            id: actor.id,
            externalSubject: `c2:${actor.id}`,
            displayName: index === 0 ? '合成列表运营' : '合成只读运营',
            accountType: 'INTERNAL',
            localCredential: {
              create: { username: actor.username, passwordHash: hashes[index] },
            },
          },
        });
        await tx.departmentMembership.create({
          data: { userId: actor.id, departmentId },
        });
        await tx.roleTemplate.create({
          data: { id: roles[index], departmentId, name: `C2 ${index} ${run}` },
        });
        await tx.roleAssignment.create({
          data: {
            userId: actor.id,
            departmentId,
            roleTemplateId: roles[index],
          },
        });
      }
      const actions = [
        'CUSTOMER_READ',
        'CUSTOMER_CREATE_DRAFT',
        'CUSTOMER_EDIT_ROUTINE',
        'CUSTOMER_ADMIT',
        'CASE_READ',
        'CASE_EXTERNAL_ENTRY_CREATE',
        'CASE_JUDGMENT_REGISTER',
        'CASE_JUDGMENT_CORRECT',
        'CASE_JUDGMENT_NEXT_STEP',
        'CASE_SECOND_INSTANCE_SAVE',
        'CASE_SECOND_INSTANCE_RESULT',
      ];
      await tx.roleGrant.createMany({
        data: actions.map((action) => ({
          roleTemplateId: roles[0],
          action,
          scope: 'DEPARTMENT',
        })),
      });
      await tx.roleGrant.create({
        data: {
          roleTemplateId: roles[1],
          action: 'CASE_READ',
          scope: 'DEPARTMENT',
        },
      });
    });
  } finally {
    await db.$disconnect();
  }
  return {
    run,
    departmentId,
    operator,
    reader,
    environmentFingerprint: captured.fingerprint,
  };
}

export function captureCaseListWorkflowEnvironment() {
  return captureApprovedEnvironment().fingerprint;
}
