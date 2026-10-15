import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  captureTestEnvironment,
  validateBrowserTestDatabaseUrl,
} from '../../scripts/test-environment.mjs';

// The runner owns the instance lock. This support adds isolated actors only;
// all customer, material and case facts in the spec use the normal HTTP commands.
export async function prepareCaseListWorkflowActors() {
  if (
    process.env.NODE_ENV !== 'test' ||
    !process.env.DEV_COR_TEST_DATABASE_URL ||
    !process.env.DEV_COR_TEST_DATABASE_PROJECT ||
    !process.env.DEV_COR_TEST_DATABASE_CONTAINER_ID
  )
    throw new Error('Case list workflow requires the managed runner instance');
  const root = process.cwd();
  const captured = captureTestEnvironment(root, { pnpmVersion: '11.27.0' });
  validateBrowserTestDatabaseUrl(captured.childEnvironment.DATABASE_URL, root);
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
  return captureTestEnvironment(process.cwd(), { pnpmVersion: '11.27.0' })
    .fingerprint;
}
