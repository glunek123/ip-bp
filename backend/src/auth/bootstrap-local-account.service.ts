import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { PermissionAction, PermissionScope } from '../generated/prisma/enums';
import { hashPassword, normalizeUsername, validatePassword } from './password';

export type BootstrapLocalAccountInput = {
  departmentName: string;
  username: string;
  displayName: string;
  password: string;
};

const ADMIN_ROLE_NAME = '系统管理员';

function assertUninitializedState(
  credentialCount: number,
  localUserCount: number,
  administratorRoleCount: number,
): void {
  if (credentialCount !== 0)
    throw new Error('LOCAL_ACCOUNT_ALREADY_INITIALIZED');
  if (localUserCount !== 0 || administratorRoleCount !== 0)
    throw new Error('LOCAL_ACCOUNT_PARTIAL_INITIALIZATION');
}

function requiredName(value: string, code: string): string {
  const result = value.trim();
  if (result.length === 0 || Array.from(result).length > 100)
    throw new Error(code);
  return result;
}

export async function bootstrapLocalAccount(
  database: DatabaseService,
  input: BootstrapLocalAccountInput,
): Promise<{ username: string; departmentName: string }> {
  const username = normalizeUsername(input.username);
  const departmentName = requiredName(
    input.departmentName,
    'DEPARTMENT_NAME_INVALID',
  );
  const displayName = requiredName(input.displayName, 'DISPLAY_NAME_INVALID');
  validatePassword(input.password);
  assertUninitializedState(
    ...(await Promise.all([
      database.localCredential.count(),
      database.userAccount.count({
        where: { externalSubject: { startsWith: 'local:' } },
      }),
      database.roleTemplate.count({ where: { name: ADMIN_ROLE_NAME } }),
    ])),
  );
  const passwordHash = await hashPassword(input.password);

  await database.$transaction(
    async (transaction) => {
      assertUninitializedState(
        ...(await Promise.all([
          transaction.localCredential.count(),
          transaction.userAccount.count({
            where: { externalSubject: { startsWith: 'local:' } },
          }),
          transaction.roleTemplate.count({
            where: { name: ADMIN_ROLE_NAME },
          }),
        ])),
      );
      const departments = await transaction.department.findMany({
        where: { name: departmentName },
        take: 2,
      });
      if (departments.length > 1) throw new Error('DEPARTMENT_NAME_AMBIGUOUS');
      const department =
        departments[0] ??
        (await transaction.department.create({
          data: { name: departmentName },
        }));
      const user = await transaction.userAccount.create({
        data: {
          externalSubject: `local:${randomUUID()}`,
          displayName,
        },
      });
      await transaction.localCredential.create({
        data: { userId: user.id, username, passwordHash },
      });
      await transaction.departmentMembership.create({
        data: { userId: user.id, departmentId: department.id },
      });
      const role = await transaction.roleTemplate.create({
        data: { departmentId: department.id, name: ADMIN_ROLE_NAME },
      });
      await transaction.roleGrant.createMany({
        data: Object.values(PermissionAction).map((action) => ({
          roleTemplateId: role.id,
          action,
          scope: PermissionScope.DEPARTMENT,
        })),
      });
      await transaction.roleAssignment.create({
        data: {
          userId: user.id,
          departmentId: department.id,
          roleTemplateId: role.id,
        },
      });
    },
    { isolationLevel: 'Serializable' },
  );
  return { username, departmentName };
}
