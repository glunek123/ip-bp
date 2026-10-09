import type { Prisma } from '../generated/prisma/client';
import type { ActorContext } from './actor-context';
import { OrganizationService } from './organization.service';

/** Lock current actor, membership, team and grants before the customer row. */
export async function lockCustomerActorFacts(
  tx: Prisma.TransactionClient,
  organization: OrganizationService,
  actor: ActorContext,
): Promise<void> {
  await organization.lockDepartment(tx, actor.departmentId);
  await tx.$queryRaw`SELECT id FROM user_accounts WHERE id = ${actor.userId}::uuid FOR SHARE NOWAIT`;
  const memberships = await tx.$queryRaw<Array<{ team_id: string | null }>>`
    SELECT team_id FROM department_memberships
    WHERE user_id = ${actor.userId}::uuid AND department_id = ${actor.departmentId}::uuid
    FOR SHARE NOWAIT`;
  const assignments = await tx.$queryRaw<
    Array<{ role_template_id: string; team_id: string | null }>
  >`
    SELECT role_template_id, team_id FROM role_assignments
    WHERE user_id = ${actor.userId}::uuid AND department_id = ${actor.departmentId}::uuid
    ORDER BY id FOR SHARE NOWAIT`;
  const roleIds = [
    ...new Set(assignments.map((row) => row.role_template_id)),
  ].sort();
  for (const roleId of roleIds) {
    await tx.$queryRaw`SELECT id FROM role_templates WHERE id = ${roleId}::uuid FOR SHARE NOWAIT`;
    await tx.$queryRaw`SELECT id FROM role_grants WHERE role_template_id = ${roleId}::uuid ORDER BY id FOR SHARE NOWAIT`;
  }
  const teamIds = [
    ...new Set(
      [
        ...memberships.map((row) => row.team_id),
        ...assignments.map((row) => row.team_id),
      ].filter((value): value is string => value !== null),
    ),
  ].sort();
  for (const teamId of teamIds) {
    await tx.$queryRaw`SELECT id FROM teams WHERE id = ${teamId}::uuid FOR SHARE NOWAIT`;
  }
}
